import { REST } from 'discord.js';
import { observeDiscordRest } from '../src/observability/logging.js';
import { commandDefinitions, commandTarget } from '../src/bot/registration.js';

// El mismo destino que el Centro de control: global en producción, gremio de pruebas en desarrollo.
const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_TEST_GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !/^\d{17,20}$/.test(DISCORD_CLIENT_ID ?? '')) {
  throw new Error('Configura DISCORD_TOKEN y DISCORD_CLIENT_ID.');
}
const target = commandTarget({ production: process.env.NODE_ENV === 'production', discordClientId: DISCORD_CLIENT_ID!, discordTestGuildId: DISCORD_TEST_GUILD_ID?.trim() });
const rest = observeDiscordRest(new REST({ version: '10' }).setToken(DISCORD_TOKEN));
try {
  for (const command of commandDefinitions) {
    await rest.post(target.route, { body: command });
    console.info(`Comando ${command.name} registrado: ${target.scope}.`);
  }
} catch {
  console.error('No se pudo registrar el comando. Revisa la aplicación y el destino configurado.');
  process.exitCode = 1;
}
