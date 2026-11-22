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
