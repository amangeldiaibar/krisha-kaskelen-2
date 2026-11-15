import pg from 'pg';
import { TABLES } from '../db.js';

// SQLite stored these in UTC without a time zone, as "2026-11-06 22:35:55".
const TIME_COLUMNS = new Set(['created_at', 'updated_at']);
const toValue = (column, value) => (TIME_COLUMNS.has(column) && typeof value === 'string' ? `${value.replace(' ', 'T')}Z` : value);
const quote = (name) => pg.escapeIdentifier(name);

/**
 * Copies every table from the SQLite database the site used before into an
 * empty PostgreSQL database, keeping ids. Returns the row count per table.
 */
export async function copySqliteToPostgres({ sqlite, db }) {
  const { n } = await db.get('SELECT (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM listings) AS n');
  if (n > 0) throw new Error('PostgreSQL already has users or ads. The copy is meant for an empty database.');

  return db.transaction(async (tx) => {
    const copied = {};
    for (const table of TABLES) {
      if (!sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table)) continue;
      const target = new Set(
        (await tx.all('SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1', [table])).map((row) => row.column_name),
      );
      // Only columns both databases have. An older file may lack newer ones, such as the profile photo.
      const columns = sqlite.prepare(`PRAGMA table_info(${quote(table)})`).all().map((column) => column.name).filter((name) => target.has(name));
      const rows = sqlite.prepare(`SELECT ${columns.map(quote).join(', ')} FROM ${quote(table)}`).all();
      const insert = `INSERT INTO ${quote(table)} (${columns.map(quote).join(', ')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})`;
      for (const row of rows) await tx.run(insert, columns.map((column) => toValue(column, row[column])));
      // New rows must get ids after the copied ones.
      if (target.has('id')) await tx.get(`SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE(MAX(id), 0) + 1, false) FROM ${quote(table)}`, [table]);
      copied[table] = rows.length;
    }
    return copied;
  });
}
