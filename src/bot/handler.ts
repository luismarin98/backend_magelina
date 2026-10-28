import { withLanguage } from '../i18n/index.js';
import type { Interaction } from 'discord.js';
import type { Config } from '../config/env.js';
import { commandsByKey, commandKey } from './commands/registry.js';
import { handleWorkflow } from './workflow.js';
import { handleSlash } from './slash.js';
import { handleInteractive } from './interactive.js';
import { handleGames } from './games.js';

type Handler = (interaction: Interaction) => Promise<unknown>;
export type InteractionHandlers = Record<'workflow' | 'slash' | 'interactive' | 'games', Handler>;

export function interactionRoute(interaction: Interaction): keyof InteractionHandlers | undefined {
  if (interaction.isCommand()) {
    return commandsByKey.get(commandKey(interaction.commandType, interaction.commandName))?.handler;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('request:')) return 'workflow';
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('mgl:')) return 'interactive';
  if (interaction.isButton() && interaction.customId.startsWith('game:')) return 'games';
  return undefined;
}

export async function dispatchInteraction(interaction: Interaction, handlers: InteractionHandlers) {
  const route = interactionRoute(interaction);
  if (!route) return false;
  await withLanguage(interaction.locale ?? interaction.guildLocale, () => handlers[route](interaction));
  return true;
}

export function createInteractionHandler(config: Pick<Config, 'ownerIds' | 'dashboardOrigin'>) {
  const handlers: InteractionHandlers = {
    workflow: handleWorkflow,
    slash: interaction => handleSlash(interaction, config),
    interactive: interaction => handleInteractive(interaction, config),
    games: interaction => handleGames(interaction),
  };
  return (interaction: Interaction) => dispatchInteraction(interaction, handlers);
}
