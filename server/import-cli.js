import { config } from './config.js';
import { openDb } from './db.js';
import { createDgis } from './services/dgis.js';
import { importListings, parseResult, searchGoogle } from './services/importer.js';

if (!config.serpApiKey) {
  console.error('SERPAPI_KEY is not set. Add it to .env to import public Google results.');
  process.exit(1);
}
const db = openDb(config.dbPath);
const dgis = createDgis({ key: config.dgisKey, db });
const results = await searchGoogle({ apiKey: config.serpApiKey });
for (const result of results) {
  const parsed = parseResult(result);
  console.log(`${parsed ? 'candidate' : 'skipped'}  ${new URL(result.link).hostname}  ${result.title.slice(0, 60)}${parsed ? `  [${parsed.address}, ${parsed.price} KZT]` : ''}`);
}
const { imported, slots } = await importListings({ db, dgis, results });
console.log(`Google results: ${results.length}. Free slots: ${slots}. Imported: ${imported}.`);
