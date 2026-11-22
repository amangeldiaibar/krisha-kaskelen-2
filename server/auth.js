import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const COOKIE = 'sid';
/** What the site may show about a user. The profile photo becomes a ready URL. */
export const USER_COLUMNS = `users.id, users.name, users.phone, users.email, users.role, users.admin_scopes AS "adminScopes",
  users.phone_verified_at IS NOT NULL AS "phoneVerified",
  CASE WHEN users.avatar IS NULL THEN NULL ELSE '/uploads/' || users.avatar END AS avatar`;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const actual = await scrypt(password, Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}

export const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

export async function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [tokenHash(token), userId, Date.now() + SESSION_MS]);
  return { token, maxAge: SESSION_MS };
}

export async function destroySession(db, token) {
  if (token) await db.run('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)]);
}

export function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

export function loadUser(db) {
  return async (req, _res, next) => {
    req.user = null;
    const token = readCookie(req, COOKIE);
    if (token) {
      req.user =
        (await db.get(
          `SELECT ${USER_COLUMNS} FROM sessions
           JOIN users ON users.id = sessions.user_id
           WHERE sessions.token_hash = $1 AND sessions.expires_at > $2 AND users.blocked_at IS NULL`,
          [tokenHash(token), Date.now()],
        )) ?? null;
    }
    next();
  };
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'auth_required' });
  next();
}

/** Admin panel sections that can be given to an admin one by one. */
export const ADMIN_SECTIONS = ['listings', 'reviews', 'support', 'users'];

/** Whether an admin may work in a section. A null section is only for admins with every section. */
export function canAdmin(user, section) {
  if (user?.role !== 'admin') return false;
  if (!user.adminScopes) return true;
  return section !== null && user.adminScopes.includes(section);
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'auth_required' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  next();
}
