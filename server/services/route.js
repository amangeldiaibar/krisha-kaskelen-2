import { SDU } from '../config.js';

// The FOSSGIS servers behind openstreetmap.org's route planner, with a foot profile.
const FOOT = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';
const USER_AGENT = 'krisha-kaskelen/1.0 (student project)';

export class RouteError extends Error {}

/** The walk from a point to SDU along real streets, from OpenStreetMap. Null when no path is known. */
export function createFootRouter({ fetchImpl = fetch } = {}) {
  async function walkToSdu(point) {
    const res = await fetchImpl(`${FOOT}/${point.lon},${point.lat};${SDU.lon},${SDU.lat}?overview=false`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => null);
    if (data?.code === 'NoRoute') return null;
    if (!res.ok || data?.code !== 'Ok') throw new RouteError(`The route service returned ${data?.code ?? res.status}`);
    const [route] = data.routes;
    return { km: route.distance / 1000, minutes: route.duration / 60 };
  }
  return { walkToSdu };
}
