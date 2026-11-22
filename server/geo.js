const EARTH_RADIUS_KM = 6371;
const rad = (deg) => (deg * Math.PI) / 180;

/** Straight-line distance in kilometres. */
export function distanceKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * The address without the town and without a landmark after a dash:
 * "Жеруйык — СДУ" is a street near SDU, not SDU itself.
 */
export function streetPart(address) {
  return String(address ?? '')
    .split(/\s[—–-]\s/)[0]
    .replace(/^\s*(?:г\.?\s*)?Каскел[её]н\s*,?\s*/i, '')
    .trim();
}

// Streets wind, so a walk is about a quarter longer than the straight line.
const DETOUR = 1.25;
const WALK_KMH = 4.5;
// A Kaskelen bus with its stops, plus the walk to the stop and the wait.
const BUS_KMH = 18;
const BUS_EXTRA_MIN = 8;

/**
 * Minutes to SDU on foot and by bus. `walk` is the routed walk when known;
 * otherwise both come from the straight-line distance and are marked approximate.
 */
export function travelTime(straightKm, walk = null) {
  if (straightKm === null || straightKm === undefined) return null;
  const roadKm = walk?.km ?? straightKm * DETOUR;
  const walkMin = walk?.minutes ?? (roadKm / WALK_KMH) * 60;
  return {
    walkMin: Math.max(1, Math.round(walkMin)),
    busMin: Math.round((roadKm / BUS_KMH) * 60 + BUS_EXTRA_MIN),
    routed: Boolean(walk),
  };
}
