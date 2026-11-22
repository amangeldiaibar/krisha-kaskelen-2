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

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'ма', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/**
 * The date krisha.kz shows on a search card ("Каскелен 22 нояб."), which moves when the
 * owner updates or raises the ad. The card has no year, so a date ahead of now is last year's.
 */
export function cardDate(card, now = new Date()) {
  const match = String(card ?? '').match(/Каскелен\s+(\d{1,2})\s+([а-я]+)/i);
  if (!match) return null;
  const month = MONTHS.findIndex((name) => match[2].toLowerCase().startsWith(name));
  if (month < 0) return null;
  const date = new Date(now.getFullYear(), month, Number(match[1]));
  if (date > now) date.setFullYear(date.getFullYear() - 1);
  return date;
}

/** Rewrites a row exported by KrishaParser (house-pricer) into the columns of the old CSV. */
export function fromHousePricer(row) {
  const card = String(row.description ?? '').replace(/\s+/g, ' ').trim();
  const priceAt = card.search(/\s[\d\s]+₸/);
  const head = priceAt > 0 ? card.slice(0, priceAt) : '';
  // A developer's layout in a new building shows its lowest price: "83.1 м² от 30 331 500 ₸".
  const layout = /\sот$/.test(head);
  const title = head.replace(/\sот$/, '');
  const address = String(row.address ?? '').trim();
  let rest = card.replace(/^.*?₸\s*(?:за\s+(?:месяц|сутки))?\s*/, '');
  if (address && rest.startsWith(address)) rest = rest.slice(address.length);
  const tail = rest.search(CARD_TAIL);
  return {
    id: row.id,
    url: row.url,
    title,
    price: row.price_kzt,
    price_raw: row.rent_period === 'month' ? 'за месяц' : row.rent_period === 'day' ? 'за сутки' : layout ? 'от' : '',
    address,
    description: (tail >= 0 ? rest.slice(0, tail) : rest).trim() || title,
    refreshed: cardDate(card),
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
    priceFrom: /^\s*от\s/i.test(priceRaw) || priceRaw.trim() === 'от',
    rooms: rooms ? Math.min(Number(rooms[1]), 4) : /студи/i.test(title) ? 0 : null,
    area: area ? number(area[1]) : null,
    floor: floor ? Number(floor[1]) : null,
    floors: floor && floor[2] ? Number(floor[2]) : null,
    address: (fullAddress || 'Каскелен').slice(0, 200),
    street,
    description: cleanPost(row.description || title).slice(0, 5000) || title,
    sourceUrl: url.split('?')[0],
    refreshedAt: row.refreshed ?? null,
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

/** Ads a new krisha.kz file manages. Telegram ads and ads people posted stay. */
const KRISHA = `source_type = 'import' AND source_name = 'krisha.kz'`;

/**
 * Brings krisha.kz ads in line with the parser's file. Ads already on the site keep their
 * moderation and photos and only get the new price and details, new ads are added for
 * moderation, and ads gone from the file are removed, as are test ads.
 */
export async function importKrisha({ db, rows, photosDir, uploadsDir, geocode }) {
  const listings = [];
  const seen = new Set();
  for (const row of rows) {
    const listing = rowToListing(row);
    if (!listing || seen.has(listing.sourceUrl)) continue;
    seen.add(listing.sourceUrl);
    listings.push(listing);
  }
  if (listings.length === 0) return { imported: 0, updated: 0, removed: 0, photos: 0 };

  const existing = new Map((await db.all(`SELECT id, source_url FROM listings WHERE ${KRISHA}`)).map((row) => [row.source_url, row.id]));
  const fresh = listings.filter((item) => !existing.has(item.sourceUrl));
  for (const item of fresh) {
    let point = null;
    if (item.street) {
      try {
        point = await geocode(item.street, { approximate: true });
      } catch {
        point = null;
      }
    }
    item.lat = point?.lat ?? null;
    item.lon = point?.lon ?? null;
  }

  const gone = `(source_type = 'test' OR (${KRISHA} AND NOT (source_url = ANY($1))))`;
  const urls = [...seen];
  const oldFiles = await db.all(`SELECT photos.filename FROM photos JOIN listings ON listings.id = photos.listing_id WHERE ${gone}`, [urls]);
  const result = await db.transaction(async (tx) => {
    const removed = await tx.run(`DELETE FROM listings WHERE ${gone}`, [urls]);
    for (const item of listings.filter((entry) => existing.has(entry.sourceUrl))) {
      await tx.run(
        `UPDATE listings SET title = $1, price = $2, rooms = $3, area = $4, floor = $5, floors = $6, address = $7, description = $8, price_from = $9,
           refreshed_at = GREATEST(refreshed_at, $10) WHERE id = $11`,
        [item.title, item.price, item.rooms, item.area, item.floor, item.floors, item.address, item.description, item.priceFrom, item.refreshedAt, existing.get(item.sourceUrl)],
      );
    }
    const ids = [];
    for (const item of fresh) {
      const { id } = await tx.get(
        `INSERT INTO listings (source_type, source_name, source_url, title, deal, price, rooms, area, floor, floors, address, description, lat, lon, price_from, refreshed_at, status)
         VALUES ('import', 'krisha.kz', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'pending') RETURNING id`,
        [item.sourceUrl, item.title, item.deal, item.price, item.rooms, item.area, item.floor, item.floors, item.address, item.description, item.lat, item.lon, item.priceFrom, item.refreshedAt],
      );
      ids.push(id);
    }
    return { removed, ids };
  });
  for (const { filename } of oldFiles) fs.rmSync(path.join(uploadsDir, filename), { force: true });

  // New ads get all their photos. Ads already on the site get the ones the parser found since,
  // which happens when a later run collects the whole gallery instead of the cover only.
  const targets = [
    ...fresh.map((item, index) => ({ item, listingId: result.ids[index], have: 0 })),
    ...(await Promise.all(
      listings
        .filter((item) => existing.has(item.sourceUrl))
        .map(async (item) => {
          const listingId = existing.get(item.sourceUrl);
          const { n } = await db.get('SELECT COUNT(*)::int AS n FROM photos WHERE listing_id = $1', [listingId]);
          return { item, listingId, have: n };
        }),
    )),
  ];
  let photos = 0;
  for (const { item, listingId, have } of targets) {
    const buffers = photoFiles(photosDir, item.krishaId).slice(have).map((file) => fs.readFileSync(file));
    if (buffers.length) photos += await addListingPhotos({ db, listingId, buffers, uploadsDir });
  }
  return { imported: fresh.length, updated: listings.length - fresh.length, removed: result.removed, photos };
}
