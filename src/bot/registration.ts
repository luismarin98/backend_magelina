import { REST, Routes } from 'discord.js';
import { observeDiscordRest } from '../observability/logging.js';
import { commandDefinitions } from './commands/registry.js';
export { commandDefinitions } from './commands/registry.js';
import { workflowError } from '../modules/workflow/rules.js';

export interface RegistrationConfig { production: boolean; discordClientId: string; discordTestGuildId?: string }
export function commandTarget(config: RegistrationConfig) {
  if (!/^\d{17,20}$/.test(config.discordClientId)) throw workflowError(503, 'La aplicación de Discord no está configurada.');
  if (config.production) return { scope: 'global' as const, guildId: null, route: Routes.applicationCommands(config.discordClientId) };
  if (!config.discordTestGuildId || !/^\d{17,20}$/.test(config.discordTestGuildId)) throw workflowError(503, 'Configura DISCORD_TEST_GUILD_ID en el backend para actualizar comandos durante el desarrollo.');
  return { scope: 'test-guild' as const, guildId: config.discordTestGuildId, route: Routes.applicationGuildCommands(config.discordClientId, config.discordTestGuildId) };
}
export interface PublicationTarget { scope: 'global' | 'guild'; guildId?: string }
export interface CommandRest { get(route: `/${string}`): Promise<unknown>; post(route: `/${string}`, options: { body: unknown }): Promise<unknown>; delete?(route: `/${string}`): Promise<unknown> }

// Discord publishes the root command, but each local subcommand can be compared
// with the nested options returned for that exact destination.
export function subcommandPaths(options: unknown, prefix = ''): string[] {
  return subcommandEntries(options, prefix).map(entry => entry.name);
}
function subcommandEntries(options: unknown, prefix = ''): { name: string; description: string }[] {
  if (!Array.isArray(options)) return [];
  return options.flatMap(option => {
    if (!option || typeof option.name !== 'string') return [];
    const path = `${prefix}${option.name}`;
    if (option.type === 1) return [{ name: path, description: typeof option.description === 'string' ? option.description : '' }];
    if (option.type === 2) return subcommandEntries(option.options, `${path} `);
    return [];
  });
}
export class CommandRegistration {
  private running = false;
  private nextUpdate = 0;
  constructor(private readonly config: RegistrationConfig, private readonly rest: CommandRest) {}
  private target(selected?: PublicationTarget) {
    if (!selected) return commandTarget(this.config);
    const global = commandTarget({ ...this.config, production: true });
    if (selected.scope === 'global' && selected.guildId === undefined) return global;
    if (selected.scope !== 'guild' || !selected.guildId || !/^\d{17,20}$/.test(selected.guildId)) throw workflowError(400, 'Destino de comandos no válido.');
    return { scope: 'guild' as const, guildId: selected.guildId, route: Routes.applicationGuildCommands(this.config.discordClientId, selected.guildId) };
  }
  async status(selected?: PublicationTarget) {
    const target = this.target(selected);
    let registered: unknown;
    try { registered = await this.rest.get(target.route); }
    catch { throw workflowError(502, 'No se pudieron consultar los comandos en Discord. Inténtalo de nuevo.'); }
    if (!Array.isArray(registered)) throw workflowError(502, 'Discord devolvió una lista de comandos no válida.');
    const published = registered.filter((value): value is { id: string; name: string; type: number; description?: string; version?: string; options?: unknown } => value && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.type === 'number');
    return { scope: target.scope, guildId: target.guildId, checkedAt: new Date().toISOString(), published: published.map(entry => ({ id: entry.id, name: entry.name, type: entry.type, description: entry.description ?? '', version: entry.version ?? null, subcommands: entry.type === 1 ? subcommandEntries(entry.options) : [], managed: commandDefinitions.some(definition => definition.name === entry.name && definition.type === entry.type) })),
      commands: commandDefinitions.map(definition => {
        const entry = published.find(value => value.name === definition.name && value.type === definition.type);
        const livePaths = new Set(entry?.type === 1 ? subcommandPaths(entry.options) : []);
        const subcommands = subcommandPaths('options' in definition ? definition.options : []).map(name => ({ name, registered: livePaths.has(name) }));
        return { name: definition.name, type: definition.type, registered: Boolean(entry), subcommands };
      }) };
  }
  async sync(selected?: PublicationTarget, names?: string[]) {
    const target = this.target(selected);
    if (names !== undefined && (!Array.isArray(names) || !names.length || new Set(names).size !== names.length || !names.every(name => commandDefinitions.some(command => command.name === name)))) throw workflowError(400, 'Selecciona comandos disponibles en esta versión del backend.');
    if (this.running) throw workflowError(409, 'Ya hay una actualización de comandos en curso.');
    if (Date.now() < this.nextUpdate) throw workflowError(429, 'Espera un minuto entre actualizaciones de comandos.');
    this.running = true; this.nextUpdate = Date.now() + 60_000;
    const results: { name: string; updated: boolean; error?: string }[] = [];
    try {
      for (const command of commandDefinitions) {
        if (names && !names.includes(command.name)) continue;
        try { await this.rest.post(target.route, { body: command }); results.push({ name: command.name, updated: true }); }
        catch { results.push({ name: command.name, updated: false, error: 'Discord no confirmó la actualización. Refresca el estado antes de volver a intentar.' }); }
      }
      return { scope: target.scope, guildId: target.guildId, completedAt: new Date().toISOString(), results };
    } finally { this.running = false; }
  }
  async unpublish(selected: PublicationTarget, commandId: string) {
    const target = this.target(selected);
    if (!/^\d{17,20}$/.test(commandId)) throw workflowError(400, 'ID de comando no válido.');
    if (this.running) throw workflowError(409, 'Ya hay una actualización de comandos en curso.');
    this.running = true;
    try {
      const status = await this.status(selected);
      const command = status.published.find(entry => entry.id === commandId);
      if (!command) throw workflowError(404, 'El comando ya no está publicado en este destino. Refresca el estado.');
      try {
        if (!this.rest.delete) throw new Error('Delete unavailable');
        await this.rest.delete(`${target.route}/${commandId}`);
      } catch { throw workflowError(502, 'Discord no confirmó la retirada. Refresca el estado antes de volver a intentar.'); }
      return { scope: target.scope, guildId: target.guildId, name: command.name, removed: true };
    } finally { this.running = false; }
  }
}
export function createCommandRegistration(config: RegistrationConfig & { discordToken: string }) {
  return new CommandRegistration(config, observeDiscordRest(new REST({ version: '10', timeout: 15_000, retries: 0 }).setToken(config.discordToken)));
}
