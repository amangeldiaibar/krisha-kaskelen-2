import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sniffImage } from '../images.js';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** Saves valid images for a listing and returns how many were kept. */
export async function addListingPhotos({ db, listingId, buffers, uploadsDir }) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  let position = (await db.get('SELECT COUNT(*) AS n FROM photos WHERE listing_id = $1', [listingId])).n;
  let kept = 0;
  for (const buffer of buffers) {
    const type = sniffImage(buffer);
    if (!type || buffer.length > MAX_PHOTO_BYTES) continue;
    const filename = `${crypto.randomUUID()}.${type.ext}`;
    fs.writeFileSync(path.join(uploadsDir, filename), buffer);
    await db.run('INSERT INTO photos (listing_id, filename, mime, position) VALUES ($1, $2, $3, $4)', [listingId, filename, type.mime, position]);
    position += 1;
    kept += 1;
  }
  return kept;
}

/** Saves imported ads for moderation. A repost of an ad already saved replaces it. */
export async function saveImports({ db, prepared, uploadsDir }) {
  if (prepared.length === 0) return [];
  const files = [];
  const saved = await db.transaction(async (tx) => {
    for (const item of prepared) {
      const existing = await tx.get(`SELECT id FROM listings WHERE source_type = 'import' AND source_url = $1`, [item.sourceUrl]);
      if (!existing) continue;
      files.push(...(await tx.all('SELECT filename FROM photos WHERE listing_id = $1', [existing.id])).map((photo) => photo.filename));
      await tx.run('DELETE FROM listings WHERE id = $1', [existing.id]);
    }
    const result = [];
    for (const item of prepared) {
      const { id } = await tx.get(
        `INSERT INTO listings (source_type, source_name, source_url, title, deal, price, rooms, area, address, description, lat, lon, status)
         VALUES ('import', $1, $2, $3, 'rent', $4, $5, $6, $7, $8, $9, $10, 'pending') RETURNING id`,
        [item.sourceName, item.sourceUrl, item.title, item.price, item.rooms, item.area, item.address, item.description, item.lat, item.lon],
      );
      result.push({ ...item, listingId: id });
    }
    return result;
  });
  // Files go only after the commit, so a failed save leaves the old photos in place.
  if (uploadsDir) for (const filename of files) fs.rmSync(path.join(uploadsDir, filename), { force: true });
  return saved;
}
