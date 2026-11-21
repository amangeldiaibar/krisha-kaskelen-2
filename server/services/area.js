import { SDU } from '../config.js';
import { distanceKm, streetPart } from '../geo.js';

/** Kaskelen around SDU. */
const KASKELEN_RADIUS_KM = 12;
/** The villages between Kaskelen and Almaty: Долан and Алмалыбак in the south-west to Коксай and Almaty Arena in the north-east. */
export const WEST_ALMATY = { south: 43.185, north: 43.27, west: 76.665, east: 76.825 };
/** Villages and microdistricts inside WEST_ALMATY, as people write them. */
export const PLACES = ['Жалпаксай', 'Алмалыбак', 'Булакты', 'Иргели', 'Коксай', 'Абай', 'Райымбек', 'Долан', 'Шугыла', 'Нуркент'];

const word = (name) => new RegExp(`(?<!\\p{L})${name}(?!\\p{L})`, 'iu');
const PLACE_PATTERNS = PLACES.map((name) => [name, word(name)]);
const KASKELEN = /каскел[её]н|қаскелең|(?<!\p{L})(?:сду|sdu)(?!\p{L})/iu;

/** Whether a point is in Kaskelen or in the villages east of it. The rest of Almaty is not served. */
export function inServiceArea(point) {
  if (!point) return false;
  const { south, north, west, east } = WEST_ALMATY;
  const inWest = point.lat >= south && point.lat <= north && point.lon >= west && point.lon <= east;
  return inWest || distanceKm(SDU, point) <= KASKELEN_RADIUS_KM;
}

/** The village an address names, or null for Kaskelen. */
export function placeOf(address) {
  return PLACE_PATTERNS.find(([, pattern]) => pattern.test(address ?? ''))?.[0] ?? null;
}

/** Whether a post names Kaskelen, SDU or one of the villages, so it is worth reading. */
export function mentionsServiceArea(text) {
  return KASKELEN.test(text ?? '') || placeOf(text) !== null;
}

/** What to ask a map for: the street in its village, or in Kaskelen when no village is named. */
export function geocodeQuery(address) {
  const place = placeOf(address);
  const street = streetPart(address);
  if (!place) return street ? `Каскелен, ${street}` : null;
  const rest = street.replace(word(place), '').replace(/^[\s,]+|[\s,]+$/g, '').replace(/\s*,\s*,\s*/g, ', ');
  return rest ? `Алматинская область, ${place}, ${rest}` : `Алматинская область, ${place}`;
}
