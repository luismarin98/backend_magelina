import { ModerationFollowup } from './database/models/ModerationFollowup.js';
import { getMusicService } from './modules/music/service.js';
import { ModerationCase } from './database/models/ModerationCase.js';
import { GuildRoleBinding } from './database/models/GuildRoleBinding.js';
import { Project } from './database/models/Project.js';
import { CollaborationProfile, Mentorship } from './database/models/Collaboration.js';
import { AutomationRule, AutomationJob } from './database/models/Automation.js';
import { BotControl, SystemEvent } from './database/models/BotControl.js';
import { startAutomationWorker } from './modules/automations/worker.js';
import type { Server } from 'node:http';
import type { Client } from 'discord.js';
import { createInterface } from 'node:readline';
import { readConfig } from './config/env.js';
import { startupErrorMessage } from './config/startup-error.js';
import type { StartupStage } from './config/startup-error.js';
import { connectDatabase, disconnectDatabase } from './database/connection.js';
import { createBot } from './bot/client.js';
import { createApp } from './api/app.js';
import { WorkItem } from './database/models/WorkItem.js';
import { KnowledgeArticle } from './database/models/KnowledgeArticle.js';
import { GuildSettings } from './database/models/GuildSettings.js';
import { GuildPolicy } from './database/models/GuildPolicy.js';

let server: Server | undefined;
let bot: Client | undefined;
let stopping = false;
let stopWorker: (() => Promise<void>) | undefined;
let startupStage: StartupStage = 'configuration';

async function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;

  const deadline = setTimeout(() => process.exit(1), 10000);
  try {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => error ? reject(error) : resolve());
        server!.closeIdleConnections();
      });
    }
    await stopWorker?.();
    if (bot) getMusicService(bot).dispose();
    await bot?.destroy();
    await disconnectDatabase();
  } catch {
    console.error('No se pudo completar el cierre del backend.');
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
  }
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
if (process.env.HOST_PC_CONTROL === 'true') {
  const control = createInterface({ input: process.stdin });
  control.on('line', line => { if (line === 'shutdown') { control.close(); process.stdin.pause(); void shutdown(); } });
  control.once('close', () => { process.stdin.pause(); void shutdown(); });
}

try {
  const config = readConfig();
  bot = createBot(config);
  startupStage = 'mongodb';
  await connectDatabase(config.mongoUri, config.dnsServers);
  startupStage = 'indexes';
  await WorkItem.init(); // Crea y verifica el indice unico antes de aceptar solicitudes.
  await KnowledgeArticle.init();
  await GuildSettings.init();
  await GuildPolicy.init();
  await GuildRoleBinding.init();
  await ModerationCase.init();
  await ModerationFollowup.init();
  await Promise.all([Project.init(), CollaborationProfile.init(), Mentorship.init(), AutomationRule.init(), AutomationJob.init(), BotControl.init(), SystemEvent.init()]);
  startupStage = 'discord';
  if (!stopping) await bot.login(config.discordToken);
  if (!stopping) {
    startupStage = 'http';
    const app = createApp({ config, bot, isStopping: () => stopping });
    await new Promise<void>((resolve, reject) => {
      server = app.listen(config.port, config.bindHost, () => resolve());
      server.once('error', reject);
    });
    server!.on('error', () => {
      console.error('Error del servidor HTTP.');
      void shutdown(1);
    });
    stopWorker = startAutomationWorker(bot);
    getMusicService(bot, config.audiusApiKey).startMaintenance(bot);
    console.info(`API disponible en el puerto ${config.port}.`);
  }
} catch (cause) {
  console.error(startupErrorMessage(startupStage, cause));
  await shutdown(1);
}
