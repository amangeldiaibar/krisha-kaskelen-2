import { SDU } from '../config.js';
import { distanceKm } from '../geo.js';

const CATALOG = 'https://catalog.api.2gis.com/3.0/items';
const REVIEWS = 'https://public-api.reviews.2gis.com/2.0/branches';
const STATIC_MAP = 'https://static.maps.2gis.com/1.0';
const MAX_DISTANCE_FROM_SDU_KM = 12;
const REVIEWS_TTL_MS = 24 * 60 * 60 * 1000;
const PRECISE_TYPES = new Set(['building', 'branch', 'attraction']);

export class DgisError extends Error {}

export function createDgis({ key, db, fetchImpl = fetch }) {
  async function catalog(params) {
    const url = new URL(`${CATALOG}${params.path || ''}`);
    url.searchParams.set('key', key);
    for (const [name, value] of Object.entries(params.query)) url.searchParams.set(name, value);
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    const body = await res.json().catch(() => null);
    const code = body?.meta?.code;
    if (code === 404) return [];
    if (!res.ok || code !== 200) throw new DgisError(`2GIS catalog returned ${code ?? res.status}`);
    return body.result?.items ?? [];
  }

  const addressQuery = (address) => `Каскелен, ${address}`;

  function preciseItem(items) {
    return items.find((item) => {
      if (!PRECISE_TYPES.has(item.type) || !item.point) return false;
      return distanceKm(SDU, item.point) <= MAX_DISTANCE_FROM_SDU_KM;
    });
  }

  function roughItem(items) {
    return items.find((item) => {
      if (!item.point || (item.type !== 'street' && item.type !== 'adm_div') || item.subtype === 'city') return false;
      return distanceKm(SDU, item.point) <= MAX_DISTANCE_FROM_SDU_KM;
    });
  }

  /**
   * Returns coordinates, or null when 2GIS does not know this exact building.
   * `approximate` also accepts a street or quarter, but never the whole city.
   */
  async function geocode(address, { approximate = false } = {}) {
    const items = await catalog({
      path: '/geocode',
      query: { q: addressQuery(address), fields: 'items.point,items.address_name' },
    });
    const item = preciseItem(items) ?? (approximate ? roughItem(items) : null);
    return item ? { lat: item.point.lat, lon: item.point.lon } : null;
  }

  /**
   * Reviews for the building at an address. Text reviews need access that the
   * demo key lacks, so "unavailable" is an expected, cached result.
   */
  async function reviewsForAddress(address) {
    const cacheKey = `reviews:${address.toLowerCase()}`;
    const cached = db
      .prepare('SELECT body, fetched_at FROM dgis_cache WHERE cache_key = ?')
      .get(cacheKey);
    if (cached && Date.now() - cached.fetched_at < REVIEWS_TTL_MS) return JSON.parse(cached.body);

    const result = await loadReviews(address);
    db.prepare(
      `INSERT INTO dgis_cache (cache_key, body, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT (cache_key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at`,
    ).run(cacheKey, JSON.stringify(result), Date.now());
    return result;
  }

  async function loadReviews(address) {
    const items = await catalog({
      path: '/geocode',
      query: { q: addressQuery(address), fields: 'items.point,items.reviews' },
    });
    const item = preciseItem(items);
    if (!item) return { status: 'no_match', rating: null, count: 0, reviews: [] };

    const count = item.reviews?.general_review_count ?? 0;
    const rating = count > 0 ? (item.reviews?.general_rating ?? null) : null;

    const url = new URL(`${REVIEWS}/${encodeURIComponent(item.id)}/reviews`);
    url.searchParams.set('limit', '20');
    url.searchParams.set('key', key);
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    if (res.status === 401 || res.status === 403) {
      return { status: 'unavailable', rating, count, reviews: [] };
    }
    if (res.status === 404) return { status: 'ok', rating, count, reviews: [] };
    if (!res.ok) throw new DgisError(`2GIS reviews returned ${res.status}`);

    const body = await res.json();
    const reviews = (body.reviews ?? [])
      .filter((review) => typeof review.text === 'string' && review.text.trim())
      .map((review) => ({
        id: String(review.id),
        text: review.text,
        author: review.user?.name ?? null,
        rating: review.rating ?? null,
        createdAt: review.date_created ?? null,
      }));
    return { status: 'ok', rating, count, reviews };
  }

  /** The image is fetched here so the key never reaches the browser. */
  async function staticMap({ lat, lon, zoom, width, height }) {
    const url = new URL(STATIC_MAP);
    url.searchParams.set('s', `${width}x${height}`);
    url.searchParams.set('c', `${lat},${lon}`);
    url.searchParams.set('z', String(zoom));
    url.searchParams.set('key', key);
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('image/')) {
      throw new DgisError(`2GIS static map returned ${res.status}`);
    }
    return { type, body: Buffer.from(await res.arrayBuffer()) };
  }

  return { geocode, reviewsForAddress, staticMap };
}
