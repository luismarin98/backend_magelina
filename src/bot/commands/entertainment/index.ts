import { SlashCommandBuilder } from 'discord.js';
import * as trivia from './trivia.js';
import * as ppt from './ppt.js';
import * as adivina from './adivina.js';

export const subcommands = [trivia, ppt, adivina] as const;
export const gamesCommand = new SlashCommandBuilder().setName('jugar').setDescription('Minijuegos interactivos con Magelina').setDMPermission(false);
for (const command of subcommands) gamesCommand.addSubcommand(command.definition);
