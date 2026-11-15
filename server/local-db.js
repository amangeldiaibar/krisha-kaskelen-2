import { config } from './config.js';
import { startLocalPostgres } from './local-postgres.js';

if (!config.usesLocalDatabase) {
  console.log('DATABASE_URL is set, so the site uses that database and the local one is not started.');
  process.exit(0);
}

const { reused } = await startLocalPostgres({ url: config.databaseUrl, dir: config.localDatabaseDir, log: console.log });
const where = new URL(config.databaseUrl);
if (reused) {
  console.log(`PostgreSQL is already running on port ${where.port}.`);
  process.exit(0);
}
// The embedded-postgres package stops the server when this process exits, for example on Ctrl+C.
console.log(`PostgreSQL is running on port ${where.port}, database "${where.pathname.slice(1)}". Press Ctrl+C to stop it.`);
