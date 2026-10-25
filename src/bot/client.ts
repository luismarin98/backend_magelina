import { Client, Events, GatewayIntentBits } from 'discord.js';
import { createInteractionHandler } from './handler.js';
import type { Config } from '../config/env.js';
import { logEvent } from '../modules/operations/service.js';
import { logRecord, observeDiscordRest, traceOperation } from '../observability/logging.js';

export function createBot(config: Pick<Config, 'ownerIds' | 'dashboardOrigin'>) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  observeDiscordRest(client.rest);
  const handleInteraction = createInteractionHandler(config);

  client.once(Events.ClientReady, (readyClient) => {
    console.info(`Bot conectado como ${readyClient.user.tag}.`);
    logRecord('bot.ready');
  });

  client.on(Events.Error, () => {
    console.error('El cliente de Discord ha informado un error.');
    void logEvent('discord.error', 'El cliente de Discord ha informado un error.');
  });

  client.on(Events.InteractionCreate, (interaction) => {
    traceOperation(() => {
      const start = performance.now();
      const command = interaction.isCommand() ? interaction.commandName : interaction.isModalSubmit() ? 'modal' : 'component';
      const fields = { command, guildId: interaction.guildId };
      logRecord('bot.interaction.start', fields);
      void handleInteraction(interaction)
        .then(() => logRecord('bot.interaction.end', { ...fields, durationMs: Math.round(performance.now() - start), outcome: 'completed' }))
        .catch(() => logRecord('bot.interaction.end', { ...fields, durationMs: Math.round(performance.now() - start), outcome: 'failed' }));
    });
  });
  client.on(Events.ShardDisconnect, () => logRecord('bot.gateway.disconnected'));
  client.on(Events.ShardReconnecting, () => logRecord('bot.gateway.reconnecting'));
  return client;
}
