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

export const config = {
  root,
  dataDir,
  dbPath: path.join(dataDir, 'app.db'),
  uploadsDir: path.join(dataDir, 'uploads'),
  port: Number(process.env.PORT || 3000),
  isProduction: process.env.NODE_ENV === 'production',
  dgisKey: process.env.DGIS_API_KEY || '',
  // Gemini has a free tier, so a Gemini key takes priority over a Claude key.
  geminiKey: process.env.GEMINI_API_KEY || '',
  moderationProvider: process.env.GEMINI_API_KEY ? 'gemini' : process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? 'claude' : null,
  moderationModel: process.env.MODERATION_MODEL || (process.env.GEMINI_API_KEY ? DEFAULT_GEMINI_MODEL : 'claude-opus-5-5'),
  serpApiKey: process.env.SERPAPI_KEY || '',
  telegram: {
    apiId: Number(process.env.TELEGRAM_API_ID || 0),
    apiHash: process.env.TELEGRAM_API_HASH || '',
    phone: process.env.TELEGRAM_PHONE || '',
    channels: (process.env.TELEGRAM_CHANNELS || '').split(',').map((name) => name.trim().replace(/^@/, '')).filter(Boolean),
    sessionPath: path.join(dataDir, 'telegram.session'),
  },
};

export const SDU = { name: 'SDU University', lat: 43.207176, lon: 76.66967 };
