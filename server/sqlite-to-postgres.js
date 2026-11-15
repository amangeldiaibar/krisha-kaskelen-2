import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { openDatabase } from './open-db.js';
import { copySqliteToPostgres } from './services/sqliteCopy.js';

// Moves everything from the SQLite file the site used before into PostgreSQL, once.
const file = process.argv[2] || config.sqlitePath;
if (!fs.existsSync(file)) {
  console.error(`No SQLite file at ${file}, so there is nothing to move.`);
  process.exit(1);
}

const sqlite = new DatabaseSync(file, { readOnly: true });
const db = await openDatabase();
try {
  const counts = await copySqliteToPostgres({ sqlite, db });
  for (const [table, count] of Object.entries(counts)) console.log(`${table.padEnd(14)} ${count}`);
  console.log(`Done. The SQLite file at ${file} was left as it was.`);
} catch (error) {
  console.error(`Nothing was copied: ${error.message}`);
  process.exitCode = 1;
} finally {
  sqlite.close();
  await db.close();
}
