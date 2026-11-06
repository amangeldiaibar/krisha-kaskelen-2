import fs from 'node:fs';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { config } from './config.js';

export function readSession() {
  try {
    return fs.readFileSync(config.telegram.sessionPath, 'utf8').trim();
  } catch {
    return '';
  }
}

export function createClient(session = readSession()) {
  const { apiId, apiHash } = config.telegram;
  if (!apiId || !apiHash) {
    console.error('Set TELEGRAM_API_ID and TELEGRAM_API_HASH in .env first.');
    process.exit(1);
  }
  const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 3 });
  client.setLogLevel('error');
  return client;
}
