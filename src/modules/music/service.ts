import { randomUUID } from 'node:crypto';
import { logRecord } from '../../observability/logging.js';
import type { Client, Guild } from 'discord.js';
import type { MusicQueueEntry, MusicState } from '../../types/contracts.js';
import type { MusicProvider } from './audius.js';
import { AudiusProvider } from './audius.js';
import { MusicSources } from './sources.js';
import { configuredYouTube } from './youtube.js';
import { DiscordMusicTransport, type MusicTransport } from './transport.js';
import { requireModule } from '../settings/service.js';
import { workflowError } from '../workflow/rules.js';
import { createMusicNotifier, type MusicNotice, type MusicNotifier } from './notifications.js';

interface Session { state: MusicState; transport: MusicTransport | null; idleSince: number; emptySince: number | null; maintenanceFailures?: number; watchdog?: ReturnType<typeof setTimeout> }
export type MusicAuthorization = (channelId: string | null) => Promise<void>;
export class MusicService {
  private sessions = new Map<string, Session>();
  private locks = new Map<string, Promise<void>>();
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  constructor(readonly provider: MusicProvider, private readonly transportFactory: (disconnected: () => void) => MusicTransport,
    private readonly enabled: (guildId: string) => Promise<unknown> = (guildId) => requireModule(guildId, 'music'),
    private readonly notifier?: MusicNotifier) {}
  private announce(guildId: string, session: Session, kind: MusicNotice['kind'], entries: MusicQueueEntry[]) {
    if (!this.notifier || !session.state.channelId || !entries.length || this.stopped) return;
    const notice: MusicNotice = structuredClone({ kind, guildId, channelId: session.state.channelId,
      entries, next: session.state.queue[0] ?? null, pending: session.state.queue.length });
    // Notification failures must never turn a successful queue operation into a failure.
    void Promise.resolve().then(() => this.notifier!(notice)).catch(() => {
      logRecord('music.notice.failed', { guildId, reason: 'notifier-error', outcome: 'failed' });
    });
  }
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
  private close(session: Session, error: string | null = null, preserveQueue = false) {
    clearTimeout(session.watchdog); session.watchdog = undefined;
    session.transport?.disconnect(); session.transport = null;
    session.state = { ...session.state, version: session.state.version + 1, channelId: null, status: 'disconnected', current: null, queue: preserveQueue ? [...(session.state.current ? [session.state.current] : []), ...session.state.queue] : [], error };
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
      const transport = this.transportFactory(() => { void this.serial(guild.id, async () => { if (session.transport === transport) { logRecord('music.voice.lost', { guildId: guild.id, outcome: 'failed' }); this.close(session, 'Se perdio la conexion de voz. Reconecta para reiniciar la pista y continuar la cola.', true); } }); });
      session.transport = transport;
      try { await transport.connect(guild, channelId); }
      catch (error) { this.close(session, 'No se pudo establecer la conexion de voz.', true); throw error; }
      if (this.stopped) { this.close(session); return; }
      transport.volume(session.state.volume);
      session.state.channelId = channelId; session.state.status = 'idle'; session.state.error = null;
      session.idleSince = Date.now();
      if (session.state.queue.length) await this.next(guild.id, session);
    }, false, 'connect');
  }
  async enqueue(guildId: string, trackId: string, actorId: string, version: number, authorize: MusicAuthorization) {
    return this.mutate(guildId, version, authorize, async (session) => {
      if (!session.transport) throw workflowError(409, 'Conecta a Magelina a un canal de voz primero.');
      if (session.state.queue.length >= 25) throw workflowError(400, 'La cola admite hasta 25 canciones pendientes.');
      const tracks = trackId.startsWith('youtube:playlist:')
        ? await (this.provider.playlist?.(trackId, 25 - session.state.queue.length) ?? Promise.reject(workflowError(503, 'Este proveedor no admite playlists.')))
        : [await this.provider.track(trackId)];
      // Recheck access and configuration after the external lookup, before changing the queue.
      await authorize(session.state.channelId);
      await this.enabled(guildId);
      const entries = tracks.slice(0, 25 - session.state.queue.length).map(track => ({ id: randomUUID(), track, requestedBy: actorId }));
      session.state.queue.push(...entries);
      this.announce(guildId, session, 'added', entries);
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
            this.announce(guildId, session, error ? 'failed' : 'finished', [entry]);
            await this.next(guildId, session); session.state.version++;
          });
        };
        await session.transport.play(entry.track, finished);
        if (this.stopped || !session.transport) return;
        session.state.status = 'playing';
        this.announce(guildId, session, 'started', [entry]);
        logRecord('music.playback.started', { guildId });
        session.watchdog = setTimeout(() => finished('La pista excedio su tiempo de reproduccion y se avanzo la cola.'), (entry.track.durationSeconds + 45) * 1000);
        session.watchdog.unref();
        return;
      } catch {
        this.announce(guildId, session, 'failed', [entry]);
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
        session.watchdog = setTimeout(() => { void this.serial(guildId, async () => {
          if (session.state.current) this.announce(guildId, session, 'failed', [session.state.current]);
          await this.next(guildId, session); session.state.version++;
        }); }, (session.state.current!.track.durationSeconds + 45) * 1000);
        session.watchdog.unref();
      } else if (action === 'skip') {
        if (session.state.current) this.announce(guildId, session, 'skipped', [session.state.current]);
        await this.next(guildId, session);
      } else if (action === 'stop') { clearTimeout(session.watchdog); session.transport.stopTrack(); session.state.current = null; session.state.queue = []; session.state.status = 'idle'; session.idleSince = Date.now(); }
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
              session.maintenanceFailures = 0;
              const guild = bot.guilds.cache.get(guildId), channel = guild?.channels.cache.get(session.state.channelId!);
              if (!guild || !channel?.isVoiceBased() || guild.members.me?.voice.channelId !== channel.id) { this.close(session, 'El bot salio o fue movido del canal de voz.'); return; }
              if (!channel.members.some((member) => !member.user.bot)) session.emptySince ??= Date.now(); else session.emptySince = null;
              if ((session.emptySince && Date.now() - session.emptySince >= 60_000) || (session.state.status === 'idle' && Date.now() - session.idleSince >= 120_000)) this.close(session);
            } catch (error) {
              // Explicit configuration denials remain immediate; infrastructure errors get a bounded grace period.
              const denied = error instanceof Error && 'publicMessage' in error && 'status' in error;
              session.maintenanceFailures = (session.maintenanceFailures ?? 0) + 1;
              logRecord('music.maintenance.failed', { guildId, reason: denied ? 'configuration-denied' : 'settings-unavailable', outcome: 'failed' });
              if (denied || session.maintenanceFailures >= 3) this.close(session, 'Musica detenida por configuracion, mantenimiento o falta de conectividad.', !denied);
            }
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
  if (!service) { const provider = new MusicSources(new AudiusProvider(apiKey), configuredYouTube()); service = new MusicService(provider, (disconnected) => new DiscordMusicTransport(provider, disconnected), undefined, createMusicNotifier(bot)); services.set(bot, service); }
  return service;
}
