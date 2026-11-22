import path from 'node:path';
import { config } from './config.js';
import { openDatabase } from './open-db.js';
import { createApp } from './app.js';
import { createDgis } from './services/dgis.js';
import { createMailer } from './services/mail.js';
import { createSms } from './services/sms.js';
import { createGeminiModerator, createUncheckedModerator } from './services/moderation.js';
import { createSearchParser } from './services/search.js';
import { createWorker } from './services/worker.js';

const WORKER_INTERVAL_MS = 30_000;

if (!config.dgisKey) console.warn('DGIS_API_KEY is not set. Maps, addresses and 2GIS reviews will not work.');
if (config.geminiKey) {
  console.log(`AI moderation: Gemini, model ${config.moderationModel}.`);
} else {
  console.warn(
    config.isProduction
      ? 'No AI key is set. New listings and reviews stay pending until one is added.'
      : 'No AI key is set. New listings and reviews are published WITHOUT an AI check.',
  );
}

if (config.isProduction && config.usesLocalDatabase) {
  console.error('Set DATABASE_URL in production. The local database is only for development.');
  process.exit(1);
}
// The very first local start creates the database files, which takes up to a minute.
const db = await openDatabase({ waitMs: config.usesLocalDatabase ? 180_000 : 30_000 });
const dgis = createDgis({ key: config.dgisKey, db });

const { moderationModel: model, uploadsDir } = config;
let moderator = null;
if (config.geminiKey) {
  moderator = createGeminiModerator({ apiKey: config.geminiKey, model, uploadsDir });
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
  // Without a key, search phrases are read by plain rules.
  searchParser: createSearchParser({ apiKey: config.geminiKey, model }),
  secureCookies: config.isProduction,
  onContentChanged: runWorker,
  mailer: createMailer({ smtpUrl: config.smtpUrl, from: config.mailFrom }),
  sms: createSms({ apiKey: config.mobizonKey, apiUrl: config.mobizonUrl }),
  publicUrl: config.publicUrl || `http://localhost:${config.port}`,
});
if (config.isProduction && !config.publicUrl) console.warn('Set PUBLIC_URL, so links in password reset letters point to the site.');
if (!config.smtpUrl) console.log('Password reset letters are printed here, because SMTP_URL is not set.');
if (!config.mobizonKey) console.log('Phone confirmation codes are printed here, because MOBIZON_API_KEY is not set.');

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
