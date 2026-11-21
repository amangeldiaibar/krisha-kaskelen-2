import fs from 'node:fs';
import path from 'node:path';
import { addListingPhotos } from './importer.js';
import { cleanPost } from './telegram.js';

const MAX_PHOTOS = 10;

/** Reads RFC 4180 CSV, including quoted fields with commas and line breaks. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header = [], ...data] = rows.filter((cells) => cells.some((cell) => cell.trim()));
  return data.map((cells) => Object.fromEntries(header.map((name, index) => [name.trim(), cells[index] ?? ''])));
}

const number = (value) => {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/** Where the seller line and krisha.kz buttons start in a search card's text. */
const CARD_TAIL = /\s(?:Хозяин недвижимости|Специалист|Агент|Риелтор|Застройщик|Каскелен\s+\d{1,2}\s|В Избранное)/;

/** Rewrites a row exported by KrishaParser (house-pricer) into the columns of the old CSV. */
export function fromHousePricer(row) {
  const card = String(row.description ?? '').replace(/\s+/g, ' ').trim();
  const priceAt = card.search(/\s[\d\s]+₸/);
  const title = priceAt > 0 ? card.slice(0, priceAt) : '';
  const address = String(row.address ?? '').trim();
  let rest = card.replace(/^.*?₸\s*(?:за\s+(?:месяц|сутки))?\s*/, '');
  if (address && rest.startsWith(address)) rest = rest.slice(address.length);
  const tail = rest.search(CARD_TAIL);
  return {
    id: row.id,
    url: row.url,
    title,
    price: row.price_kzt,
    price_raw: row.rent_period === 'month' ? 'за месяц' : row.rent_period === 'day' ? 'за сутки' : '',
    address,
    description: (tail >= 0 ? rest.slice(0, tail) : rest).trim() || title,
  };
}

/** Turns one row of the krisha.kz CSV into a listing, or null when it is unusable. */
export function rowToListing(input) {
  const row = 'price_kzt' in input ? fromHousePricer(input) : input;
  const id = String(row.id ?? '').trim();
  const url = String(row.url ?? '').trim();
  if (!/^\d+$/.test(id) || !/^https:\/\/krisha\.kz\/a\/show\/\d+/.test(url)) return null;

  const title = String(row.title ?? '').replace(/\s+/g, ' ').trim();
  const priceRaw = String(row.price_raw ?? '');
  const rooms = title.match(/(\d+)\s*-?\s*комнатн/i);
  const area = title.match(/([\d.,]+)\s*м²/);
  const floor = title.match(/(\d+)\s*\/\s*(\d+)\s*этаж/) ?? title.match(/(\d+)\s*этаж/);
  const fullAddress = String(row.address ?? '').replace(/^\s*Каскелен\s*,?\s*/i, '').trim();
  const street = fullAddress.split('—')[0].trim();

  return {
    krishaId: id,
    title: (title || `Объявление ${id}`).slice(0, 120),
    deal: /мес|сутк|аренд/i.test(`${priceRaw} ${url}`) ? 'rent' : 'buy',
    price: number(row.price) === null ? null : Math.round(number(row.price)),
    rooms: rooms ? Math.min(Number(rooms[1]), 4) : /студи/i.test(title) ? 0 : null,
    area: area ? number(area[1]) : null,
    floor: floor ? Number(floor[1]) : null,
    floors: floor && floor[2] ? Number(floor[2]) : null,
    address: (fullAddress || 'Каскелен').slice(0, 200),
    street,
    description: cleanPost(row.description || title).slice(0, 5000) || title,
    sourceUrl: url.split('?')[0],
  };
}

/** Photo files the parser saved for one ad, in their numbered order. */
export function photoFiles(photosDir, krishaId) {
  const folder = path.join(photosDir, krishaId);
  if (!fs.existsSync(folder)) return [];
  return fs
    .readdirSync(folder)
    .filter((name) => /^\d+\.(?:jpe?g|png|webp)$/i.test(name))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .slice(0, MAX_PHOTOS)
    .map((name) => path.join(folder, name));
}

/** Ads that a new krisha.kz file replaces. Telegram ads and ads people posted stay. */
const REPLACED = `source_type = 'test' OR (source_type = 'import' AND source_name = 'krisha.kz')`;

/** Replaces earlier krisha.kz ads and test ads with the ads from the parser's file. */
export async function importKrisha({ db, rows, photosDir, uploadsDir, geocode }) {
  const listings = [];
  const seen = new Set();
  for (const row of rows) {
    const listing = rowToListing(row);
    if (!listing || seen.has(listing.sourceUrl)) continue;
    seen.add(listing.sourceUrl);
    let point = null;
    if (listing.street) {
      try {
        point = await geocode(listing.street, { approximate: true });
      } catch {
        point = null;
      }
    }
    listings.push({ ...listing, lat: point?.lat ?? null, lon: point?.lon ?? null });
  }
  if (listings.length === 0) return { imported: 0, removed: 0, photos: 0 };

  const oldFiles = await db.all(`SELECT photos.filename FROM photos JOIN listings ON listings.id = photos.listing_id WHERE ${REPLACED}`);
  const inserted = await db.transaction(async (tx) => {
    const removed = await tx.run(`DELETE FROM listings WHERE ${REPLACED}`);
    const ids = [];
    for (const item of listings) {
      const { id } = await tx.get(
        `INSERT INTO listings (source_type, source_name, source_url, title, deal, price, rooms, area, floor, floors, address, description, lat, lon, status)
         VALUES ('import', 'krisha.kz', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending') RETURNING id`,
        [item.sourceUrl, item.title, item.deal, item.price, item.rooms, item.area, item.floor, item.floors, item.address, item.description, item.lat, item.lon],
      );
      ids.push(id);
    }
    return { removed, ids };
  });
  for (const { filename } of oldFiles) fs.rmSync(path.join(uploadsDir, filename), { force: true });

  let photos = 0;
  for (const [index, item] of listings.entries()) {
    const buffers = photoFiles(photosDir, item.krishaId).map((file) => fs.readFileSync(file));
    photos += await addListingPhotos({ db, listingId: inserted.ids[index], buffers, uploadsDir });
  }
  return { imported: listings.length, removed: inserted.removed, photos };
}
