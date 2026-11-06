import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { config } from './config.js';
import { createClient } from './telegram-client.js';

const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
const client = createClient();

await client.start({
  phoneNumber: async () => config.telegram.phone || prompt.question('Phone number: '),
  phoneCode: async () => prompt.question('Code from Telegram: '),
  password: async () => prompt.question('Two-step verification password: '),
  onError: (error) => console.error(`Login error: ${error.message}`),
});

fs.mkdirSync(path.dirname(config.telegram.sessionPath), { recursive: true });
fs.writeFileSync(config.telegram.sessionPath, client.session.save(), { mode: 0o600 });
prompt.close();
await client.disconnect();
console.log('Logged in. Now run: npm run import:telegram');
process.exit(0);
