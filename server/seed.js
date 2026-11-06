import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hashPassword } from './auth.js';
import { config } from './config.js';
import { openDb, transaction } from './db.js';
import { createDgis } from './services/dgis.js';

export const DEMO_PASSWORD = 'demo-password';

const TEST_LISTINGS = [
  { title: '2-комнатная квартира рядом с SDU', deal: 'rent', price: 180000, rooms: 2, area: 54, floor: 5, floors: 9, year: 2019, district: 'near_sdu', address: 'проспект Абылай хана, 1/2', phone: '+7 700 000 00 00',
    description: 'Светлая квартира с ремонтом, мебелью и техникой. Университет SDU совсем рядом. Тихий двор, поблизости есть магазины и аптека.' },
  { title: '3-комнатная квартира в центре на продажу', deal: 'buy', price: 28500000, rooms: 3, area: 78, floor: 2, floors: 5, year: 2015, district: 'center', address: 'улица Наурызбай батыра, 17', phone: '+7 700 000 00 00',
    description: 'Просторная квартира в центре Каскелена. Рядом остановка, рынок и кафе.' },
  { title: 'Студия в новом районе', deal: 'rent', price: 95000, rooms: 0, area: 24, floor: 9, floors: 12, year: 2023, district: 'new', address: 'улица Жибек жолы, 20', phone: '+7 700 000 00 00',
    description: 'Небольшая студия в новом доме. Подойдёт одному студенту.' },
];

// Found through a public web search on 2026-11-02. Only the published text is
// kept. Phones are left out and the source page holds the contact details.
const IMPORTED_LISTINGS = [
  { title: '2-комнатная квартира, 48 м², 4/5 этаж помесячно, Квартал 9, 43 (СДУ)', price: 130000, rooms: 2, area: 48, floor: 4, floors: 5, address: '9-й квартал, 43', source_name: 'domler.kz',
    source_url: 'https://domler.kz/en/kaskelen/arenda/kvartiry/2-komnatnaja/2-komnatnaja-kvartira-48-m2-45-etazh-pomesachno-kvartal9-43-sdu-301012.html' },
  { title: '1-комнатная квартира, 30 м², 1 этаж помесячно, Баталы 25 (район СДУ)', price: 110000, rooms: 1, area: 30, floor: 1, floors: 1, address: 'Баталы, 25', source_name: 'domler.kz',
    source_url: 'https://domler.kz/en/kaskelen/arenda/kvartiry/1-komnatnaja/1-komnatnaja-kvartira-30-m2-1-etazh-pomesachno-bataly-25-rajon-sdu-301239.html' },
];

const SEED_PHOTOS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'seed-photos');

// Stock pictures for the test ads only. The UI marks them as examples, and real
// imported apartments never get them because that would misrepresent the property.
const SEED_PHOTOS = {
  '2-комнатная квартира рядом с SDU': ['two-room-living', 'two-room-kitchen', 'two-room-bedroom'],
  '3-комнатная квартира в центре на продажу': ['sale-living', 'sale-dining', 'sale-lounge'],
  'Студия в новом районе': ['studio-main', 'studio-corner', 'studio-view'],
};

/** Adds example photos to test ads that have none. Safe to run on every start. */
export function attachSeedPhotos({ db, uploadsDir }) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const find = db.prepare(
    `SELECT listings.id FROM listings
     WHERE source_type = 'test' AND title = ?
       AND NOT EXISTS (SELECT 1 FROM photos WHERE photos.listing_id = listings.id)`,
  );
  const add = db.prepare('INSERT INTO photos (listing_id, filename, mime, position) VALUES (?, ?, ?, ?)');
  for (const [title, names] of Object.entries(SEED_PHOTOS)) {
    const listing = find.get(title);
    if (!listing) continue;
    names.forEach((name, position) => {
      const filename = `seed-${listing.id}-${name}.jpg`;
      fs.copyFileSync(path.join(SEED_PHOTOS_DIR, `${name}.jpg`), path.join(uploadsDir, filename));
      add.run(listing.id, filename, 'image/jpeg', position);
    });
  }
}

async function point(dgis, address) {
  try {
    return (await dgis.geocode(address)) ?? { lat: null, lon: null };
  } catch (error) {
    console.warn(`Could not geocode "${address}": ${error.message}`);
    return { lat: null, lon: null };
  }
}

/** Fills an empty database. Seed rows skip AI moderation because they are fixed test data. */
export async function seed({ db, dgis, allowDemoAccounts }) {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM listings').get();
  if (count > 0) return false;

  const password = await hashPassword(allowDemoAccounts ? DEMO_PASSWORD : crypto.randomBytes(24).toString('hex'));
  const located = await Promise.all(
    [...TEST_LISTINGS, ...IMPORTED_LISTINGS].map((item) => point(dgis, item.address)),
  );

  transaction(db, () => {
    const addUser = db.prepare('INSERT INTO users (name, phone, email, password_hash) VALUES (?, ?, ?, ?)');
    const ownerId = Number(addUser.run('Тестовый владелец', '+7 700 000 00 00', 'owner@example.com', password).lastInsertRowid);
    const tenantId = Number(addUser.run('Тестовый жилец', '+7 701 000 00 00', 'tenant@example.com', password).lastInsertRowid);

    const add = db.prepare(
      `INSERT INTO listings (user_id, source_type, source_name, source_url, title, deal, price, rooms, area, floor, floors, year, district, address, description, phone, lat, lon, status, moderation_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', 'seed')`,
    );
    let firstId = null;
    TEST_LISTINGS.forEach((item, index) => {
      const { lat, lon } = located[index];
      const id = Number(
        add.run(ownerId, 'test', null, null, item.title, item.deal, item.price, item.rooms, item.area, item.floor, item.floors, item.year, item.district, item.address, item.description, item.phone, lat, lon).lastInsertRowid,
      );
      firstId ??= id;
    });
    IMPORTED_LISTINGS.forEach((item, index) => {
      const { lat, lon } = located[TEST_LISTINGS.length + index];
      add.run(null, 'import', item.source_name, item.source_url, item.title, 'rent', item.price, item.rooms, item.area, item.floor, item.floors, null, 'near_sdu', item.address, item.title, null, lat, lon);
    });
    db.prepare(`INSERT INTO reviews (listing_id, user_id, text, status, moderation_reason) VALUES (?, ?, ?, 'approved', 'seed')`).run(
      firstId,
      tenantId,
      'Зимой тепло, владелец быстро решает проблемы. Соседи тихие.',
    );
  });
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const db = openDb(config.dbPath);
  const dgis = createDgis({ key: config.dgisKey, db });
  const created = await seed({ db, dgis, allowDemoAccounts: !config.isProduction });
  attachSeedPhotos({ db, uploadsDir: config.uploadsDir });
  console.log(created ? 'Seed data created.' : 'Database already has listings. Nothing changed.');
}
