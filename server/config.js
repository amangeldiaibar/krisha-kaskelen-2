import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  process.loadEnvFile(path.join(root, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const dataDir = process.env.DATA_DIR || path.join(root, 'data');

const DEFAULT_GEMINI_MODEL = 'gemini-flash-lite-latest';
// The PostgreSQL server that `npm run db` starts. It accepts connections only from this computer.
const LOCAL_DATABASE_URL = 'postgres://krisha:krisha@localhost:54329/krisha';

export const config = {
  root,
  dataDir,
  databaseUrl: process.env.DATABASE_URL || LOCAL_DATABASE_URL,
  usesLocalDatabase: !process.env.DATABASE_URL,
  localDatabaseDir: path.join(dataDir, 'postgres'),
  // The SQLite file the site used before PostgreSQL. Only the one-time data move reads it.
  sqlitePath: path.join(dataDir, 'app.db'),
  uploadsDir: path.join(dataDir, 'uploads'),
  port: Number(process.env.PORT || 3000),
  isProduction: process.env.NODE_ENV === 'production',
  dgisKey: process.env.DGIS_API_KEY || '',
  geminiKey: process.env.GEMINI_API_KEY || '',
  moderationModel: process.env.MODERATION_MODEL || DEFAULT_GEMINI_MODEL,
  telegram: {
    apiId: Number(process.env.TELEGRAM_API_ID || 0),
    apiHash: process.env.TELEGRAM_API_HASH || '',
    phone: process.env.TELEGRAM_PHONE || '',
    channels: (process.env.TELEGRAM_CHANNELS || '').split(',').map((name) => name.trim().replace(/^@/, '')).filter(Boolean),
    sessionPath: path.join(dataDir, 'telegram.session'),
  },
};

export const SDU = { name: 'SDU University', lat: 43.207176, lon: 76.66967 };
