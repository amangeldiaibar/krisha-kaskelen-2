import { distanceKm } from '../geo.js';

// A pair at or above this score is shown to admins as a likely duplicate.
export const DUPLICATE_THRESHOLD = 0.5;
// The same owner posting a pair this close is a repost, and the new one is refused.
export const REPOST_THRESHOLD = 0.8;
const MAX_PRICE_GAP = 0.1;

const ADDRESS_NOISE = /(?<!\p{L})(?:ул|улица|көшесі|көш|пр|проспект|мкр|микрорайон|шағын|ауданы?|д|дом|үй|кв|квартира|г|город|каскелен|қаскелең|kaskelen|street|st)(?!\p{L})/gu;

const words = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** "ул. Абылай хана, д. 12" and "Абылай хана 12" give the same key. */
export const addressKey = (address) => words(String(address ?? '').toLowerCase().replace(ADDRESS_NOISE, ' ')).join(' ');

/** Word pairs of a text, so word order matters a little but spacing, case and emoji do not. */
function shingles(text) {
  const list = words(text).filter((word) => word.length > 1);
  const set = new Set();
  for (let index = 0; index + 1 < list.length; index += 1) set.add(`${list[index]} ${list[index + 1]}`);
  return set;
}

export function textSimilarity(a, b) {
  const left = shingles(a);
  const right = shingles(b);
  if (left.size < 3 || right.size < 3) return 0;
  let shared = 0;
  for (const item of left) if (right.has(item)) shared += 1;
  return shared / (left.size + right.size - shared);
}

const known = (value) => value !== null && value !== undefined;

/**
 * How likely two ads describe the same apartment, from 0 to 1, with the reasons.
 * Different deal types, room counts, prices more than 10% apart or different floors rule a pair out.
 */
export function compareListings(a, b) {
  const none = { score: 0, reasons: [] };
  if (a.id === b.id || a.deal !== b.deal) return none;
  if (known(a.rooms) && known(b.rooms) && a.rooms !== b.rooms) return none;
  if (known(a.floor) && known(b.floor) && a.floor !== b.floor) return none;
  if (known(a.price) && known(b.price) && Math.abs(a.price - b.price) > MAX_PRICE_GAP * Math.max(a.price, b.price, 1)) return none;

  let score = 0;
  const reasons = [];
  const add = (points, reason) => {
    score += points;
    reasons.push(reason);
  };

  if (a.phone && b.phone && a.phone === b.phone) add(0.45, 'same_phone');

  const text = textSimilarity(`${a.title} ${a.description}`, `${b.title} ${b.description}`);
  if (text >= 0.6) add(0.5, 'same_text');
  else if (text >= 0.3) add(0.3, 'similar_text');

  const hasPoints = known(a.lat) && known(a.lon) && known(b.lat) && known(b.lon);
  const meters = hasPoints ? distanceKm({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }) * 1000 : null;
  const sameAddress = addressKey(a.address) !== '' && addressKey(a.address) === addressKey(b.address);
  if (sameAddress || (meters !== null && meters <= 60)) add(0.3, 'same_place');
  else if (meters !== null && meters <= 250) add(0.12, 'near_place');

  if (known(a.area) && known(b.area)) {
    const gap = Math.abs(a.area - b.area);
    if (gap <= Math.max(a.area, b.area) * 0.02) add(0.15, 'same_area');
    else if (gap > 8) score -= 0.25;
  }
  if (known(a.price) && a.price === b.price) add(0.1, 'same_price');
  if (known(a.floor) && a.floor === b.floor) add(0.08, 'same_floor');

  return { score: Math.max(0, Math.min(1, Math.round(score * 100) / 100)), reasons };
}

const pairKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/**
 * Likely duplicate pairs among the given ads, best first.
 * Only ads with the same deal and room count are compared, so this stays fast for thousands of ads.
 */
export function findDuplicatePairs(listings, { dismissed = new Set(), threshold = DUPLICATE_THRESHOLD } = {}) {
  const buckets = new Map();
  for (const listing of listings) {
    const key = `${listing.deal}:${listing.rooms ?? '?'}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(listing);
  }
  // Ads without a room count may match any room count of the same deal.
  for (const [key, unknown] of buckets) {
    if (!key.endsWith(':?')) continue;
    const deal = key.slice(0, -2);
    for (const [other, list] of buckets) if (other !== key && other.startsWith(`${deal}:`)) list.push(...unknown);
  }
  const pairs = new Map();
  for (const list of buckets.values()) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const key = pairKey(list[i].id, list[j].id);
        if (pairs.has(key) || dismissed.has(key)) continue;
        const { score, reasons } = compareListings(list[i], list[j]);
        if (score >= threshold) pairs.set(key, { a: list[i], b: list[j], score, reasons });
      }
    }
  }
  return [...pairs.values()].sort((x, y) => y.score - x.score);
}

export { pairKey };
