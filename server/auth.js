import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const COOKIE = 'sid';

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

const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    tokenHash(token),
    userId,
    Date.now() + SESSION_MS,
  );
  return { token, maxAge: SESSION_MS };
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}

export function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

export function loadUser(db) {
  return (req, _res, next) => {
    req.user = null;
    const token = readCookie(req, COOKIE);
    if (token) {
      req.user =
        db
          .prepare(
            `SELECT users.id, users.name, users.phone, users.email FROM sessions
             JOIN users ON users.id = sessions.user_id
             WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
          )
          .get(tokenHash(token), Date.now()) ?? null;
    }
    next();
  };
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'auth_required' });
  next();
}
