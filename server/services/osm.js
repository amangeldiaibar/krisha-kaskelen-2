import { SDU } from '../config.js';
import { distanceKm } from '../geo.js';

const SEARCH = 'https://nominatim.openstreetmap.org/search';
// Nominatim's usage policy: an identifying User-Agent and at most one request a second.
const USER_AGENT = 'krisha-kaskelen/1.0 (student project)';
const MIN_GAP_MS = 1100;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_DISTANCE_FROM_SDU_KM = 12;
const ROUGH_CATEGORIES = new Set(['highway', 'place', 'landuse']);

export class OsmError extends Error {}

/** Free OpenStreetMap geocoding, used when 2GIS refuses or does not know an address. */
export function createOsmGeocoder({ db, fetchImpl = fetch, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now }) {
  let queue = Promise.resolve();
  let last = 0;

  /** Runs requests one by one with the gap the policy asks for. */
  function throttled(task) {
    const run = queue.then(async () => {
      const gap = last + MIN_GAP_MS - now();
      if (gap > 0) await wait(gap);
      last = now();
      return task();
    });
    queue = run.catch(() => {});
    return run;
  }

  async function search(query) {
    const cacheKey = `osm:${query.toLowerCase()}`;
    const cached = await db.get('SELECT body, fetched_at FROM dgis_cache WHERE cache_key = $1', [cacheKey]);
    if (cached && now() - cached.fetched_at < CACHE_TTL_MS) return JSON.parse(cached.body);

    const places = await throttled(async () => {
      const url = new URL(SEARCH);
      for (const [name, value] of Object.entries({ q: query, format: 'jsonv2', limit: '5', countrycodes: 'kz' })) url.searchParams.set(name, value);
      const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ru' }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new OsmError(`OpenStreetMap returned ${res.status}`);
      return res.json();
    });
    const found = (Array.isArray(places) ? places : [])
      .map((place) => ({ lat: Number(place.lat), lon: Number(place.lon), category: place.category, type: place.type }))
      .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lon) && distanceKm(SDU, place) <= MAX_DISTANCE_FROM_SDU_KM);
    await db.run(
      `INSERT INTO dgis_cache (cache_key, body, fetched_at) VALUES ($1, $2, $3)
       ON CONFLICT (cache_key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at`,
      [cacheKey, JSON.stringify(found), now()],
    );
    return found;
  }

  /**
   * Coordinates of the building at an address, or null. `approximate` also accepts a street or
   * quarter, never the whole town. Text after a dash, such as "— у моста", is a landmark, not an address.
   */
  async function geocode(address, { approximate = false } = {}) {
    const street = String(address).split(/\s[—–-]\s/)[0].replace(/^\s*(?:г\.?\s*)?Каскел[её]н\s*,?\s*/i, '').trim();
    if (!street) return null;
    const places = await search(`${street}, Каскелен`);
    const place =
      places.find((item) => item.category === 'building' || item.type === 'house') ??
      (approximate ? places.find((item) => ROUGH_CATEGORIES.has(item.category) && !['city', 'town', 'administrative'].includes(item.type)) : null);
    return place ? { lat: place.lat, lon: place.lon } : null;
  }

  return { geocode };
}
