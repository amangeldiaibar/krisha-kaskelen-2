import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { transaction } from '../db.js';
import { sniffImage } from '../images.js';

const QUERY = 'krisha.kz сдам квартиру Каскелен рядом с СДУ цена тенге';
export const MAX_TOTAL_LISTINGS = 5;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
// Only the text Google shows is used for krisha.kz, and its pages are never requested.
const KRISHA_AD_URL = /^https:\/\/(?:[\w-]+\.)?krisha\.kz\/a\/show\/\d+/i;
const KRISHA_SNIPPET = /(\d)-комнатная квартира за (\d{4,9})\s*,\s*([^—,]+?)\s*(?:—\s*([^,]+?)\s*)?,\s*Каскелен/i;
// Its terms forbid copying without written permission, and it has no snippets to use here.
const BLOCKED_DOMAINS = ['kolesa.kz'];

const PHONE = /(?:\+?\d[\s()-]*){10,}/g;
const HOUSE = String.raw`\d+[\p{L}/\d]*`;
const ADDRESS_PATTERNS = [
  // ул. Баталы 25, мкр Алтын аул 5, проспект Абылай хана 1/2
  new RegExp(String.raw`(?:ул\.?|улица|мкр\.?|микрорайон|пр\.|проспект)\s*[«"]?\p{L}[\p{L}-]{2,}(?:\s+\p{L}{3,})?[»"]?,?\s*(?:д\.?\s*)?${HOUSE}`, 'iu'),
  // Квартал 9, 43 or Квартал9 43 or 9 квартал 105
  new RegExp(String.raw`квартал\s*\d+,?\s+${HOUSE}|\d+(?:-й)?\s+квартал,?\s+${HOUSE}`, 'iu'),
  // Domler titles: "... помесячно, Баталы 25 - Район Сду"
  new RegExp(String.raw`(?<=помесячно,\s)\p{L}[\p{L}-]{2,},?\s+${HOUSE}`, 'iu'),
];
// Search and category pages also rank in Google, but they are not single ads.
const LIST_PAGE_URL = /\/q-|[?&](?:page|search)=/i;
const LIST_PAGE_TITLE = /страниц|объявлени|недвижимость|снять квартиру|аренда квартир/i;
const MAX_MONTHLY_RENT = 2_000_000;
const PRICE = /(\d[\d\s]{3,9})\s*(?:₸|тг|тенге|kzt)/i;

export function isBlockedUrl(link) {
  try {
    const host = new URL(link).hostname.toLowerCase();
    return BLOCKED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return true;
  }
}

/** Reads a krisha.kz ad from Google's text. Without a street there is nothing to place on the map. */
export function parseKrishaSnippet(result) {
  if (!KRISHA_AD_URL.test(result?.link ?? '')) return null;
  const match = (result.snippet ?? '').match(KRISHA_SNIPPET);
  if (!match) return null;
  const [, rooms, price, address, landmark] = match;
  if (/^(?:сду|sdu)$/i.test(address) || Number(price) > MAX_MONTHLY_RENT) return null;
  const place = [address, landmark].filter(Boolean).join(', ');
  return {
    title: `${rooms}-комнатная квартира, ${address}`.slice(0, 120),
    description: `${rooms}-комнатная квартира, ${place}, Каскелен. Данные из выдачи Google, адрес на карте примерный. Подробности и контакты на странице источника.`,
    price: Number(price),
    rooms: Math.min(Number(rooms), 4),
    area: null,
    address,
    approximate: !/\d+[\p{L}/\d]*$/u.test(address),
    sourceUrl: result.link.split('?')[0],
    sourceName: 'krisha.kz',
  };
}

/** Turns a search result into a listing, or null when it lacks price or address. */
export function parseResult(result) {
  if (KRISHA_AD_URL.test(result?.link ?? '')) return parseKrishaSnippet(result);
  if (/krisha\.kz/i.test(result?.link ?? '')) return null;
  if (!result?.link || !result.title || isBlockedUrl(result.link)) return null;
  if (!/^https?:/i.test(result.link)) return null;
  const clean = (text) => (text ?? '').replace(PHONE, '').replace(/\s+/g, ' ').trim();
  const title = clean(result.title);
  const snippet = clean(result.snippet);
  const text = `${title} ${snippet}`;

  // Looked up per field, so a house number before the price cannot merge with it.
  const price = snippet.match(PRICE) ?? title.match(PRICE);
  const address = ADDRESS_PATTERNS.map((pattern) => text.match(pattern)).find(Boolean);
  if (!price || !address || LIST_PAGE_URL.test(result.link) || LIST_PAGE_TITLE.test(title)) return null;
  if (Number(price[1].replace(/\s/g, '')) > MAX_MONTHLY_RENT) return null;

  const rooms = text.match(/(\d)\s*[-\s]?\s*(?:комн|ком\b|х\s*комн)/i);
  const area = text.match(/(\d+(?:[.,]\d+)?)\s*(?:м²|м2|кв\.?\s*м)/i);
  return {
    title: title.slice(0, 120),
    description: snippet || title,
    price: Number(price[1].replace(/\s/g, '')),
    rooms: rooms ? Math.min(Number(rooms[1]), 4) : /студи/i.test(text) ? 0 : null,
    area: area ? Number(area[1].replace(',', '.')) : null,
    address: address[0].trim(),
    sourceUrl: result.link,
    sourceName: new URL(result.link).hostname.replace(/^www\./, ''),
  };
}

export async function searchGoogle({ apiKey, fetchImpl = fetch }) {
  const url = new URL('https://serpapi.com/search.json');
  url.search = new URLSearchParams({
    engine: 'google',
    q: QUERY,
    gl: 'kz',
    hl: 'ru',
    num: '20',
    api_key: apiKey,
  });
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`SerpAPI returned ${res.status}`);
  const body = await res.json();
  return body.organic_results ?? [];
}

/**
 * Replaces previous imports with fresh results while keeping the prototype at
 * five listings in total. App and test listings are never removed.
 */
export async function importListings({ db, dgis, results }) {
  const slots = freeImportSlots(db);

  const prepared = [];
  // Ads with a house number land on the map most accurately, so they go first.
  const candidates = results
    .map(parseResult)
    .filter(Boolean)
    .sort((a, b) => Number(Boolean(a.approximate)) - Number(Boolean(b.approximate)));
  for (const parsed of candidates) {
    if (prepared.length >= slots) break;
    const point = await dgis.geocode(parsed.address, { approximate: true });
    if (point) prepared.push({ ...parsed, ...point });
  }
  saveImports({ db, prepared, slots });
  return { imported: prepared.length, slots };
}

export function freeImportSlots(db) {
  const { own } = db.prepare(`SELECT COUNT(*) AS own FROM listings WHERE source_type != 'import' OR source_name LIKE 't.me/%'`).get();
  return Math.max(0, MAX_TOTAL_LISTINGS - own);
}

/** Saves valid images for a listing and returns how many were kept. */
export function addListingPhotos({ db, listingId, buffers, uploadsDir }) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const insert = db.prepare('INSERT INTO photos (listing_id, filename, mime, position) VALUES (?, ?, ?, ?)');
  let position = db.prepare('SELECT COUNT(*) AS n FROM photos WHERE listing_id = ?').get(listingId).n;
  let kept = 0;
  for (const buffer of buffers) {
    const type = sniffImage(buffer);
    if (!type || buffer.length > MAX_PHOTO_BYTES) continue;
    const filename = `${crypto.randomUUID()}.${type.ext}`;
    fs.writeFileSync(path.join(uploadsDir, filename), buffer);
    insert.run(listingId, filename, type.mime, position);
    position += 1;
    kept += 1;
  }
  return kept;
}

/** Older search imports leave only when new ones need their place. Telegram ads stay. */
export function saveImports({ db, prepared, slots, uploadsDir }) {
  if (prepared.length === 0) return [];
  const removeFiles = (id) => {
    if (!uploadsDir) return;
    for (const { filename } of db.prepare('SELECT filename FROM photos WHERE listing_id = ?').all(id)) {
      fs.rmSync(path.join(uploadsDir, filename), { force: true });
    }
  };
  return transaction(db, () => {
    const remove = db.prepare('DELETE FROM listings WHERE id = ?');
    const sameUrl = db.prepare(`SELECT id FROM listings WHERE source_type = 'import' AND source_url = ?`);
    for (const item of prepared) {
      const existing = sameUrl.get(item.sourceUrl);
      if (existing) {
        removeFiles(existing.id);
        remove.run(existing.id);
      }
    }
    const old = db.prepare(`SELECT id FROM listings WHERE source_type = 'import' AND source_name NOT LIKE 't.me/%' ORDER BY id`).all();
    old.slice(0, Math.max(0, old.length + prepared.length - slots)).forEach(({ id }) => {
      removeFiles(id);
      remove.run(id);
    });
    const insert = db.prepare(
      `INSERT INTO listings (source_type, source_name, source_url, title, deal, price, rooms, area, address, description, lat, lon, status)
       VALUES ('import', ?, ?, ?, 'rent', ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    );
    return prepared.map((item) => {
      const { lastInsertRowid } = insert.run(item.sourceName, item.sourceUrl, item.title, item.price, item.rooms, item.area, item.address, item.description, item.lat, item.lon);
      return { ...item, listingId: Number(lastInsertRowid) };
    });
  });
}
