const BATCH_SIZE = 5;

/** Fills in missing coordinates and moderates pending listings and reviews. */
export function createWorker({ db, dgis, moderator, log = console }) {
  let running = false;

  async function geocodeMissing() {
    const rows = db
      .prepare(`SELECT id, address FROM listings WHERE lat IS NULL AND address IS NOT NULL LIMIT ?`)
      .all(BATCH_SIZE);
    for (const row of rows) {
      try {
        const point = await dgis.geocode(row.address);
        if (point) {
          db.prepare('UPDATE listings SET lat = ?, lon = ? WHERE id = ?').run(point.lat, point.lon, row.id);
        }
      } catch (error) {
        log.warn(`Geocoding listing ${row.id} failed: ${error.message}`);
        return;
      }
    }
  }

  async function moderatePending() {
    if (!moderator) return;
    const listings = db.prepare(`SELECT * FROM listings WHERE status = 'pending' LIMIT ?`).all(BATCH_SIZE);
    for (const listing of listings) {
      try {
        const photos = db.prepare('SELECT filename, mime FROM photos WHERE listing_id = ?').all(listing.id);
        const verdict = await moderator.moderateListing(listing, photos);
        db.prepare(
          `UPDATE listings SET status = ?, moderation_reason = ? WHERE id = ? AND updated_at = ?`,
        ).run(verdict.decision === 'approve' ? 'approved' : 'rejected', verdict.reason, listing.id, listing.updated_at);
      } catch (error) {
        log.warn(`Moderating listing ${listing.id} failed: ${error.message}`);
      }
    }
    const reviews = db.prepare(`SELECT * FROM reviews WHERE status = 'pending' LIMIT ?`).all(BATCH_SIZE);
    for (const review of reviews) {
      try {
        const listing = db.prepare('SELECT title, address FROM listings WHERE id = ?').get(review.listing_id);
        const verdict = await moderator.moderateReview(review, listing);
        db.prepare(`UPDATE reviews SET status = ?, moderation_reason = ? WHERE id = ? AND text = ?`).run(
          verdict.decision === 'approve' ? 'approved' : 'rejected',
          verdict.reason,
          review.id,
          review.text,
        );
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
