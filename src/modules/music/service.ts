import { randomUUID } from 'node:crypto';
import { logRecord } from '../../observability/logging.js';
import type { Client, Guild } from 'discord.js';
import type { MusicState } from '../../types/contracts.js';
import type { MusicProvider } from './audius.js';
import { AudiusProvider } from './audius.js';
import { MusicSources } from './sources.js';
import { configuredYouTube } from './youtube.js';
import { DiscordMusicTransport, type MusicTransport } from './transport.js';
import { requireModule } from '../settings/service.js';
import { workflowError } from '../workflow/rules.js';

interface Session { state: MusicState; transport: MusicTransport | null; idleSince: number; emptySince: number | null; watchdog?: ReturnType<typeof setTimeout> }
export type MusicAuthorization = (channelId: string | null) => Promise<void>;
export class MusicService {
  private sessions = new Map<string, Session>();
  private locks = new Map<string, Promise<void>>();
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  constructor(readonly provider: MusicProvider, private readonly transportFactory: (disconnected: () => void) => MusicTransport,
    private readonly enabled: (guildId: string) => Promise<unknown> = (guildId) => requireModule(guildId, 'music')) {}
  private session(guildId: string) {
    let session = this.sessions.get(guildId);
    if (!session) {
      session = { state: { version: 0, channelId: null, status: 'disconnected', current: null, queue: [], volume: 30, error: null }, transport: null, idleSince: Date.now(), emptySince: null };
      this.sessions.set(guildId, session);
    }
    return session;
  }
  snapshot(guildId: string): MusicState {
    const session = this.session(guildId);
    const maximum = (session.state.current?.track.durationSeconds ?? 0) * 1000;
    const position = session.transport?.position?.() ?? 0;
    return { ...structuredClone(session.state), positionMs: Number.isFinite(position) ? Math.min(maximum, Math.max(0, position)) : 0, observedAt: new Date().toISOString() };
  }
  private async serial<T>(guildId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(guildId) ?? Promise.resolve();
    const result = previous.then(action);
    const finished = result.then(() => {}, () => {});
    this.locks.set(guildId, finished);
    void finished.then(() => { if (this.locks.get(guildId) === finished) this.locks.delete(guildId); });
    return result;
  }
  private close(session: Session, error: string | null = null) {
    clearTimeout(session.watchdog); session.watchdog = undefined;
    session.transport?.disconnect(); session.transport = null;
    session.state = { ...session.state, version: session.state.version + 1, channelId: null, status: 'disconnected', current: null, queue: [], error };
    session.emptySince = null;
  }
  private async mutate(guildId: string, version: number, authorize: MusicAuthorization, action: (session: Session) => Promise<void>, allowDisabled = false, actionName = 'update') {
    return this.serial(guildId, async () => {
      if (this.stopped) throw workflowError(503, 'El reproductor se esta cerrando.');
      const session = this.session(guildId);
      if (session.state.version !== version) throw workflowError(409, 'El reproductor cambio en otra vista. Actualiza antes de repetir la accion.');
      await authorize(session.state.channelId);
      if (!allowDisabled) await this.enabled(guildId);
      await action(session);
      session.state.version++;
      logRecord('music.action', { guildId, action: actionName, outcome: 'completed' });
      return this.snapshot(guildId);
    });
  }
  async connect(guild: Guild, channelId: string, version: number, authorize: MusicAuthorization) {
    return this.mutate(guild.id, version, authorize, async (session) => {
      if (session.state.channelId && session.state.channelId !== channelId) throw workflowError(409, 'Desconecta el reproductor antes de cambiar de canal.');
      if (session.transport) return;
      const transport = this.transportFactory(() => { void this.serial(guild.id, async () => { if (session.transport === transport) this.close(session, 'Se perdio la conexion de voz. Conecta nuevamente para continuar.'); }); });
      session.transport = transport;
      try { await transport.connect(guild, channelId); }
      catch (error) { this.close(session, 'No se pudo establecer la conexion de voz.'); throw error; }
      if (this.stopped) { this.close(session); return; }
      transport.volume(session.state.volume);
      session.state.channelId = channelId; session.state.status = 'idle'; session.state.error = null;
      session.idleSince = Date.now();
    }, false, 'connect');
  }
  async enqueue(guildId: string, trackId: string, actorId: string, version: number, authorize: MusicAuthorization) {
    return this.mutate(guildId, version, authorize, async (session) => {
      if (!session.transport) throw workflowError(409, 'Conecta a Magelina a un canal de voz primero.');
      if (session.state.queue.length >= 25) throw workflowError(400, 'La cola admite hasta 25 canciones pendientes.');
      const track = await this.provider.track(trackId);
      session.state.queue.push({ id: randomUUID(), track, requestedBy: actorId });
      if (!session.state.current) await this.next(guildId, session);
    }, false, 'enqueue');
  }
  private async next(guildId: string, session: Session) {
    clearTimeout(session.watchdog); session.watchdog = undefined;
    session.transport?.stopTrack(); session.state.current = null;
    if (session.transport && session.state.queue.length && !this.stopped) {
      try { await this.enabled(guildId); } catch { this.close(session, 'Musica pausada por configuracion o mantenimiento.'); return; }
      const entry = session.state.queue.shift()!;
      session.state.current = entry; session.state.status = 'buffering';
      try {
        // Validate again when a queued track reaches the player; availability may have changed.
        entry.track = await this.provider.track(entry.track.id);
        const finished = (error?: string) => {
          void this.serial(guildId, async () => {
            if (this.stopped || session.state.current?.id !== entry.id) return;
            session.state.error = error ?? null;
            await this.next(guildId, session); session.state.version++;
          });
        };
        await session.transport.play(entry.track, finished);
        if (this.stopped || !session.transport) return;
        session.state.status = 'playing';
        logRecord('music.playback.started', { guildId });
        session.watchdog = setTimeout(() => finished('La pista excedio su tiempo de reproduccion y se avanzo la cola.'), (entry.track.durationSeconds + 45) * 1000);
        session.watchdog.unref();
        return;
      } catch {
        session.transport?.stopTrack(); session.state.error = 'Una pista no esta disponible y se retiro de la cola.'; session.state.current = null;
        if (session.transport && session.state.queue.length && !this.stopped) {
          session.state.status = 'buffering';
          session.watchdog = setTimeout(() => { void this.serial(guildId, async () => { await this.next(guildId, session); session.state.version++; }); }, 500);
          session.watchdog.unref(); return;
        }
      }
    }
    if (session.transport) { session.state.status = 'idle'; session.idleSince = Date.now(); }
  }
  async control(guildId: string, action: 'pause' | 'resume' | 'skip' | 'stop' | 'disconnect' | 'volume' | 'remove', version: number, authorize: MusicAuthorization, value?: number | string) {
    return this.mutate(guildId, version, authorize, async (session) => {
      if (action === 'disconnect') { this.close(session); return; }
      if (!session.transport) throw workflowError(409, 'El reproductor no esta conectado.');
      if (action === 'pause') {
        if (session.state.status !== 'playing') throw workflowError(409, 'No hay una cancion reproduciendose.');
        session.transport.pause(); session.state.status = 'paused';
        clearTimeout(session.watchdog); session.watchdog = undefined;
      } else if (action === 'resume') {
        if (session.state.status !== 'paused') throw workflowError(409, 'El reproductor no esta pausado.');
        session.transport.resume(); session.state.status = 'playing';
        session.watchdog = setTimeout(() => { void this.serial(guildId, async () => { await this.next(guildId, session); session.state.version++; }); }, (session.state.current!.track.durationSeconds + 45) * 1000);
        session.watchdog.unref();
      } else if (action === 'skip') await this.next(guildId, session);
      else if (action === 'stop') { clearTimeout(session.watchdog); session.transport.stopTrack(); session.state.current = null; session.state.queue = []; session.state.status = 'idle'; session.idleSince = Date.now(); }
      else if (action === 'volume') { session.state.volume = value as number; session.transport.volume(session.state.volume); }
      else if (action === 'remove') {
        if (!session.state.queue.some((entry) => entry.id === value)) throw workflowError(409, 'Esta pista ya no esta en la cola.');
        session.state.queue = session.state.queue.filter((entry) => entry.id !== value);
      }
    }, action === 'disconnect', action);
  }
  startMaintenance(bot: Client) {
    if (this.timer) return;
    let running = false;
    this.timer = setInterval(() => {
      if (running || this.stopped) return; running = true;
      void (async () => {
        for (const [guildId, session] of this.sessions) {
          if (!session.transport) continue;
          await this.serial(guildId, async () => {
            if (!session.transport) return;
            try {
              await this.enabled(guildId);
              const guild = bot.guilds.cache.get(guildId), channel = guild?.channels.cache.get(session.state.channelId!);
              if (!guild || !channel?.isVoiceBased() || guild.members.me?.voice.channelId !== channel.id) { this.close(session, 'El bot salio o fue movido del canal de voz.'); return; }
              if (!channel.members.some((member) => !member.user.bot)) session.emptySince ??= Date.now(); else session.emptySince = null;
              if ((session.emptySince && Date.now() - session.emptySince >= 60_000) || (session.state.status === 'idle' && Date.now() - session.idleSince >= 120_000)) this.close(session);
            } catch { this.close(session, 'Musica detenida por configuracion, mantenimiento o falta de conectividad.'); }
          });
        }
      })().finally(() => { running = false; });
    }, 15_000);
    this.timer.unref();
  }
  dispose() { this.stopped = true; clearInterval(this.timer); for (const session of this.sessions.values()) this.close(session); this.sessions.clear(); }
}

const services = new WeakMap<Client, MusicService>();
export function getMusicService(bot: Client, apiKey?: string) {
  let service = services.get(bot);
  if (!service) { const provider = new MusicSources(new AudiusProvider(apiKey), configuredYouTube()); service = new MusicService(provider, (disconnected) => new DiscordMusicTransport(provider, disconnected)); services.set(bot, service); }
  return service;
}
