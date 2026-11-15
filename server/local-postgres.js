import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

/** The same server, but its built-in `postgres` database, which always exists. */
const adminUrl = (url) => Object.assign(new URL(url), { pathname: '/postgres' }).href;

async function answers(url) {
  const client = new pg.Client({ connectionString: adminUrl(url) });
  try {
    await client.connect();
    return true;
  } catch (error) {
    if (error.code === 'ECONNREFUSED') return false;
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Runs a real PostgreSQL server from the embedded-postgres package, with its
 * files in `dir`, and creates the database named in `url`. A server already
 * answering on that port is reused. `stop` only stops a server started here.
 */
export async function startLocalPostgres({ url, dir, log = () => {} }) {
  const { port, username, password, pathname } = new URL(url);
  const database = decodeURIComponent(pathname.slice(1));
  let stop = async () => {};
  const reused = await answers(url);
  if (!reused) {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    const server = new EmbeddedPostgres({
      databaseDir: dir,
      port: Number(port),
      user: decodeURIComponent(username),
      password: decodeURIComponent(password),
      persistent: true,
      onLog: () => {},
      onError: (error) => log(String(error).trim()),
    });
    if (!fs.existsSync(path.join(dir, 'PG_VERSION'))) {
      log('Creating the PostgreSQL data folder. The first time this takes up to a minute.');
      await server.initialise();
    }
    await server.start();
    stop = () => server.stop();
  }
  const client = new pg.Client({ connectionString: adminUrl(url) });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (rowCount === 0) await client.query(`CREATE DATABASE ${pg.escapeIdentifier(database)}`);
  } finally {
    await client.end();
  }
  return { reused, stop };
}
