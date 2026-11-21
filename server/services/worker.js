const BATCH_SIZE = 5;
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
      `SELECT id, address FROM listings WHERE lat IS NULL AND address IS NOT NULL
       AND (geocode_tried_at IS NULL OR geocode_tried_at < now() - interval '1 day') ORDER BY id LIMIT $1`,
      [BATCH_SIZE],
    );
    for (const row of rows) {
      try {
        const point = await dgis.geocode(row.address);
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
    const listings = await db.all(`SELECT *, updated_at::text AS edited FROM listings WHERE status = 'pending' LIMIT $1`, [BATCH_SIZE]);
    for (const listing of listings) {
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
