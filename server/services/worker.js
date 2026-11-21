import { MAX_AD_DISTANCE_KM, SDU } from '../config.js';
import { distanceKm } from '../geo.js';

const BATCH_SIZE = 5;
/** OpenStreetMap allows a request a second, so 20 lookups fit in one 30-second tick. */
const GEOCODE_BATCH_SIZE = 20;
/** Ads that are refused before the AI sees them, with the reason in the author's language. */
const RULE_REASONS = {
  no_photos: {
    ru: 'Добавьте хотя бы одно фото квартиры.',
    en: 'Add at least one photo of the flat.',
    kk: 'Пәтердің кемінде бір фотосын қосыңыз.',
  },
  too_far: {
    ru: `Квартира дальше ${MAX_AD_DISTANCE_KM} км от SDU. Сайт показывает жильё не дальше ${MAX_AD_DISTANCE_KM} км от университета.`,
    en: `The flat is more than ${MAX_AD_DISTANCE_KM} km from SDU. The site shows homes within ${MAX_AD_DISTANCE_KM} km of the university.`,
    kk: `Пәтер SDU-дан ${MAX_AD_DISTANCE_KM} км-ден алыс. Сайт университеттен ${MAX_AD_DISTANCE_KM} км-ге дейінгі тұрғын үйді ғана көрсетеді.`,
  },
  no_point: {
    ru: 'Адрес не найден на карте, поэтому расстояние до SDU неизвестно. Уточните адрес.',
    en: 'The address was not found on the map, so the distance to SDU is unknown. Make the address more precise.',
    kk: 'Мекенжай картадан табылмады, сондықтан SDU-ға дейінгі қашықтық белгісіз. Мекенжайды нақтылаңыз.',
  },
};

/** Why an ad cannot be published whatever the AI says, or null. Search shows only ads with photos, near SDU. */
export function ruleReason(listing) {
  const far = listing.lat !== null && distanceKm(SDU, { lat: listing.lat, lon: listing.lon }) > MAX_AD_DISTANCE_KM;
  const rule = Number(listing.photo_count) === 0 ? 'no_photos' : listing.lat === null ? 'no_point' : far ? 'too_far' : null;
  return rule ? RULE_REASONS[rule][listing.moderation_lang] ?? RULE_REASONS[rule].ru : null;
}

/** How long to leave 2GIS or the AI alone after a failure, so a blocked key or an overloaded model is not hit every tick. */
const PAUSE_MS = 10 * 60_000;

/** Fills in missing coordinates and moderates pending listings and reviews. */
export function createWorker({ db, dgis, moderator, log = console, now = Date.now }) {
  let running = false;
  let geocodePausedUntil = 0;
  let moderationPausedUntil = 0;

  async function geocodeMissing() {
    if (now() < geocodePausedUntil) return;
    // An address 2GIS did not find is tried again a day later, not on every tick.
    const rows = await db.all(
      `SELECT id, address, source_type FROM listings WHERE lat IS NULL AND address IS NOT NULL
       AND (geocode_tried_at IS NULL OR geocode_tried_at < now() - interval '1 day') ORDER BY id LIMIT $1`,
      [GEOCODE_BATCH_SIZE],
    );
    for (const row of rows) {
      try {
        // Imported ads often name only a street, which is still good enough for the distance to SDU.
        const point = await dgis.geocode(row.address, { approximate: row.source_type === 'import' });
        await db.run('UPDATE listings SET lat = $1, lon = $2, geocode_tried_at = now() WHERE id = $3', [point?.lat ?? null, point?.lon ?? null, row.id]);
      } catch (error) {
        geocodePausedUntil = now() + PAUSE_MS;
        log.warn(`Geocoding listing ${row.id} failed, pausing geocoding for 10 minutes: ${error.message}`);
        return;
      }
    }
  }

  async function moderatePending() {
    if (!moderator || now() < moderationPausedUntil) return;
    // The edit time is read as text, so the check below compares it exactly, to the microsecond.
    // An address not looked up yet waits, so the distance rule below sees the real answer.
    const listings = await db.all(
      `SELECT *, updated_at::text AS edited, (SELECT COUNT(*) FROM photos WHERE photos.listing_id = listings.id)::int AS photo_count
       FROM listings WHERE status = 'pending' AND NOT (lat IS NULL AND address IS NOT NULL AND geocode_tried_at IS NULL) LIMIT $1`,
      [BATCH_SIZE],
    );
    for (const listing of listings) {
      const refused = ruleReason(listing);
      if (refused) {
        await db.run(
          `UPDATE listings SET status = 'rejected', moderation_reason = $1 WHERE id = $2 AND updated_at::text = $3 AND status = 'pending'`,
          [refused, listing.id, listing.edited],
        );
        continue;
      }
      try {
        const photos = await db.all('SELECT filename, mime FROM photos WHERE listing_id = $1', [listing.id]);
        const verdict = await moderator.moderateListing(listing, photos);
        // An edit made while the AI was thinking keeps the listing pending for a fresh check,
        // and a decision an admin made meanwhile is kept.
        await db.run(
          `UPDATE listings SET status = $1, moderation_reason = $2 WHERE id = $3 AND updated_at::text = $4 AND status = 'pending'`,
          [verdict.decision === 'approve' ? 'approved' : 'rejected', verdict.reason, listing.id, listing.edited],
        );
      } catch (error) {
        moderationPausedUntil = now() + PAUSE_MS;
        log.warn(`Moderating listing ${listing.id} failed, pausing moderation for 10 minutes: ${error.message}`);
        return;
      }
    }
    const reviews = await db.all(`SELECT * FROM reviews WHERE status = 'pending' LIMIT $1`, [BATCH_SIZE]);
    for (const review of reviews) {
      try {
        const listing = await db.get('SELECT title, address FROM listings WHERE id = $1', [review.listing_id]);
        const verdict = await moderator.moderateReview(review, listing);
        // An admin who decided first wins.
        await db.run(`UPDATE reviews SET status = $1, moderation_reason = $2 WHERE id = $3 AND text = $4 AND status = 'pending'`, [
          verdict.decision === 'approve' ? 'approved' : 'rejected',
          verdict.reason,
          review.id,
          review.text,
        ]);
      } catch (error) {
        log.warn(`Moderating review ${review.id} failed: ${error.message}`);
      }
    }
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      await geocodeMissing();
      await moderatePending();
    } finally {
      running = false;
    }
  }

  return { tick };
}
