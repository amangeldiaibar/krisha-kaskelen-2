import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { openDatabase } from './open-db.js';
import { createDgis } from './services/dgis.js';
import { importKrisha, parseCsv } from './services/krishaCsv.js';

/** KrishaParser folders: the copy in this project and the clone in data/house-pricer. */
const PARSER_DIRS = ['KrishaParser', 'data/house-pricer/KrishaParser'].map((dir) => path.resolve(config.root, dir, 'data'));

/** The newest listings_*.csv that `python -m krisha export` wrote, with its photos folder. */
function latestExport() {
  const found = PARSER_DIRS.flatMap((dataDir) => {
    const exports = path.join(dataDir, 'exports');
    if (!fs.existsSync(exports)) return [];
    return fs
      .readdirSync(exports)
      .filter((name) => /^listings_.*\.csv$/.test(name))
      .map((name) => ({ csv: path.join(exports, name), photos: path.join(dataDir, 'photos') }));
  });
  return found.sort((a, b) => fs.statSync(b.csv).mtimeMs - fs.statSync(a.csv).mtimeMs)[0];
}

const source = process.argv[2]
  ? { csv: path.resolve(process.argv[2]), photos: path.resolve(process.argv[3] || path.join(path.dirname(process.argv[2]), '..', 'photos')) }
  : latestExport();

if (!source || !fs.existsSync(source.csv)) {
  console.error('No KrishaParser export found. In KrishaParser run: python -m krisha crawl --city kaskelen, then photos, then export.');
  process.exit(1);
}

const rows = parseCsv(fs.readFileSync(source.csv, 'utf8'));
const db = await openDatabase();
const dgis = createDgis({ key: config.dgisKey, db });
const result = await importKrisha({ db, rows, photosDir: source.photos, uploadsDir: config.uploadsDir, geocode: dgis.geocode });
console.log(`File: ${source.csv}`);
console.log(`Rows: ${rows.length}. New: ${result.imported}. Updated: ${result.updated}. Removed (gone from krisha.kz, or test ads): ${result.removed}. Photos: ${result.photos}.`);
if (result.imported + result.updated === 0) console.log('Nothing usable was found, so the site was left as it was.');
else if (result.imported > 0) console.log('New ads go through AI moderation and appear on the site after it, a few at a time.');
await db.close();
