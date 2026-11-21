import { requireAdmin } from './auth.js';
import { HttpError, fieldError, idParam, toInt } from './http.js';
import { findDuplicatePairs, pairKey } from './services/duplicates.js';

const PAGE_SIZE = 50;
const LISTING_STATUSES = new Set(['pending', 'approved', 'rejected']);
const REPORT_STATUSES = new Set(['open', 'resolved', 'dismissed']);
const SOURCES = {
  app: `listings.source_type = 'app'`,
  telegram: `listings.source_type = 'import' AND listings.source_name LIKE 't.me/%'`,
  krisha: `listings.source_type = 'import' AND listings.source_name = 'krisha.kz'`,
  test: `listings.source_type = 'test'`,
};

const reasonOf = (body, decision) => {
  const reason = String(body?.reason ?? '').trim();
  if (decision === 'reject' && reason.length < 3) throw fieldError('reason');
  if (reason.length > 500) throw fieldError('reason');
  return reason || null;
};

const decisionOf = (body) => {
  if (body?.decision !== 'approve' && body?.decision !== 'reject') throw fieldError('decision');
  return body.decision;
};

/** What the admin lists show about an ad. Phones of imported ads are never stored, so they stay empty. */
const listingSummary = (row) => ({
  id: row.id,
  title: row.title,
  deal: row.deal,
  price: row.price,
  rooms: row.rooms,
  area: row.area,
  floor: row.floor,
  address: row.address,
  description: row.description,
  status: row.status,
  dealStatus: row.deal_status,
  moderationReason: row.moderation_reason,
  moderatedBy: row.moderator_name ?? null,
  source: { type: row.source_type, name: row.source_name, url: row.source_url },
  cover: row.cover ? `/uploads/${row.cover}` : null,
  owner: row.owner_id ? { id: row.owner_id, name: row.owner_name, phone: row.owner_phone, email: row.owner_email, blocked: Boolean(row.owner_blocked) } : null,
  reportCount: row.report_count ?? 0,
  duplicateOf: row.duplicate_of,
  createdAt: row.created_at,
});

const LISTING_SELECT = `SELECT listings.*,
    owner.id AS owner_id, owner.name AS owner_name, owner.phone AS owner_phone, owner.email AS owner_email, owner.blocked_at IS NOT NULL AS owner_blocked,
    moderator.name AS moderator_name,
    (SELECT filename FROM photos WHERE photos.listing_id = listings.id ORDER BY position LIMIT 1) AS cover,
    (SELECT COUNT(*) FROM reports WHERE reports.listing_id = listings.id AND reports.status = 'open') AS report_count
  FROM listings
  LEFT JOIN users owner ON owner.id = listings.user_id
  LEFT JOIN users moderator ON moderator.id = listings.moderated_by`;

/** Ads that can still be duplicates: visible or waiting, and not already merged. */
async function duplicateCandidates(db) {
  const [rows, dismissed] = await Promise.all([
    db.all(`${LISTING_SELECT} WHERE listings.status IN ('pending', 'approved') AND listings.duplicate_of IS NULL`),
    db.all('SELECT low_id, high_id FROM duplicate_dismissals'),
  ]);
  return findDuplicatePairs(rows, { dismissed: new Set(dismissed.map((row) => pairKey(row.low_id, row.high_id))) });
}

export function registerAdminRoutes(app, { db, removeFiles, onContentChanged }) {
  const log = (tx, adminId, action, targetType, targetId, note = null) =>
    tx.run('INSERT INTO admin_log (admin_id, action, target_type, target_id, note) VALUES ($1, $2, $3, $4, $5)', [adminId, action, targetType, targetId, note]);

  const listingOr404 = async (id) => {
    const row = await db.get('SELECT * FROM listings WHERE id = $1', [idParam(id)]);
    if (!row) throw new HttpError(404, 'not_found');
    return row;
  };

  app.use('/api/admin', requireAdmin);

  app.get('/api/admin/overview', async (_req, res) => {
    const [counts, sources, pairs] = await Promise.all([
      db.get(`SELECT
        (SELECT COUNT(*) FROM listings WHERE status = 'pending') AS pending_listings,
        (SELECT COUNT(*) FROM listings WHERE status = 'rejected') AS rejected_listings,
        (SELECT COUNT(*) FROM listings WHERE status = 'approved' AND duplicate_of IS NULL) AS live_listings,
        (SELECT COUNT(*) FROM reviews WHERE status = 'pending') AS pending_reviews,
        (SELECT COUNT(*) FROM reviews WHERE status = 'rejected') AS rejected_reviews,
        (SELECT COUNT(*) FROM reports WHERE status = 'open') AS open_reports,
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM users WHERE blocked_at IS NOT NULL) AS blocked_users`),
      db.all(`SELECT CASE WHEN source_type = 'app' THEN 'app' WHEN source_type = 'test' THEN 'test'
                WHEN source_name LIKE 't.me/%' THEN 'telegram' WHEN source_name = 'krisha.kz' THEN 'krisha' ELSE 'other' END AS source,
              COUNT(*) AS n FROM listings GROUP BY 1 ORDER BY 2 DESC`),
      duplicateCandidates(db),
    ]);
    res.json({
      pendingListings: counts.pending_listings,
      rejectedListings: counts.rejected_listings,
      liveListings: counts.live_listings,
      pendingReviews: counts.pending_reviews,
      rejectedReviews: counts.rejected_reviews,
      openReports: counts.open_reports,
      users: counts.users,
      blockedUsers: counts.blocked_users,
      duplicatePairs: pairs.length,
      sources: Object.fromEntries(sources.map((row) => [row.source, row.n])),
    });
  });

  // Listings
  app.get('/api/admin/listings', async (req, res) => {
    const where = [];
    const params = [];
    const param = (value) => `$${params.push(value)}`;
    const { status, source, q, reported } = req.query;
    if (LISTING_STATUSES.has(status)) where.push(`listings.status = ${param(status)}`);
    if (SOURCES[source]) where.push(SOURCES[source]);
    if (reported === '1') where.push(`EXISTS (SELECT 1 FROM reports WHERE reports.listing_id = listings.id AND reports.status = 'open')`);
    const text = String(q ?? '').trim().slice(0, 100);
    if (/^\d+$/.test(text)) where.push(`listings.id = ${param(Number(text))}`);
    else if (text) where.push(`(listings.title ILIKE ${param(`%${text}%`)} OR listings.address ILIKE $${params.length} OR owner.name ILIKE $${params.length} OR owner.phone ILIKE $${params.length})`);
    const page = toInt(req.query.page, 1, 10_000) || 1;
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows, { total }] = await Promise.all([
      db.all(`${LISTING_SELECT} ${filter} ORDER BY listings.status = 'pending' DESC, report_count DESC, listings.id DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`, params),
      db.get(`SELECT COUNT(*) AS total FROM listings LEFT JOIN users owner ON owner.id = listings.user_id ${filter}`, params),
    ]);
    res.json({ items: rows.map(listingSummary), total, page, pageSize: PAGE_SIZE });
  });

  app.post('/api/admin/listings/:id/moderate', async (req, res) => {
    const row = await listingOr404(req.params.id);
    const decision = decisionOf(req.body);
    const reason = reasonOf(req.body, decision);
    const status = decision === 'approve' ? 'approved' : 'rejected';
    await db.transaction(async (tx) => {
      await tx.run('UPDATE listings SET status = $1, moderation_reason = $2, moderated_by = $3 WHERE id = $4', [status, reason, req.user.id, row.id]);
      // Taking an ad down settles the complaints about it.
      if (status === 'rejected') {
        await tx.run(`UPDATE reports SET status = 'resolved', resolved_by = $1, resolved_at = now() WHERE listing_id = $2 AND status = 'open'`, [req.user.id, row.id]);
      }
      await log(tx, req.user.id, decision, 'listing', row.id, reason);
    });
    res.json({ status, moderationReason: reason });
  });

  app.delete('/api/admin/listings/:id', async (req, res) => {
    const row = await listingOr404(req.params.id);
    const files = await db.all('SELECT filename FROM photos WHERE listing_id = $1', [row.id]);
    await db.transaction(async (tx) => {
      await tx.run('DELETE FROM listings WHERE id = $1', [row.id]);
      await log(tx, req.user.id, 'delete', 'listing', row.id, row.title);
    });
    removeFiles(files.map(({ filename }) => filename));
    res.status(204).end();
  });

  // Reviews
  app.get('/api/admin/reviews', async (req, res) => {
    const status = LISTING_STATUSES.has(req.query.status) ? req.query.status : null;
    const rows = await db.all(
      `SELECT reviews.*, author.name AS author_name, listings.title AS listing_title, moderator.name AS moderator_name
       FROM reviews
       JOIN users author ON author.id = reviews.user_id
       JOIN listings ON listings.id = reviews.listing_id
       LEFT JOIN users moderator ON moderator.id = reviews.moderated_by
       ${status ? 'WHERE reviews.status = $1' : ''}
       ORDER BY reviews.status = 'pending' DESC, reviews.id DESC LIMIT ${PAGE_SIZE}`,
      status ? [status] : [],
    );
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        text: row.text,
        status: row.status,
        moderationReason: row.moderation_reason,
        moderatedBy: row.moderator_name,
        author: { id: row.user_id, name: row.author_name },
        listing: { id: row.listing_id, title: row.listing_title },
        createdAt: row.created_at,
      })),
    });
  });

  app.post('/api/admin/reviews/:id/moderate', async (req, res) => {
    const row = await db.get('SELECT id FROM reviews WHERE id = $1', [idParam(req.params.id)]);
    if (!row) throw new HttpError(404, 'not_found');
    const decision = decisionOf(req.body);
    const reason = reasonOf(req.body, decision);
    const status = decision === 'approve' ? 'approved' : 'rejected';
    await db.transaction(async (tx) => {
      await tx.run('UPDATE reviews SET status = $1, moderation_reason = $2, moderated_by = $3 WHERE id = $4', [status, reason, req.user.id, row.id]);
      await log(tx, req.user.id, decision, 'review', row.id, reason);
    });
    res.json({ status, moderationReason: reason });
  });

  // Complaints
  app.get('/api/admin/reports', async (req, res) => {
    const status = REPORT_STATUSES.has(req.query.status) ? req.query.status : 'open';
    const rows = await db.all(
      `SELECT reports.*, reporter.name AS reporter_name, listings.title AS listing_title, listings.status AS listing_status,
         (SELECT COUNT(*) FROM reports other WHERE other.listing_id = reports.listing_id AND other.status = 'open') AS open_count
       FROM reports
       JOIN users reporter ON reporter.id = reports.user_id
       JOIN listings ON listings.id = reports.listing_id
       WHERE reports.status = $1
       ORDER BY open_count DESC, reports.id DESC LIMIT ${PAGE_SIZE}`,
      [status],
    );
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        reason: row.reason,
        comment: row.comment,
        status: row.status,
        reporter: { id: row.user_id, name: row.reporter_name },
        listing: { id: row.listing_id, title: row.listing_title, status: row.listing_status, openReports: row.open_count },
        createdAt: row.created_at,
      })),
    });
  });

  app.post('/api/admin/reports/:id', async (req, res) => {
    const status = req.body?.status;
    if (status !== 'resolved' && status !== 'dismissed') throw fieldError('status');
    const row = await db.get('SELECT id FROM reports WHERE id = $1', [idParam(req.params.id)]);
    if (!row) throw new HttpError(404, 'not_found');
    await db.transaction(async (tx) => {
      await tx.run('UPDATE reports SET status = $1, resolved_by = $2, resolved_at = now() WHERE id = $3', [status, req.user.id, row.id]);
      await log(tx, req.user.id, status === 'resolved' ? 'resolve' : 'dismiss', 'report', row.id);
    });
    res.json({ status });
  });

  // Duplicates
  app.get('/api/admin/duplicates', async (_req, res) => {
    const pairs = await duplicateCandidates(db);
    res.json({ items: pairs.slice(0, PAGE_SIZE).map(({ a, b, score, reasons }) => ({ a: listingSummary(a), b: listingSummary(b), score, reasons })), total: pairs.length });
  });

  app.post('/api/admin/duplicates/merge', async (req, res) => {
    const keep = await listingOr404(req.body?.keepId);
    const copy = await listingOr404(req.body?.duplicateId);
    if (keep.id === copy.id) throw fieldError('duplicateId');
    if (keep.duplicate_of) throw new HttpError(409, 'already_duplicate');
    await db.transaction(async (tx) => {
      await tx.run('UPDATE listings SET duplicate_of = $1 WHERE id = $2', [keep.id, copy.id]);
      // Copies of the copy now point at the ad that stays.
      await tx.run('UPDATE listings SET duplicate_of = $1 WHERE duplicate_of = $2', [keep.id, copy.id]);
      await log(tx, req.user.id, 'merge', 'listing', copy.id, `→ ${keep.id}`);
    });
    res.json({ keepId: keep.id, duplicateId: copy.id });
  });

  app.post('/api/admin/duplicates/dismiss', async (req, res) => {
    const a = await listingOr404(req.body?.a);
    const b = await listingOr404(req.body?.b);
    if (a.id === b.id) throw fieldError('b');
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO duplicate_dismissals (low_id, high_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [Math.min(a.id, b.id), Math.max(a.id, b.id)]);
      await log(tx, req.user.id, 'not_duplicate', 'listing', Math.min(a.id, b.id), String(Math.max(a.id, b.id)));
    });
    res.status(204).end();
  });

  app.post('/api/admin/listings/:id/unmerge', async (req, res) => {
    const row = await listingOr404(req.params.id);
    if (!row.duplicate_of) throw new HttpError(409, 'not_duplicate');
    await db.transaction(async (tx) => {
      await tx.run('UPDATE listings SET duplicate_of = NULL WHERE id = $1', [row.id]);
      await tx.run('INSERT INTO duplicate_dismissals (low_id, high_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [Math.min(row.id, row.duplicate_of), Math.max(row.id, row.duplicate_of)]);
      await log(tx, req.user.id, 'unmerge', 'listing', row.id, String(row.duplicate_of));
    });
    res.status(204).end();
  });

  // Users
  app.get('/api/admin/users', async (req, res) => {
    const text = String(req.query.q ?? '').trim().slice(0, 100);
    const rows = await db.all(
      `SELECT users.id, users.name, users.phone, users.email, users.role, users.blocked_at, users.created_at,
         (SELECT COUNT(*) FROM listings WHERE listings.user_id = users.id) AS listing_count,
         (SELECT COUNT(*) FROM reports JOIN listings ON listings.id = reports.listing_id WHERE listings.user_id = users.id AND reports.status != 'dismissed') AS report_count
       FROM users
       ${text ? 'WHERE users.name ILIKE $1 OR users.email ILIKE $1 OR users.phone ILIKE $1' : ''}
       ORDER BY users.id DESC LIMIT ${PAGE_SIZE}`,
      text ? [`%${text}%`] : [],
    );
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        phone: row.phone,
        email: row.email,
        role: row.role,
        blocked: Boolean(row.blocked_at),
        createdAt: row.created_at,
        listingCount: row.listing_count,
        reportCount: row.report_count,
        isMe: row.id === req.user.id,
      })),
    });
  });

  app.post('/api/admin/users/:id/block', async (req, res) => {
    const row = await db.get('SELECT id, role FROM users WHERE id = $1', [idParam(req.params.id)]);
    if (!row) throw new HttpError(404, 'not_found');
    if (row.id === req.user.id || row.role === 'admin') throw new HttpError(403, 'cannot_block_admin');
    const blocked = req.body?.blocked === true;
    await db.transaction(async (tx) => {
      await tx.run(`UPDATE users SET blocked_at = ${blocked ? 'now()' : 'NULL'} WHERE id = $1`, [row.id]);
      // A blocked person is logged out everywhere at once.
      if (blocked) await tx.run('DELETE FROM sessions WHERE user_id = $1', [row.id]);
      await log(tx, req.user.id, blocked ? 'block' : 'unblock', 'user', row.id);
    });
    onContentChanged();
    res.json({ blocked });
  });

  app.get('/api/admin/log', async (_req, res) => {
    const rows = await db.all(
      `SELECT admin_log.*, users.name AS admin_name FROM admin_log LEFT JOIN users ON users.id = admin_log.admin_id ORDER BY admin_log.id DESC LIMIT 100`,
    );
    res.json({
      items: rows.map((row) => ({ id: row.id, admin: row.admin_name, action: row.action, targetType: row.target_type, targetId: row.target_id, note: row.note, createdAt: row.created_at })),
    });
  });
}
