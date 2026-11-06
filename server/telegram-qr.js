import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import qrcode from 'qrcode-terminal';
import { config } from './config.js';
import { createClient } from './telegram-client.js';

const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
const client = createClient();
await client.connect();

console.log('In the Telegram app on your phone, open Settings, Devices, Link Desktop Device, and scan this code.');

await client.signInUserWithQrCode(
  { apiId: config.telegram.apiId, apiHash: config.telegram.apiHash },
  {
    qrCode: async ({ token }) => {
      qrcode.generate(`tg://login?token=${token.toString('base64url')}`, { small: true });
      console.log('The code refreshes by itself. Waiting for the scan...');
    },
    password: async () => prompt.question('Two-step verification password: '),
    onError: async (error) => {
      console.error(`Login error: ${error.message}`);
      return true;
    },
  },
);

fs.mkdirSync(path.dirname(config.telegram.sessionPath), { recursive: true });
fs.writeFileSync(config.telegram.sessionPath, client.session.save(), { mode: 0o600 });
prompt.close();
await client.disconnect();
console.log('Logged in. Now run: npm run import:telegram');
process.exit(0);
