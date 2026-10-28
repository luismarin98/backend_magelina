import { SlashCommandBuilder } from 'discord.js';
import type { SlashContext } from '../context.js';
import * as ayuda from './ayuda.js';
import * as panel from './panel.js';
import * as solicitudes from './solicitudes.js';
import * as solicitud from './solicitud.js';
import * as conocimiento from './conocimiento.js';
import * as proyectos from './proyectos.js';
import * as colaboracion from './colaboracion.js';
import * as automatizaciones from './automatizaciones.js';
export { panelSections } from './sections.js';

export const subcommands = [ayuda, panel, solicitudes, solicitud, conocimiento, proyectos, colaboracion, automatizaciones] as const;
export const managerCommand = new SlashCommandBuilder().setName('magelina').setDescription('Herramientas de tu comunidad').setDescriptionLocalizations({ "en-US": "Your community tools", "en-GB": "Your community tools" }).setDMPermission(false);
for (const command of subcommands) managerCommand.addSubcommand(command.definition);

export async function executeCommunity(context: SlashContext) {
  const command = subcommands.find(entry => entry.definition.name === context.command);
  if (!command) throw new Error('Unknown subcommand');
  return command.execute(context);
}
