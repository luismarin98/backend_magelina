import { SlashCommandBuilder } from 'discord.js';
import type { SlashContext } from '../context.js';
import * as youtube from './youtube.js';
import * as buscar from './buscar.js';
import * as conectar from './conectar.js';
import * as agregar from './agregar.js';
import * as cola from './cola.js';
import * as volumen from './volumen.js';
import * as retirar from './retirar.js';
import * as pausar from './pausar.js';
import * as continuar from './continuar.js';
import * as saltar from './saltar.js';
import * as detener from './detener.js';
import * as desconectar from './desconectar.js';

export const subcommands = [youtube, buscar, conectar, agregar, cola, volumen, retirar, pausar, continuar, saltar, detener, desconectar] as const;
export const musicCommand = new SlashCommandBuilder().setName('musica').setDescription('Reproductor de música de Magelina').setDMPermission(false);
for (const command of subcommands) musicCommand.addSubcommand(command.definition);

export async function executeMusic(context: SlashContext) {
  const command = subcommands.find(entry => entry.definition.name === context.command);
  if (!command) throw new Error('Unknown subcommand');
  const { prepareMusic } = await import('./context.js');
  return command.execute(await prepareMusic(context));
}
