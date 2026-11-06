import path from 'node:path';
import { config } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { attachSeedPhotos, seed } from './seed.js';
import { createDgis } from './services/dgis.js';
import { createGeminiModerator, createModerator, createUncheckedModerator } from './services/moderation.js';
import { createWorker } from './services/worker.js';

const WORKER_INTERVAL_MS = 30_000;

if (!config.dgisKey) console.warn('DGIS_API_KEY is not set. Maps, addresses and 2GIS reviews will not work.');
if (config.moderationProvider) {
  console.log(`AI moderation: ${config.moderationProvider}, model ${config.moderationModel}.`);
} else {
  console.warn(
    config.isProduction
      ? 'No AI key is set. New listings and reviews stay pending until one is added.'
      : 'No AI key is set. New listings and reviews are published WITHOUT an AI check.',
  );
}

const db = openDb(config.dbPath);
const dgis = createDgis({ key: config.dgisKey, db });
await seed({ db, dgis, allowDemoAccounts: !config.isProduction });
attachSeedPhotos({ db, uploadsDir: config.uploadsDir });

const { moderationModel: model, uploadsDir } = config;
let moderator = null;
if (config.moderationProvider === 'gemini') {
  moderator = createGeminiModerator({ apiKey: config.geminiKey, model, uploadsDir });
} else if (config.moderationProvider === 'claude') {
  moderator = createModerator({ model, uploadsDir });
} else if (!config.isProduction) {
  moderator = createUncheckedModerator();
}
const worker = createWorker({ db, dgis, moderator });
const runWorker = () => worker.tick().catch((error) => console.error(error));

const app = createApp({
  db,
  dgis,
  uploadsDir: config.uploadsDir,
  clientDist: path.join(config.root, 'client/dist'),
  secureCookies: config.isProduction,
  onContentChanged: runWorker,
});

setInterval(runWorker, WORKER_INTERVAL_MS).unref();
runWorker();
app.listen(config.port, (error) => {
  if (error) {
    console.error(
      error.code === 'EADDRINUSE'
        ? `Port ${config.port} is busy. Stop the other server or set PORT in .env.`
        : error,
    );
    process.exit(1);
  }
  console.log(`Krisha Kaskelen is running: http://localhost:${config.port}`);
});
