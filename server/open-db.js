import { config } from './config.js';
import { connectDb } from './db.js';

/** Opens the site's database, or explains how to start it and exits. */
export async function openDatabase({ waitMs = 10_000 } = {}) {
  try {
    return await connectDb(config.databaseUrl, { waitMs, onWait: () => console.log('Waiting for PostgreSQL to start...') });
  } catch (error) {
    console.error(`Cannot reach PostgreSQL: ${error.message}`);
    console.error(config.usesLocalDatabase ? 'Start the local database in another terminal: npm run db' : 'Check DATABASE_URL in .env.');
    process.exit(1);
  }
}
