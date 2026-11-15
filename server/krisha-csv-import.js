import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { openDatabase } from './open-db.js';
import { createDgis } from './services/dgis.js';
import { importKrisha, parseCsv } from './services/krishaCsv.js';

const csvPath = path.resolve(config.root, process.argv[2] || 'krisha_kaskelen.csv');
const photosDir = path.resolve(config.root, process.argv[3] || 'photos');

if (!fs.existsSync(csvPath)) {
  console.error(`No file at ${csvPath}. Run your parser first, so it creates krisha_kaskelen.csv and the photos folder.`);
  process.exit(1);
}

const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
const db = await openDatabase();
const dgis = createDgis({ key: config.dgisKey, db });
const result = await importKrisha({ db, rows, photosDir, uploadsDir: config.uploadsDir, geocode: dgis.geocode });
console.log(`Rows: ${rows.length}. Imported: ${result.imported}. Earlier krisha.kz and test ads removed: ${result.removed}. Photos: ${result.photos}.`);
if (result.imported === 0) console.log('Nothing usable was found, so the site was left as it was.');
else console.log('The ads go through AI moderation and appear on the site after it, a few at a time.');
await db.close();
