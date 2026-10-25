import { isIP } from 'node:net';

export class ConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'ConfigError'; }
}

function readUrl(value: string, field: string): URL {
  try { return new URL(value); }
  catch { throw new ConfigError(`${field} debe ser una URL valida.`); }
}

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const required = ['MONGODB_URI', 'DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_REDIRECT_URI', 'SESSION_SECRET', 'BOT_OWNER_IDS'];
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length) {
    throw new ConfigError(`Faltan variables de entorno: ${missing.join(', ')}`);
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError('PORT debe ser un entero entre 1 y 65535.');
  }

  const dashboardOrigin = readUrl(env.DASHBOARD_ORIGIN ?? 'http://localhost:5173', 'DASHBOARD_ORIGIN');
  if (!['http:', 'https:'].includes(dashboardOrigin.protocol)) {
    throw new ConfigError('DASHBOARD_ORIGIN debe usar HTTP o HTTPS.');
  }
  if (!/^mongodb(?:\+srv)?:\/\//.test(env.MONGODB_URI!)) {
    throw new ConfigError('MONGODB_URI debe ser una URI de MongoDB.');
  }
  const dnsServers = (env.DNS_SERVERS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (dnsServers.length > 4 || dnsServers.some((value) => isIP(value) === 0)) {
    throw new ConfigError('DNS_SERVERS debe contener hasta cuatro direcciones IP separadas por comas.');
  }

  if (env.SESSION_SECRET!.length < 32) throw new ConfigError('SESSION_SECRET debe tener al menos 32 caracteres.');
  const sessionSecret = env.SESSION_SECRET!;
  if (sessionSecret !== sessionSecret.trim() || [/[A-Z]/g, /[a-z]/g, /[0-9]/g, /[!@#$%^&*()_+\-=\[\]{};':"|,.<>/?]/g].some((pattern) => (sessionSecret.match(pattern)?.length ?? 0) < 2)) {
    throw new ConfigError('SESSION_SECRET debe incluir al menos dos mayusculas, dos minusculas, dos numeros y dos simbolos, sin espacios en los extremos, para cifrar las sesiones.');
  }
  const parseIds = (value = '') => value.split(',').map((id) => id.trim()).filter(Boolean);
  const ownerIds = parseIds(env.BOT_OWNER_IDS);
  const operatorIds = parseIds(env.BOT_OPERATOR_IDS);
  if (!ownerIds.length) throw new ConfigError('BOT_OWNER_IDS debe incluir al menos un propietario.');
  if (![env.DISCORD_CLIENT_ID!, ...ownerIds, ...operatorIds].every((id) => /^\d{17,20}$/.test(id))) {
    throw new ConfigError('Los IDs de Discord deben ser IDs numericos validos.');
  }
  const redirect = readUrl(env.DISCORD_REDIRECT_URI!, 'DISCORD_REDIRECT_URI');
  const production = env.NODE_ENV === 'production';
  const discordTestGuildId = env.DISCORD_TEST_GUILD_ID?.trim() || undefined;
  if (discordTestGuildId && !/^\d{17,20}$/.test(discordTestGuildId)) throw new ConfigError('DISCORD_TEST_GUILD_ID debe ser un ID numerico valido.');
  if (!['http:', 'https:'].includes(redirect.protocol) || (production && (redirect.protocol !== 'https:' || dashboardOrigin.protocol !== 'https:'))) {
    throw new ConfigError('Usa URLs HTTP validas y HTTPS en produccion.');
  }

  return {
    production,
    discordTestGuildId,
    trustProxy: env.TRUST_PROXY === 'true',
    ownerIds,
    operatorIds,
    sessionSecret: env.SESSION_SECRET!,
    discordClientSecret: env.DISCORD_CLIENT_SECRET!,
    discordRedirectUri: redirect.href,
    port,
    dashboardOrigin: dashboardOrigin.origin,
    mongoUri: env.MONGODB_URI!,
    dnsServers,
    discordToken: env.DISCORD_TOKEN!,
    discordClientId: env.DISCORD_CLIENT_ID!,
    audiusApiKey: env.AUDIUS_API_KEY?.trim() || undefined,
  };
}

export type Config = ReturnType<typeof readConfig>;
