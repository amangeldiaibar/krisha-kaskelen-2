import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { SDU } from './config.js';
import { isUniqueViolation } from './db.js';
import { distanceKm } from './geo.js';
import { COOKIE, USER_COLUMNS, createSession, destroySession, hashPassword, loadUser, readCookie, requireUser, verifyPassword } from './auth.js';
import { normalizePhone } from '../shared/phones.js';
import { sniffImage } from './images.js';
import { DgisError } from './services/dgis.js';
import { HttpError, fieldError, idParam, toInt } from './http.js';
import { registerAdminRoutes } from './admin.js';
import { REPOST_THRESHOLD, compareListings } from './services/duplicates.js';
import { FEATURES, FEATURE_NAMES, SORTS, createSearchParser } from './services/search.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DISTRICTS = new Set(['near_sdu', 'center', 'new']);
const LANGS = new Set(['ru', 'en', 'kk']);
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAP_LIMITS = { minZoom: 8, maxZoom: 18, maxDegreesFromSdu: 1 };
const STREAM_PING_MS = 25_000;
const MAX_COMPARE = 4;
/** Ads on one page of search results. */
const SEARCH_PAGE_SIZE = 20;
const REPORT_REASONS = new Set(['fraud', 'wrong_info', 'unavailable', 'duplicate', 'offensive', 'other']);
const SEARCH_TEXT = "lower(listings.title || ' ' || listings.description)";
const likeAny = (words) => words.map((word) => `%${word}%`);

/** Which amenities an ad mentions: true, false when it says the opposite, or null when it says nothing. */
function amenitiesOf(row) {
  const text = `${row.title} ${row.description}`.toLowerCase().replace(/ё/g, 'е');
  return Object.fromEntries(
    FEATURE_NAMES.map((name) => {
      const { words, not } = FEATURES[name];
      if (not.some((word) => text.includes(word))) return [name, false];
      return [name, words.some((word) => text.includes(word)) ? true : null];
    }),
  );
}

const SORTERS = {
  distance: (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity),
  price_asc: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
  price_desc: (a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity),
  new: (a, b) => b.id - a.id,
};

function validateListing(body) {
  const fail = (field) => {
    throw fieldError(field);
  };
  const text = (field, min, max) => {
    const value = String(body[field] ?? '').trim();
    if (value.length < min || value.length > max) fail(field);
    return value;
  };
  const required = (field, min, max) => {
    const value = toInt(body[field], min, max);
    if (value === null || value === undefined) fail(field);
    return value;
  };
  const optional = (field, min, max) => {
    const value = toInt(body[field], min, max);
    if (value === undefined) fail(field);
    return value;
  };
  const deal = body.deal;
  if (deal !== 'rent' && deal !== 'buy') fail('deal');
  if (!DISTRICTS.has(body.district)) fail('district');
  const phone = normalizePhone(body.phone);
  if (!phone) fail('phone');
  const listing = {
    title: text('title', 3, 120),
    deal,
    price: required('price', 0, 10_000_000_000),
    rooms: required('rooms', 0, 4),
    area: required('area', 1, 2000),
    floor: optional('floor', 1, 200),
    floors: optional('floors', 1, 200),
    year: optional('year', 1900, new Date().getFullYear()),
    district: body.district,
    address: text('address', 3, 200),
    description: text('description', 10, 5000),
    phone,
  };
  if (listing.floor && listing.floors && listing.floor > listing.floors) fail('floor');
  return listing;
}

const langOf = (req) => (LANGS.has(req.body?.lang) ? req.body.lang : 'ru');

export function createApp({ db, dgis, uploadsDir, clientDist, searchParser = createSearchParser(), secureCookies = false, authRateLimit = 30, onContentChanged = () => {} }) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use(loadUser(db));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PHOTO_BYTES, files: 10 },
  });
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: authRateLimit, standardHeaders: true, legacyHeaders: false, message: { error: 'too_many_requests' } });
  const searchLimiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'too_many_requests' } });
  const mapLimiter = rateLimit({ windowMs: 60 * 1000, limit: 1200, standardHeaders: true, legacyHeaders: false, message: { error: 'too_many_requests' } });

  const setSession = async (res, userId) => {
    const { token, maxAge } = await createSession(db, userId);
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: secureCookies, maxAge, path: '/' });
  };

  const photosOf = async (id) =>
    (await db.all('SELECT filename FROM photos WHERE listing_id = $1 ORDER BY position', [id])).map((photo) => `/uploads/${photo.filename}`);

  async function present(row, userId, includeModeration = false) {
    const point = row.lat !== null && row.lon !== null ? { lat: row.lat, lon: row.lon } : null;
    const [photos, myRequest, favorite] = await Promise.all([
      photosOf(row.id),
      userId ? db.get('SELECT id, status FROM deal_requests WHERE listing_id = $1 AND requester_id = $2 ORDER BY id DESC LIMIT 1', [row.id, userId]) : null,
      userId ? db.get('SELECT 1 FROM favorites WHERE user_id = $1 AND listing_id = $2', [userId, row.id]) : null,
    ]);
    return {
      id: row.id,
      title: row.title,
      deal: row.deal,
      price: row.price,
      rooms: row.rooms,
      area: row.area,
      floor: row.floor,
      floors: row.floors,
      year: row.year,
      district: row.district,
      address: row.address,
      description: row.description,
      phone: row.phone,
      point,
      distanceKm: point ? Math.round(distanceKm(SDU, point) * 10) / 10 : null,
      source: { type: row.source_type, name: row.source_name, url: row.source_url },
      photos,
      photosAreExamples: row.source_type === 'test',
      isOwner: Boolean(userId && row.user_id === userId),
      canChat: Boolean(row.user_id && row.user_id !== userId),
      dealStatus: row.deal_status,
      canRequest: Boolean(row.user_id && row.user_id !== userId && row.deal_status === 'available' && row.status === 'approved'),
      myRequest: myRequest ?? null,
      isFavorite: Boolean(favorite),
      duplicateOf: row.duplicate_of ?? null,
      ...(includeModeration ? { status: row.status, moderationReason: row.moderation_reason } : {}),
    };
  }

  const presentAll = (rows, userId, includeModeration) => Promise.all(rows.map((row) => present(row, userId, includeModeration)));

  const findVisible = async (id, user) => {
    const row = await db.get('SELECT * FROM listings WHERE id = $1', [idParam(id)]);
    if (!row) throw new HttpError(404, 'not_found');
    // Admins see ads at every stage, so they can check them before deciding.
    if (row.status !== 'approved' && row.user_id !== user?.id && user?.role !== 'admin') throw new HttpError(404, 'not_found');
    return row;
  };

  /** Replaces a listing's photos. Old files are deleted only after the transaction commits. */
  async function savePhotos(tx, listingId, files) {
    const prepared = files.map((file) => {
      const type = sniffImage(file.buffer);
      if (!type) throw new HttpError(422, 'invalid_photo');
      return { ...type, buffer: file.buffer, filename: `${crypto.randomUUID()}.${type.ext}` };
    });
    const old = await tx.all('SELECT filename FROM photos WHERE listing_id = $1', [listingId]);
    await tx.run('DELETE FROM photos WHERE listing_id = $1', [listingId]);
    for (const [position, photo] of prepared.entries()) {
      fs.writeFileSync(path.join(uploadsDir, photo.filename), photo.buffer);
      await tx.run('INSERT INTO photos (listing_id, filename, mime, position) VALUES ($1, $2, $3, $4)', [listingId, photo.filename, photo.mime, position]);
    }
    return old.map(({ filename }) => filename);
  }

  const removeFiles = (filenames) => {
    for (const filename of filenames) fs.rmSync(path.join(uploadsDir, filename), { force: true });
  };

  /** A failed 2GIS call still saves the listing, and the worker retries the lookup. */
  async function locate(address) {
    try {
      const point = await dgis.geocode(address);
      if (!point) throw new HttpError(422, 'address_not_found');
      return point;
    } catch (error) {
      if (error instanceof DgisError || error.name === 'TimeoutError' || error instanceof TypeError) {
        return { lat: null, lon: null };
      }
      throw error;
    }
  }

  // Auth
  const publicUser = (id) => db.get(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);

  app.post('/api/auth/register', authLimiter, async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    const phone = normalizePhone(req.body?.phone);
    const email = String(req.body?.email ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (name.length < 2 || name.length > 100) throw fieldError('name');
    if (!phone) throw fieldError('phone');
    if (!EMAIL.test(email) || email.length > 200) throw fieldError('email');
    if (password.length < 8 || password.length > 200) throw fieldError('password');
    const hash = await hashPassword(password);
    let id;
    try {
      ({ id } = await db.get('INSERT INTO users (name, phone, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING id', [name, phone, email, hash]));
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, 'account_exists');
      throw error;
    }
    await setSession(res, id);
    res.status(201).json({ user: await publicUser(id) });
  });

  app.post('/api/auth/login', authLimiter, async (req, res) => {
    const login = String(req.body?.login ?? '').trim();
    const password = String(req.body?.password ?? '');
    const user = await db.get('SELECT * FROM users WHERE lower(email) = lower($1) OR phone = $2', [login, normalizePhone(login) ?? login]);
    if (!user || !(await verifyPassword(password, user.password_hash))) throw new HttpError(401, 'bad_credentials');
    if (user.blocked_at) throw new HttpError(403, 'account_blocked');
    await setSession(res, user.id);
    res.json({ user: await publicUser(user.id) });
  });

  app.post('/api/auth/logout', async (req, res) => {
    await destroySession(db, readCookie(req, COOKIE));
    res.clearCookie(COOKIE, { path: '/' });
    res.status(204).end();
  });

  app.get('/api/auth/me', (req, res) => res.json({ user: req.user }));

  app.put('/api/auth/profile', requireUser, upload.single('photo'), async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    const phone = normalizePhone(req.body?.phone);
    if (name.length < 2 || name.length > 100) throw fieldError('name');
    if (!phone) throw fieldError('phone');
    const type = req.file ? sniffImage(req.file.buffer) : null;
    if (req.file && !type) throw new HttpError(422, 'invalid_photo');

    const { avatar: old } = await db.get('SELECT avatar FROM users WHERE id = $1', [req.user.id]);
    let avatar = req.body?.removePhoto === '1' ? null : old;
    if (type) {
      avatar = `${crypto.randomUUID()}.${type.ext}`;
      fs.writeFileSync(path.join(uploadsDir, avatar), req.file.buffer);
    }
    try {
      await db.run('UPDATE users SET name = $1, phone = $2, avatar = $3 WHERE id = $4', [name, phone, avatar, req.user.id]);
    } catch (error) {
      if (type) fs.rmSync(path.join(uploadsDir, avatar), { force: true });
      if (isUniqueViolation(error)) throw new HttpError(409, 'account_exists');
      throw error;
    }
    if (old && old !== avatar) fs.rmSync(path.join(uploadsDir, old), { force: true });
    res.json({ user: await publicUser(req.user.id) });
  });

  app.post('/api/auth/password', authLimiter, requireUser, async (req, res) => {
    const password = String(req.body?.password ?? '');
    if (password.length < 8 || password.length > 200) throw fieldError('password');
    const { password_hash: hash } = await db.get('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await verifyPassword(String(req.body?.current ?? ''), hash))) throw new HttpError(403, 'wrong_password');
    const newHash = await hashPassword(password);
    // Every other device is logged out, and this one gets a fresh session.
    await db.transaction(async (tx) => {
      await tx.run('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]);
      await tx.run('DELETE FROM sessions WHERE user_id = $1', [req.user.id]);
    });
    await setSession(res, req.user.id);
    res.status(204).end();
  });

  // Listings
  app.get('/api/listings', async (req, res) => {
    // Confirmed copies and ads of blocked people stay out of search.
    const where = [
      `status = 'approved'`,
      `deal_status = 'available'`,
      'duplicate_of IS NULL',
      'NOT EXISTS (SELECT 1 FROM users WHERE users.id = listings.user_id AND users.blocked_at IS NOT NULL)',
    ];
    const params = [];
    // Adds a value and returns its numbered placeholder.
    const param = (value) => `$${params.push(value)}`;
    const { deal, rooms, priceFrom, priceTo, yearFrom, yearTo, district } = req.query;
    if (deal === 'rent' || deal === 'buy') where.push(`deal = ${param(deal)}`);
    if (rooms === '3+') where.push('rooms >= 3');
    else if (toInt(rooms, 0, 4) !== null && toInt(rooms, 0, 4) !== undefined) where.push(`rooms = ${param(Number(rooms))}`);
    const range = (value, clause) => {
      const number = toInt(value, 0, 10_000_000_000);
      if (number !== null && number !== undefined) where.push(`${clause} ${param(number)}`);
    };
    range(priceFrom, 'price >=');
    range(priceTo, 'price <=');
    range(yearFrom, 'year >=');
    range(yearTo, 'year <=');
    if (DISTRICTS.has(district)) where.push(`district = ${param(district)}`);
    for (const name of String(req.query.features ?? '').split(',')) {
      if (!FEATURES[name]) continue;
      const { words, not } = FEATURES[name];
      where.push(`${SEARCH_TEXT} LIKE ANY(${param(likeAny(words))}::text[])`);
      if (not.length) where.push(`NOT (${SEARCH_TEXT} LIKE ANY(${param(likeAny(not))}::text[]))`);
    }
    const maxKm = Number(req.query.maxKm);
    const hasMaxKm = Number.isFinite(maxKm) && maxKm > 0 && maxKm <= 50;
    if (hasMaxKm) where.push('lat IS NOT NULL');
    const rows = await db.all(`SELECT * FROM listings WHERE ${where.join(' AND ')} ORDER BY id DESC`, params);
    const sort = SORTS.includes(req.query.sort) ? req.query.sort : 'distance';
    const items = (await presentAll(rows, req.user?.id)).filter((item) => !hasMaxKm || item.distanceKm <= maxKm).sort(SORTERS[sort]);
    // Distance is only known after present(), so the page is cut here and not in SQL.
    const pages = Math.max(1, Math.ceil(items.length / SEARCH_PAGE_SIZE));
    const page = Math.min(toInt(req.query.page, 1, 100_000) || 1, pages);
    res.json({
      sdu: { lat: SDU.lat, lon: SDU.lon },
      items: items.slice((page - 1) * SEARCH_PAGE_SIZE, page * SEARCH_PAGE_SIZE),
      total: items.length,
      page,
      pages,
    });
  });

  // Turns a phrase such as "однушка до 120к рядом с SDU" into the filters above.
  app.post('/api/search/parse', searchLimiter, async (req, res) => {
    const query = String(req.body?.query ?? '').trim();
    if (query.length < 2 || query.length > 300) throw fieldError('query');
    res.json(await searchParser.parse(query));
  });

  app.get('/api/listings/compare', async (req, res) => {
    const ids = [...new Set(String(req.query.ids ?? '').split(',').map((value) => toInt(value, 1, 2_147_483_647)).filter(Boolean))].slice(0, MAX_COMPARE);
    if (ids.length === 0) return res.json({ items: [] });
    const [rows, reviews] = await Promise.all([
      db.all(`SELECT * FROM listings WHERE id = ANY($1::int[]) AND (status = 'approved' OR user_id = $2)`, [ids, req.user?.id ?? -1]),
      db.all(`SELECT listing_id, COUNT(*) AS n FROM reviews WHERE status = 'approved' AND listing_id = ANY($1::int[]) GROUP BY listing_id`, [ids]),
    ]);
    const reviewCount = new Map(reviews.map((row) => [row.listing_id, row.n]));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = await Promise.all(
      ids.filter((id) => byId.has(id)).map(async (id) => {
        const row = byId.get(id);
        return {
          ...(await present(row, req.user?.id)),
          pricePerM2: row.price && row.area ? Math.round(row.price / row.area) : null,
          reviewCount: reviewCount.get(id) ?? 0,
          amenities: amenitiesOf(row),
        };
      }),
    );
    res.json({ items });
  });

  app.get('/api/listings/mine', requireUser, async (req, res) => {
    const rows = await db.all('SELECT * FROM listings WHERE user_id = $1 ORDER BY id DESC', [req.user.id]);
    res.json({ items: await presentAll(rows, req.user.id, true) });
  });

  app.get('/api/listings/:id', async (req, res) => {
    const row = await findVisible(req.params.id, req.user);
    // The same apartment posted elsewhere, which an admin merged into this ad.
    const copies = await db.all(
      `SELECT id, source_type, source_name, source_url FROM listings WHERE duplicate_of = $1 AND status = 'approved' ORDER BY id`,
      [row.id],
    );
    res.json({
      sdu: { lat: SDU.lat, lon: SDU.lon },
      item: {
        ...(await present(row, req.user?.id, row.user_id === req.user?.id || req.user?.role === 'admin')),
        alsoPublished: copies.map((copy) => ({ id: copy.id, source: { type: copy.source_type, name: copy.source_name, url: copy.source_url } })),
      },
    });
  });

  app.post('/api/listings/:id/reports', requireUser, async (req, res) => {
    const listing = await findVisible(req.params.id, req.user);
    if (listing.user_id === req.user.id) throw new HttpError(403, 'own_listing_report');
    if (!REPORT_REASONS.has(req.body?.reason)) throw fieldError('reason');
    const comment = String(req.body?.comment ?? '').trim();
    if (comment.length > 1000) throw fieldError('comment');
    try {
      await db.run('INSERT INTO reports (listing_id, user_id, reason, comment) VALUES ($1, $2, $3, $4)', [listing.id, req.user.id, req.body.reason, comment || null]);
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, 'report_exists');
      throw error;
    }
    res.status(201).json({ status: 'open' });
  });

  app.post('/api/listings', requireUser, upload.array('photos', 10), async (req, res) => {
    const listing = validateListing(req.body);
    // Posting the same apartment again only pushes the other ads down, so it is refused.
    const own = await db.all(`SELECT * FROM listings WHERE user_id = $1 AND status != 'rejected' AND deal_status = 'available'`, [req.user.id]);
    const repost = own.find((row) => compareListings({ ...listing, id: 0 }, row).score >= REPOST_THRESHOLD);
    if (repost) throw Object.assign(new HttpError(409, 'duplicate_listing'), { existingId: repost.id });
    const point = await locate(listing.address);
    const id = await db.transaction(async (tx) => {
      const { id: newId } = await tx.get(
        `INSERT INTO listings (user_id, source_type, title, deal, price, rooms, area, floor, floors, year, district, address, description, phone, lat, lon, moderation_lang)
         VALUES ($1, 'app', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
        [req.user.id, listing.title, listing.deal, listing.price, listing.rooms, listing.area, listing.floor, listing.floors, listing.year, listing.district, listing.address, listing.description, listing.phone, point.lat, point.lon, langOf(req)],
      );
      await savePhotos(tx, newId, req.files ?? []);
      return newId;
    });
    onContentChanged();
    res.status(201).json({ item: await present(await db.get('SELECT * FROM listings WHERE id = $1', [id]), req.user.id, true) });
  });

  app.put('/api/listings/:id', requireUser, upload.array('photos', 10), async (req, res) => {
    const row = await db.get('SELECT * FROM listings WHERE id = $1', [idParam(req.params.id)]);
    if (!row) throw new HttpError(404, 'not_found');
    if (row.user_id !== req.user.id) throw new HttpError(403, 'forbidden');
    const listing = validateListing(req.body);
    const point = listing.address === row.address && row.lat !== null ? { lat: row.lat, lon: row.lon } : await locate(listing.address);
    const oldFiles = await db.transaction(async (tx) => {
      await tx.run(
        `UPDATE listings SET title = $1, deal = $2, price = $3, rooms = $4, area = $5, floor = $6, floors = $7, year = $8, district = $9, address = $10, description = $11, phone = $12, lat = $13, lon = $14,
           status = 'pending', moderation_reason = NULL, moderation_lang = $15, updated_at = clock_timestamp() WHERE id = $16`,
        [listing.title, listing.deal, listing.price, listing.rooms, listing.area, listing.floor, listing.floors, listing.year, listing.district, listing.address, listing.description, listing.phone, point.lat, point.lon, langOf(req), row.id],
      );
      return req.files?.length ? savePhotos(tx, row.id, req.files) : [];
    });
    removeFiles(oldFiles);
    onContentChanged();
    res.json({ item: await present(await db.get('SELECT * FROM listings WHERE id = $1', [row.id]), req.user.id, true) });
  });

  app.delete('/api/listings/:id', requireUser, async (req, res) => {
    const row = await db.get('SELECT id, user_id FROM listings WHERE id = $1', [idParam(req.params.id)]);
    if (!row) throw new HttpError(404, 'not_found');
    if (row.user_id !== req.user.id) throw new HttpError(403, 'forbidden');
    const files = await db.all('SELECT filename FROM photos WHERE listing_id = $1', [row.id]);
    // Foreign keys remove its photos, reviews, favorites, requests and chats.
    await db.run('DELETE FROM listings WHERE id = $1', [row.id]);
    removeFiles(files.map(({ filename }) => filename));
    res.status(204).end();
  });

  // Favorites
  app.get('/api/favorites', requireUser, async (req, res) => {
    const rows = await db.all(
      `SELECT listings.* FROM favorites JOIN listings ON listings.id = favorites.listing_id
       WHERE favorites.user_id = $1 AND listings.status = 'approved' ORDER BY favorites.created_at DESC`,
      [req.user.id],
    );
    res.json({ items: await presentAll(rows, req.user.id) });
  });

  app.put('/api/favorites/:id', requireUser, async (req, res) => {
    const row = await findVisible(req.params.id, req.user);
    await db.run('INSERT INTO favorites (user_id, listing_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, row.id]);
    res.status(204).end();
  });

  app.delete('/api/favorites/:id', requireUser, async (req, res) => {
    await db.run('DELETE FROM favorites WHERE user_id = $1 AND listing_id = $2', [req.user.id, idParam(req.params.id)]);
    res.status(204).end();
  });

  // Reviews
  app.get('/api/listings/:id/reviews', async (req, res) => {
    const listing = await findVisible(req.params.id, req.user);
    const rows = await db.all(
      `SELECT reviews.*, users.name AS author FROM reviews JOIN users ON users.id = reviews.user_id
       WHERE listing_id = $1 AND (status = 'approved' OR user_id = $2) ORDER BY reviews.id DESC`,
      [listing.id, req.user?.id ?? -1],
    );
    let external = { status: 'no_match', rating: null, count: 0, reviews: [] };
    if (listing.address) {
      try {
        external = await dgis.reviewsForAddress(listing.address);
      } catch (error) {
        console.warn(`2GIS reviews failed for listing ${listing.id}: ${error.message}`);
        external = { ...external, status: 'error' };
      }
    }
    const mine = req.user ? rows.find((row) => row.user_id === req.user.id) : null;
    res.json({
      app: rows.map((row) => ({
        id: row.id,
        text: row.text,
        author: row.author,
        createdAt: row.created_at,
        isMine: row.user_id === req.user?.id,
        status: row.user_id === req.user?.id ? row.status : undefined,
        moderationReason: row.user_id === req.user?.id ? row.moderation_reason : undefined,
      })),
      external,
      canReview: Boolean(req.user && listing.user_id !== req.user.id && listing.status === 'approved' && (!mine || mine.status === 'rejected')),
    });
  });

  app.post('/api/listings/:id/reviews', requireUser, async (req, res) => {
    const listing = await findVisible(req.params.id, req.user);
    if (listing.user_id === req.user.id) throw new HttpError(403, 'own_listing_review');
    if (listing.status !== 'approved') throw new HttpError(404, 'not_found');
    const text = String(req.body?.text ?? '').trim();
    if (text.length < 5 || text.length > 2000) throw fieldError('text');
    const lang = langOf(req);
    // Only a rejected review may be rewritten, so nobody gets a second published one.
    const changed = await db.run(
      `INSERT INTO reviews (listing_id, user_id, text, moderation_lang) VALUES ($1, $2, $3, $4)
       ON CONFLICT (listing_id, user_id) DO UPDATE
         SET text = excluded.text, moderation_lang = excluded.moderation_lang, status = 'pending', moderation_reason = NULL
         WHERE reviews.status = 'rejected'`,
      [listing.id, req.user.id, text, lang],
    );
    if (changed === 0) throw new HttpError(409, 'review_exists');
    onContentChanged();
    res.status(201).json({ status: 'pending' });
  });

  // Live chat. Each open chat page holds one event stream, and a new message is pushed to both sides at once.
  const streams = new Map();

  app.get('/api/events', requireUser, (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write(': connected\n\n');
    const userId = req.user.id;
    if (!streams.has(userId)) streams.set(userId, new Set());
    streams.get(userId).add(res);
    // A comment line keeps proxies from closing a quiet connection.
    const ping = setInterval(() => res.write(': ping\n\n'), STREAM_PING_MS);
    req.on('close', () => {
      clearInterval(ping);
      streams.get(userId)?.delete(res);
      if (streams.get(userId)?.size === 0) streams.delete(userId);
    });
  });

  const addMessage = async (tx, conversationId, senderId, text) =>
    (await tx.get('INSERT INTO messages (conversation_id, sender_id, text) VALUES ($1, $2, $3) RETURNING id', [conversationId, senderId, text])).id;

  async function announceMessage(conversationId) {
    const { renter_id: renterId, owner_id: ownerId } = await db.get(
      `SELECT conversations.renter_id, listings.user_id AS owner_id FROM conversations
       JOIN listings ON listings.id = conversations.listing_id WHERE conversations.id = $1`,
      [conversationId],
    );
    for (const userId of new Set([renterId, ownerId])) {
      for (const stream of streams.get(userId) ?? []) stream.write(`data: ${JSON.stringify({ type: 'message', conversationId })}\n\n`);
    }
  }

  // Rent and purchase requests
  const openConversation = async (tx, listingId, renterId) => {
    await tx.run('INSERT INTO conversations (listing_id, renter_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [listingId, renterId]);
    return (await tx.get('SELECT id FROM conversations WHERE listing_id = $1 AND renter_id = $2', [listingId, renterId])).id;
  };

  app.post('/api/listings/:id/requests', requireUser, async (req, res) => {
    const listing = await findVisible(req.params.id, req.user);
    if (listing.user_id === req.user.id) throw new HttpError(403, 'own_listing_deal');
    if (!listing.user_id) throw new HttpError(422, 'deal_unavailable');
    if (listing.status !== 'approved') throw new HttpError(404, 'not_found');
    if (listing.deal_status !== 'available') throw new HttpError(409, 'listing_closed');

    const message = String(req.body?.message ?? '').trim();
    if (message.length > 1000) throw fieldError('message');
    const date = req.body?.date ? String(req.body.date) : null;
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || date < yesterday)) {
      throw fieldError('date');
    }

    let conversationId = null;
    let id;
    try {
      id = await db.transaction(async (tx) => {
        const inserted = await tx.get(
          'INSERT INTO deal_requests (listing_id, requester_id, preferred_date, message) VALUES ($1, $2, $3, $4) RETURNING id',
          [listing.id, req.user.id, date, message || null],
        );
        if (message) {
          conversationId = await openConversation(tx, listing.id, req.user.id);
          await addMessage(tx, conversationId, req.user.id, message);
        }
        return inserted.id;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, 'request_exists');
      throw error;
    }
    if (conversationId) await announceMessage(conversationId);
    res.status(201).json({ id, status: 'pending' });
  });

  app.get('/api/requests', requireUser, async (req, res) => {
    const columns = `deal_requests.id, deal_requests.status, deal_requests.preferred_date, deal_requests.message, deal_requests.requester_id,
      listings.id AS listing_id, listings.title, listings.deal, listings.price`;
    const toJson = (row) => ({
      id: row.id,
      status: row.status,
      date: row.preferred_date,
      message: row.message,
      listing: { id: row.listing_id, title: row.title, deal: row.deal, price: row.price },
      person: { name: row.person_name, phone: row.person_phone },
    });
    const [incoming, outgoing] = await Promise.all([
      db.all(
        `SELECT ${columns}, users.name AS person_name, users.phone AS person_phone FROM deal_requests
         JOIN listings ON listings.id = deal_requests.listing_id
         JOIN users ON users.id = deal_requests.requester_id
         WHERE listings.user_id = $1 ORDER BY deal_requests.status = 'pending' DESC, deal_requests.id DESC`,
        [req.user.id],
      ),
      db.all(
        `SELECT ${columns}, users.name AS person_name, users.phone AS person_phone FROM deal_requests
         JOIN listings ON listings.id = deal_requests.listing_id
         JOIN users ON users.id = listings.user_id
         WHERE deal_requests.requester_id = $1 ORDER BY deal_requests.id DESC`,
        [req.user.id],
      ),
    ]);
    res.json({ incoming: incoming.map(toJson), outgoing: outgoing.map(toJson) });
  });

  const requestFor = async (id) => {
    const row = await db.get(
      `SELECT deal_requests.*, listings.user_id AS owner_id FROM deal_requests
       JOIN listings ON listings.id = deal_requests.listing_id WHERE deal_requests.id = $1`,
      [idParam(id)],
    );
    if (!row) throw new HttpError(404, 'not_found');
    return row;
  };
  const ownerRequest = async (req) => {
    const row = await requestFor(req.params.id);
    if (row.owner_id !== req.user.id) throw new HttpError(404, 'not_found');
    if (row.status !== 'pending') throw new HttpError(409, 'request_not_pending');
    return row;
  };

  app.post('/api/requests/:id/accept', requireUser, async (req, res) => {
    const row = await ownerRequest(req);
    await db.transaction(async (tx) => {
      await tx.run(`UPDATE deal_requests SET status = 'accepted' WHERE id = $1`, [row.id]);
      await tx.run(`UPDATE deal_requests SET status = 'declined' WHERE listing_id = $1 AND status = 'pending'`, [row.listing_id]);
      await tx.run(`UPDATE listings SET deal_status = 'closed' WHERE id = $1`, [row.listing_id]);
    });
    res.json({ status: 'accepted' });
  });

  app.post('/api/requests/:id/decline', requireUser, async (req, res) => {
    const row = await ownerRequest(req);
    await db.run(`UPDATE deal_requests SET status = 'declined' WHERE id = $1`, [row.id]);
    res.json({ status: 'declined' });
  });

  app.post('/api/requests/:id/cancel', requireUser, async (req, res) => {
    const row = await requestFor(req.params.id);
    if (row.requester_id !== req.user.id) throw new HttpError(404, 'not_found');
    if (row.status !== 'pending') throw new HttpError(409, 'request_not_pending');
    await db.run(`UPDATE deal_requests SET status = 'cancelled' WHERE id = $1`, [row.id]);
    res.json({ status: 'cancelled' });
  });

  app.post('/api/listings/:id/reopen', requireUser, async (req, res) => {
    const row = await db.get('SELECT * FROM listings WHERE id = $1', [idParam(req.params.id)]);
    if (!row) throw new HttpError(404, 'not_found');
    if (row.user_id !== req.user.id) throw new HttpError(403, 'forbidden');
    await db.transaction(async (tx) => {
      await tx.run(`UPDATE listings SET deal_status = 'available' WHERE id = $1`, [row.id]);
      await tx.run(`UPDATE deal_requests SET status = 'cancelled' WHERE listing_id = $1 AND status = 'accepted'`, [row.id]);
    });
    res.json({ dealStatus: 'available' });
  });

  // Chat
  const conversationFor = async (id, userId) => {
    const row = await db.get(
      `SELECT conversations.*, listings.title, listings.user_id AS owner_id FROM conversations
       JOIN listings ON listings.id = conversations.listing_id WHERE conversations.id = $1`,
      [idParam(id)],
    );
    if (!row || (row.renter_id !== userId && row.owner_id !== userId)) throw new HttpError(404, 'not_found');
    return row;
  };

  app.post('/api/listings/:id/conversation', requireUser, async (req, res) => {
    const listing = await findVisible(req.params.id, req.user);
    if (!listing.user_id) throw new HttpError(422, 'chat_unavailable');
    if (listing.user_id === req.user.id) throw new HttpError(403, 'own_listing_chat');
    res.status(201).json({ id: await openConversation(db, listing.id, req.user.id) });
  });

  app.get('/api/conversations', requireUser, async (req, res) => {
    const rows = await db.all(
      `SELECT conversations.id, listings.id AS listing_id, listings.title,
         CASE WHEN conversations.renter_id = $1 THEN owner.name ELSE renter.name END AS other_name,
         (SELECT text FROM messages WHERE conversation_id = conversations.id ORDER BY id DESC LIMIT 1) AS last_message
       FROM conversations
       JOIN listings ON listings.id = conversations.listing_id
       JOIN users renter ON renter.id = conversations.renter_id
       JOIN users owner ON owner.id = listings.user_id
       WHERE conversations.renter_id = $1 OR listings.user_id = $1
       ORDER BY conversations.id DESC`,
      [req.user.id],
    );
    res.json({
      items: rows.map((row) => ({ id: row.id, listingId: row.listing_id, title: row.title, otherName: row.other_name, lastMessage: row.last_message })),
    });
  });

  app.get('/api/conversations/:id/messages', requireUser, async (req, res) => {
    const conversation = await conversationFor(req.params.id, req.user.id);
    const rows = await db.all('SELECT * FROM messages WHERE conversation_id = $1 ORDER BY id', [conversation.id]);
    res.json({
      title: conversation.title,
      listingId: conversation.listing_id,
      items: rows.map((row) => ({ id: row.id, text: row.text, createdAt: row.created_at, isMine: row.sender_id === req.user.id })),
    });
  });

  app.post('/api/conversations/:id/messages', requireUser, async (req, res) => {
    const conversation = await conversationFor(req.params.id, req.user.id);
    const text = String(req.body?.text ?? '').trim();
    if (text.length < 1 || text.length > 2000) throw fieldError('text');
    const id = await addMessage(db, conversation.id, req.user.id, text);
    await announceMessage(conversation.id);
    res.status(201).json({ id, text, isMine: true });
  });

  // Map tiles. The browser asks this server, so it never sees the 2GIS key.
  // Only tiles around Kaskelen are served, so this is not an open proxy.
  const tileCache = new Map();
  const tileIndex = (lat, lon, z) => {
    const n = 2 ** z;
    const rad = (lat * Math.PI) / 180;
    return {
      x: Math.floor(((lon + 180) / 360) * n),
      y: Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n),
    };
  };
  app.get('/api/map/tile/:z/:x/:y', mapLimiter, async (req, res) => {
    const z = toInt(req.params.z, MAP_LIMITS.minZoom, MAP_LIMITS.maxZoom);
    const x = toInt(req.params.x, 0, 2 ** 18);
    const y = toInt(req.params.y, 0, 2 ** 18);
    if (!z || x === null || x === undefined || y === null || y === undefined) throw new HttpError(400, 'invalid_map_request');
    const d = MAP_LIMITS.maxDegreesFromSdu;
    const min = tileIndex(SDU.lat + d, SDU.lon - d, z);
    const max = tileIndex(SDU.lat - d, SDU.lon + d, z);
    if (x < min.x || x > max.x || y < min.y || y > max.y) throw new HttpError(400, 'invalid_map_request');
    const cacheKey = `${z}/${x}/${y}`;
    let image = tileCache.get(cacheKey);
    if (!image) {
      image = await dgis.tile({ z, x, y });
      if (tileCache.size >= 2000) tileCache.delete(tileCache.keys().next().value);
      tileCache.set(cacheKey, image);
    }
    res.set('Cache-Control', 'public, max-age=604800').type(image.type).send(image.body);
  });

  registerAdminRoutes(app, { db, removeFiles, onContentChanged });

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not_found')));

  app.use(
    '/uploads',
    express.static(uploadsDir, {
      setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff'),
    }),
  );

  if (clientDist && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((error, _req, res, _next) => {
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.code, field: error.field, existingId: error.existingId });
    if (error instanceof multer.MulterError) return res.status(422).json({ error: 'invalid_photo' });
    if (error instanceof DgisError || error.name === 'TimeoutError') {
      console.warn(error.message);
      return res.status(502).json({ error: 'map_unavailable' });
    }
    if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') return res.status(400).json({ error: 'bad_request' });
    console.error(error);
    res.status(500).json({ error: 'server_error' });
  });

  return app;
}
