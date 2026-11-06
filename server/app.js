import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { SDU } from './config.js';
import { transaction } from './db.js';
import { distanceKm } from './geo.js';
import { COOKIE, createSession, destroySession, hashPassword, loadUser, readCookie, requireUser, verifyPassword } from './auth.js';
import { normalizePhone } from './phone.js';
import { sniffImage } from './images.js';
import { DgisError } from './services/dgis.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DISTRICTS = new Set(['near_sdu', 'center', 'new']);
const LANGS = new Set(['ru', 'en', 'kk']);
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAP_LIMITS = { minZoom: 8, maxZoom: 18, maxWidth: 1280, maxHeight: 720, maxDegreesFromSdu: 1 };

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const toInt = (value, min, max) => {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : undefined;
};

function validateListing(body) {
  const fail = (field) => {
    throw Object.assign(new HttpError(422, 'invalid_field'), { field });
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

export function createApp({ db, dgis, uploadsDir, clientDist, secureCookies = false, authRateLimit = 30, onContentChanged = () => {} }) {
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
  const mapLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'too_many_requests' } });

  const setSession = (res, userId) => {
    const { token, maxAge } = createSession(db, userId);
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: secureCookies, maxAge, path: '/' });
  };

  const photosOf = (id) =>
    db.prepare('SELECT filename FROM photos WHERE listing_id = ? ORDER BY position').all(id).map((photo) => `/uploads/${photo.filename}`);

  function present(row, userId, includeModeration = false) {
    const point = row.lat !== null && row.lon !== null ? { lat: row.lat, lon: row.lon } : null;
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
      photos: photosOf(row.id),
      photosAreExamples: row.source_type === 'test',
      isOwner: Boolean(userId && row.user_id === userId),
      canChat: Boolean(row.user_id && row.user_id !== userId),
      dealStatus: row.deal_status,
      canRequest: Boolean(row.user_id && row.user_id !== userId && row.deal_status === 'available' && row.status === 'approved'),
      myRequest: userId
        ? (db
            .prepare('SELECT id, status FROM deal_requests WHERE listing_id = ? AND requester_id = ? ORDER BY id DESC LIMIT 1')
            .get(row.id, userId) ?? null)
        : null,
      isFavorite: userId
        ? Boolean(db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND listing_id = ?').get(userId, row.id))
        : false,
      ...(includeModeration ? { status: row.status, moderationReason: row.moderation_reason } : {}),
    };
  }

  const findVisible = (id, user) => {
    const row = db.prepare('SELECT * FROM listings WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'not_found');
    if (row.status !== 'approved' && row.user_id !== user?.id) throw new HttpError(404, 'not_found');
    return row;
  };

  function savePhotos(listingId, files) {
    const prepared = files.map((file) => {
      const type = sniffImage(file.buffer);
      if (!type) throw new HttpError(422, 'invalid_photo');
      return { ...type, buffer: file.buffer, filename: `${crypto.randomUUID()}.${type.ext}` };
    });
    const old = db.prepare('SELECT filename FROM photos WHERE listing_id = ?').all(listingId);
    db.prepare('DELETE FROM photos WHERE listing_id = ?').run(listingId);
    prepared.forEach((photo, position) => {
      fs.writeFileSync(path.join(uploadsDir, photo.filename), photo.buffer);
      db.prepare('INSERT INTO photos (listing_id, filename, mime, position) VALUES (?, ?, ?, ?)').run(listingId, photo.filename, photo.mime, position);
    });
    for (const { filename } of old) fs.rmSync(path.join(uploadsDir, filename), { force: true });
  }

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
  app.post('/api/auth/register', authLimiter, async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    const phone = normalizePhone(req.body?.phone);
    const email = String(req.body?.email ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (name.length < 2 || name.length > 100) throw Object.assign(new HttpError(422, 'invalid_field'), { field: 'name' });
    if (!phone) throw Object.assign(new HttpError(422, 'invalid_field'), { field: 'phone' });
    if (!EMAIL.test(email) || email.length > 200) throw Object.assign(new HttpError(422, 'invalid_field'), { field: 'email' });
    if (password.length < 8 || password.length > 200) throw Object.assign(new HttpError(422, 'invalid_field'), { field: 'password' });
    const hash = await hashPassword(password);
    let id;
    try {
      id = db.prepare('INSERT INTO users (name, phone, email, password_hash) VALUES (?, ?, ?, ?)').run(name, phone, email, hash).lastInsertRowid;
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw new HttpError(409, 'account_exists');
      throw error;
    }
    setSession(res, Number(id));
    res.status(201).json({ user: { id: Number(id), name, phone, email } });
  });

  app.post('/api/auth/login', authLimiter, async (req, res) => {
    const login = String(req.body?.login ?? '').trim();
    const password = String(req.body?.password ?? '');
    const user = db.prepare('SELECT * FROM users WHERE email = ? OR phone = ?').get(login, normalizePhone(login) ?? login);
    if (!user || !(await verifyPassword(password, user.password_hash))) throw new HttpError(401, 'bad_credentials');
    setSession(res, user.id);
    res.json({ user: { id: user.id, name: user.name, phone: user.phone, email: user.email } });
  });

  app.post('/api/auth/logout', (req, res) => {
    destroySession(db, readCookie(req, COOKIE));
    res.clearCookie(COOKIE, { path: '/' });
    res.status(204).end();
  });

  app.get('/api/auth/me', (req, res) => res.json({ user: req.user }));

  // Listings
  app.get('/api/listings', (req, res) => {
    const where = [`status = 'approved'`, `deal_status = 'available'`];
    const params = [];
    const { deal, rooms, priceFrom, priceTo, yearFrom, yearTo, district } = req.query;
    if (deal === 'rent' || deal === 'buy') {
      where.push('deal = ?');
      params.push(deal);
    }
    if (rooms === '3+') where.push('rooms >= 3');
    else if (toInt(rooms, 0, 4) !== null && toInt(rooms, 0, 4) !== undefined) {
      where.push('rooms = ?');
      params.push(Number(rooms));
    }
    const range = (value, clause) => {
      const number = toInt(value, 0, 10_000_000_000);
      if (number !== null && number !== undefined) {
        where.push(clause);
        params.push(number);
      }
    };
    range(priceFrom, 'price >= ?');
    range(priceTo, 'price <= ?');
    range(yearFrom, 'year >= ?');
    range(yearTo, 'year <= ?');
    if (DISTRICTS.has(district)) {
      where.push('district = ?');
      params.push(district);
    }
    const rows = db.prepare(`SELECT * FROM listings WHERE ${where.join(' AND ')} ORDER BY id DESC`).all(...params);
    res.json({
      sdu: { lat: SDU.lat, lon: SDU.lon },
      items: rows
        .map((row) => present(row, req.user?.id))
        .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)),
    });
  });

  app.get('/api/listings/mine', requireUser, (req, res) => {
    const rows = db.prepare('SELECT * FROM listings WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
    res.json({ items: rows.map((row) => present(row, req.user.id, true)) });
  });

  app.get('/api/listings/:id', (req, res) => {
    const row = findVisible(req.params.id, req.user);
    res.json({ sdu: { lat: SDU.lat, lon: SDU.lon }, item: present(row, req.user?.id, row.user_id === req.user?.id) });
  });

  app.post('/api/listings', requireUser, upload.array('photos', 10), async (req, res) => {
    const listing = validateListing(req.body);
    const point = await locate(listing.address);
    const id = transaction(db, () => {
      const inserted = db
        .prepare(
          `INSERT INTO listings (user_id, source_type, title, deal, price, rooms, area, floor, floors, year, district, address, description, phone, lat, lon, moderation_lang)
           VALUES (?, 'app', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(req.user.id, listing.title, listing.deal, listing.price, listing.rooms, listing.area, listing.floor, listing.floors, listing.year, listing.district, listing.address, listing.description, listing.phone, point.lat, point.lon, langOf(req));
      const newId = Number(inserted.lastInsertRowid);
      savePhotos(newId, req.files ?? []);
      return newId;
    });
    onContentChanged();
    res.status(201).json({ item: present(db.prepare('SELECT * FROM listings WHERE id = ?').get(id), req.user.id, true) });
  });

  app.put('/api/listings/:id', requireUser, upload.array('photos', 10), async (req, res) => {
    const row = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
    if (!row) throw new HttpError(404, 'not_found');
    if (row.user_id !== req.user.id) throw new HttpError(403, 'forbidden');
    const listing = validateListing(req.body);
    const point = listing.address === row.address && row.lat !== null ? { lat: row.lat, lon: row.lon } : await locate(listing.address);
    transaction(db, () => {
      db.prepare(
        `UPDATE listings SET title = ?, deal = ?, price = ?, rooms = ?, area = ?, floor = ?, floors = ?, year = ?, district = ?, address = ?, description = ?, phone = ?, lat = ?, lon = ?,
           status = 'pending', moderation_reason = NULL, moderation_lang = ?, updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ?`,
      ).run(listing.title, listing.deal, listing.price, listing.rooms, listing.area, listing.floor, listing.floors, listing.year, listing.district, listing.address, listing.description, listing.phone, point.lat, point.lon, langOf(req), row.id);
      if (req.files?.length) savePhotos(row.id, req.files);
    });
    onContentChanged();
    res.json({ item: present(db.prepare('SELECT * FROM listings WHERE id = ?').get(row.id), req.user.id, true) });
  });

  app.delete('/api/listings/:id', requireUser, (req, res) => {
    const row = db.prepare('SELECT id, user_id FROM listings WHERE id = ?').get(req.params.id);
    if (!row) throw new HttpError(404, 'not_found');
    if (row.user_id !== req.user.id) throw new HttpError(403, 'forbidden');
    const files = db.prepare('SELECT filename FROM photos WHERE listing_id = ?').all(row.id);
    // Foreign keys remove its photos, reviews, favorites, requests and chats.
    db.prepare('DELETE FROM listings WHERE id = ?').run(row.id);
    for (const { filename } of files) fs.rmSync(path.join(uploadsDir, filename), { force: true });
    res.status(204).end();
  });

  // Favorites
  app.get('/api/favorites', requireUser, (req, res) => {
    const rows = db
      .prepare(
        `SELECT listings.* FROM favorites JOIN listings ON listings.id = favorites.listing_id
         WHERE favorites.user_id = ? AND listings.status = 'approved' ORDER BY favorites.created_at DESC`,
      )
      .all(req.user.id);
    res.json({ items: rows.map((row) => present(row, req.user.id)) });
  });

  app.put('/api/favorites/:id', requireUser, (req, res) => {
    const row = findVisible(req.params.id, req.user);
    db.prepare('INSERT OR IGNORE INTO favorites (user_id, listing_id) VALUES (?, ?)').run(req.user.id, row.id);
    res.status(204).end();
  });

  app.delete('/api/favorites/:id', requireUser, (req, res) => {
    db.prepare('DELETE FROM favorites WHERE user_id = ? AND listing_id = ?').run(req.user.id, req.params.id);
    res.status(204).end();
  });

  // Reviews
  app.get('/api/listings/:id/reviews', async (req, res) => {
    const listing = findVisible(req.params.id, req.user);
    const rows = db
      .prepare(
        `SELECT reviews.*, users.name AS author FROM reviews JOIN users ON users.id = reviews.user_id
         WHERE listing_id = ? AND (status = 'approved' OR user_id = ?) ORDER BY reviews.id DESC`,
      )
      .all(listing.id, req.user?.id ?? -1);
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

  app.post('/api/listings/:id/reviews', requireUser, (req, res) => {
    const listing = findVisible(req.params.id, req.user);
    if (listing.user_id === req.user.id) throw new HttpError(403, 'own_listing_review');
    if (listing.status !== 'approved') throw new HttpError(404, 'not_found');
    const text = String(req.body?.text ?? '').trim();
    if (text.length < 5 || text.length > 2000) throw Object.assign(new HttpError(422, 'invalid_field'), { field: 'text' });
    const lang = langOf(req);
    // Only a rejected review may be rewritten, so nobody gets a second published one.
    const result = db
      .prepare(
        `INSERT INTO reviews (listing_id, user_id, text, moderation_lang) VALUES (?, ?, ?, ?)
         ON CONFLICT (listing_id, user_id) DO UPDATE
           SET text = excluded.text, moderation_lang = excluded.moderation_lang, status = 'pending', moderation_reason = NULL
           WHERE reviews.status = 'rejected'`,
      )
      .run(listing.id, req.user.id, text, lang);
    if (result.changes === 0) throw new HttpError(409, 'review_exists');
    onContentChanged();
    res.status(201).json({ status: 'pending' });
  });

  // Rent and purchase requests
  const openConversation = (listingId, renterId) => {
    db.prepare('INSERT OR IGNORE INTO conversations (listing_id, renter_id) VALUES (?, ?)').run(listingId, renterId);
    return db.prepare('SELECT id FROM conversations WHERE listing_id = ? AND renter_id = ?').get(listingId, renterId).id;
  };

  app.post('/api/listings/:id/requests', requireUser, (req, res) => {
    const listing = findVisible(req.params.id, req.user);
    if (listing.user_id === req.user.id) throw new HttpError(403, 'own_listing_deal');
    if (!listing.user_id) throw new HttpError(422, 'deal_unavailable');
    if (listing.status !== 'approved') throw new HttpError(404, 'not_found');
    if (listing.deal_status !== 'available') throw new HttpError(409, 'listing_closed');

    const message = String(req.body?.message ?? '').trim();
    if (message.length > 1000) throw Object.assign(new HttpError(422, 'invalid_field'), { field: 'message' });
    const date = req.body?.date ? String(req.body.date) : null;
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || date < yesterday)) {
      throw Object.assign(new HttpError(422, 'invalid_field'), { field: 'date' });
    }

    const id = transaction(db, () => {
      let inserted;
      try {
        inserted = db
          .prepare('INSERT INTO deal_requests (listing_id, requester_id, preferred_date, message) VALUES (?, ?, ?, ?)')
          .run(listing.id, req.user.id, date, message || null);
      } catch (error) {
        if (String(error.message).includes('UNIQUE')) throw new HttpError(409, 'request_exists');
        throw error;
      }
      if (message) {
        const conversationId = openConversation(listing.id, req.user.id);
        db.prepare('INSERT INTO messages (conversation_id, sender_id, text) VALUES (?, ?, ?)').run(conversationId, req.user.id, message);
      }
      return Number(inserted.lastInsertRowid);
    });
    res.status(201).json({ id, status: 'pending' });
  });

  app.get('/api/requests', requireUser, (req, res) => {
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
    const incoming = db
      .prepare(
        `SELECT ${columns}, users.name AS person_name, users.phone AS person_phone FROM deal_requests
         JOIN listings ON listings.id = deal_requests.listing_id
         JOIN users ON users.id = deal_requests.requester_id
         WHERE listings.user_id = ? ORDER BY deal_requests.status = 'pending' DESC, deal_requests.id DESC`,
      )
      .all(req.user.id);
    const outgoing = db
      .prepare(
        `SELECT ${columns}, users.name AS person_name, users.phone AS person_phone FROM deal_requests
         JOIN listings ON listings.id = deal_requests.listing_id
         JOIN users ON users.id = listings.user_id
         WHERE deal_requests.requester_id = ? ORDER BY deal_requests.id DESC`,
      )
      .all(req.user.id);
    res.json({ incoming: incoming.map(toJson), outgoing: outgoing.map(toJson) });
  });

  const requestFor = (id) => {
    const row = db
      .prepare(
        `SELECT deal_requests.*, listings.user_id AS owner_id FROM deal_requests
         JOIN listings ON listings.id = deal_requests.listing_id WHERE deal_requests.id = ?`,
      )
      .get(id);
    if (!row) throw new HttpError(404, 'not_found');
    return row;
  };
  const ownerRequest = (req) => {
    const row = requestFor(req.params.id);
    if (row.owner_id !== req.user.id) throw new HttpError(404, 'not_found');
    if (row.status !== 'pending') throw new HttpError(409, 'request_not_pending');
    return row;
  };

  app.post('/api/requests/:id/accept', requireUser, (req, res) => {
    const row = ownerRequest(req);
    transaction(db, () => {
      db.prepare(`UPDATE deal_requests SET status = 'accepted' WHERE id = ?`).run(row.id);
      db.prepare(`UPDATE deal_requests SET status = 'declined' WHERE listing_id = ? AND status = 'pending'`).run(row.listing_id);
      db.prepare(`UPDATE listings SET deal_status = 'closed' WHERE id = ?`).run(row.listing_id);
    });
    res.json({ status: 'accepted' });
  });

  app.post('/api/requests/:id/decline', requireUser, (req, res) => {
    const row = ownerRequest(req);
    db.prepare(`UPDATE deal_requests SET status = 'declined' WHERE id = ?`).run(row.id);
    res.json({ status: 'declined' });
  });

  app.post('/api/requests/:id/cancel', requireUser, (req, res) => {
    const row = requestFor(req.params.id);
    if (row.requester_id !== req.user.id) throw new HttpError(404, 'not_found');
    if (row.status !== 'pending') throw new HttpError(409, 'request_not_pending');
    db.prepare(`UPDATE deal_requests SET status = 'cancelled' WHERE id = ?`).run(row.id);
    res.json({ status: 'cancelled' });
  });

  app.post('/api/listings/:id/reopen', requireUser, (req, res) => {
    const row = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
    if (!row) throw new HttpError(404, 'not_found');
    if (row.user_id !== req.user.id) throw new HttpError(403, 'forbidden');
    transaction(db, () => {
      db.prepare(`UPDATE listings SET deal_status = 'available' WHERE id = ?`).run(row.id);
      db.prepare(`UPDATE deal_requests SET status = 'cancelled' WHERE listing_id = ? AND status = 'accepted'`).run(row.id);
    });
    res.json({ dealStatus: 'available' });
  });

  // Chat
  const conversationFor = (id, userId) => {
    const row = db
      .prepare(
        `SELECT conversations.*, listings.title, listings.user_id AS owner_id FROM conversations
         JOIN listings ON listings.id = conversations.listing_id WHERE conversations.id = ?`,
      )
      .get(id);
    if (!row || (row.renter_id !== userId && row.owner_id !== userId)) throw new HttpError(404, 'not_found');
    return row;
  };

  app.post('/api/listings/:id/conversation', requireUser, (req, res) => {
    const listing = findVisible(req.params.id, req.user);
    if (!listing.user_id) throw new HttpError(422, 'chat_unavailable');
    if (listing.user_id === req.user.id) throw new HttpError(403, 'own_listing_chat');
    res.status(201).json({ id: openConversation(listing.id, req.user.id) });
  });

  app.get('/api/conversations', requireUser, (req, res) => {
    const rows = db
      .prepare(
        `SELECT conversations.id, listings.id AS listing_id, listings.title,
           CASE WHEN conversations.renter_id = ? THEN owner.name ELSE renter.name END AS other_name,
           (SELECT text FROM messages WHERE conversation_id = conversations.id ORDER BY id DESC LIMIT 1) AS last_message
         FROM conversations
         JOIN listings ON listings.id = conversations.listing_id
         JOIN users renter ON renter.id = conversations.renter_id
         JOIN users owner ON owner.id = listings.user_id
         WHERE conversations.renter_id = ? OR listings.user_id = ?
         ORDER BY conversations.id DESC`,
      )
      .all(req.user.id, req.user.id, req.user.id);
    res.json({
      items: rows.map((row) => ({ id: row.id, listingId: row.listing_id, title: row.title, otherName: row.other_name, lastMessage: row.last_message })),
    });
  });

  app.get('/api/conversations/:id/messages', requireUser, (req, res) => {
    const conversation = conversationFor(req.params.id, req.user.id);
    const rows = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id').all(conversation.id);
    res.json({
      title: conversation.title,
      listingId: conversation.listing_id,
      items: rows.map((row) => ({ id: row.id, text: row.text, createdAt: row.created_at, isMine: row.sender_id === req.user.id })),
    });
  });

  app.post('/api/conversations/:id/messages', requireUser, (req, res) => {
    const conversation = conversationFor(req.params.id, req.user.id);
    const text = String(req.body?.text ?? '').trim();
    if (text.length < 1 || text.length > 2000) throw Object.assign(new HttpError(422, 'invalid_field'), { field: 'text' });
    const { lastInsertRowid } = db.prepare('INSERT INTO messages (conversation_id, sender_id, text) VALUES (?, ?, ?)').run(conversation.id, req.user.id, text);
    res.status(201).json({ id: Number(lastInsertRowid), text, isMine: true });
  });

  // Map image. The browser asks this server, so it never sees the 2GIS key.
  const mapCache = new Map();
  app.get('/api/map/image', mapLimiter, async (req, res) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const zoom = toInt(req.query.z, MAP_LIMITS.minZoom, MAP_LIMITS.maxZoom);
    const width = toInt(req.query.w, 100, MAP_LIMITS.maxWidth);
    const height = toInt(req.query.h, 100, MAP_LIMITS.maxHeight);
    const nearSdu = Math.abs(lat - SDU.lat) <= MAP_LIMITS.maxDegreesFromSdu && Math.abs(lon - SDU.lon) <= MAP_LIMITS.maxDegreesFromSdu;
    if (!nearSdu || !zoom || !width || !height) throw new HttpError(400, 'invalid_map_request');
    const cacheKey = [lat.toFixed(5), lon.toFixed(5), zoom, width, height].join('|');
    let image = mapCache.get(cacheKey);
    if (!image) {
      image = await dgis.staticMap({ lat: lat.toFixed(5), lon: lon.toFixed(5), zoom, width, height });
      if (mapCache.size >= 200) mapCache.delete(mapCache.keys().next().value);
      mapCache.set(cacheKey, image);
    }
    res.set('Cache-Control', 'public, max-age=86400').type(image.type).send(image.body);
  });

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
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.code, field: error.field });
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
