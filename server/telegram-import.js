import { Api } from 'telegram';
import { config } from './config.js';
import { openDb } from './db.js';
import { createDgis } from './services/dgis.js';
import { addListingPhotos, saveImports } from './services/importer.js';
import { adFingerprint, cleanPost, createGeminiExtractor, groupAlbums, textFingerprint, MAX_NEW_ADS_PER_RUN, MAX_PHOTOS_PER_AD, MAX_POSTS_PER_CHANNEL, postsToListings, SEARCH_TERMS } from './services/telegram.js';
import { createClient, readSession } from './telegram-client.js';

const MAX_CHANNELS = 5;

if (!readSession()) {
  console.error('Not logged in. Run: npm run telegram:login');
  process.exit(1);
}
if (!config.geminiKey) {
  console.error('Set GEMINI_API_KEY in .env first.');
  process.exit(1);
}

const client = createClient();
await client.connect();
if (!(await client.checkAuthorization())) {
  console.error('The Telegram login has expired. Run: npm run telegram:login');
  process.exit(1);
}

async function findChannels() {
  if (config.telegram.channels.length) return config.telegram.channels;
  const found = new Map();
  for (const q of SEARCH_TERMS) {
    const { chats } = await client.invoke(new Api.contacts.Search({ q, limit: 10 }));
    for (const chat of chats) {
      if (chat.username && (chat.broadcast || chat.megagroup)) found.set(chat.username, chat.title);
    }
  }
  for (const [username, title] of found) console.log(`found  @${username}  ${title}`);
  return [...found.keys()].slice(0, MAX_CHANNELS);
}

const db = openDb(config.dbPath);
const dgis = createDgis({ key: config.dgisKey, db });
const { uploadsDir } = config;

async function downloadPhotos(photos, skip = 0) {
  const buffers = [];
  for (const message of photos.slice(skip, MAX_PHOTOS_PER_AD)) {
    try {
      const buffer = await client.downloadMedia(message, {});
      if (Buffer.isBuffer(buffer)) buffers.push(buffer);
    } catch (error) {
      console.warn(`Could not download a photo: ${error.message}`);
    }
  }
  return buffers;
}

const posts = [];
for (const username of await findChannels()) {
  try {
    const messages = await client.getMessages(username, { limit: MAX_POSTS_PER_CHANNEL });
    const grouped = groupAlbums(messages);
    console.log(`read   @${username}  ${grouped.length} posts`);
    for (const post of grouped) posts.push({ ...post, username });
  } catch (error) {
    console.warn(`Could not read @${username}: ${error.message}`);
  }
}
posts.sort((a, b) => b.date - a.date);

// Ads already on the site skip the AI.
const findExisting = db.prepare(`SELECT id FROM listings WHERE source_type = 'import' AND source_url = ?`);
const fresh = posts.filter((post) => !findExisting.get(`https://t.me/${post.username}/${post.messageId}`));

// Every Telegram ad on the site gets the photos it is missing, even when its
// post is older than the messages read above. An album sits next to its text.
const countPhotos = db.prepare('SELECT COUNT(*) AS n FROM photos WHERE listing_id = ?');
const telegramAds = db.prepare(`SELECT id, source_url FROM listings WHERE source_type = 'import' AND source_name LIKE 't.me/%'`).all();
for (const ad of telegramAds) {
  const match = ad.source_url.match(/^https:\/\/t\.me\/([\w]+)\/(\d+)$/);
  if (!match) continue;
  const [, username, id] = match;
  try {
    const ids = Array.from({ length: 21 }, (_, offset) => Number(id) - 10 + offset);
    const nearby = (await client.getMessages(username, { ids })).filter(Boolean);
    const post = groupAlbums(nearby).find((item) => item.messageId === Number(id));
    const have = countPhotos.get(ad.id).n;
    if (post && have < Math.min(post.photos.length, MAX_PHOTOS_PER_AD)) {
      const kept = addListingPhotos({ db, listingId: ad.id, buffers: await downloadPhotos(post.photos, have), uploadsDir });
      console.log(`photos ${ad.source_url}  +${kept}`);
    }
  } catch (error) {
    console.warn(`Could not check photos for ${ad.source_url}: ${error.message}`);
  }
}

// Reposts are common in these groups, so ads on the site count as already seen.
const onSite = db.prepare(`SELECT rooms, price, address, description FROM listings WHERE source_type = 'import'`).all();
const seenTexts = new Set(onSite.map((row) => textFingerprint(cleanPost(row.description))));
const seenAds = new Set(onSite.map(adFingerprint));

const { prepared, calls } = await postsToListings({
  posts: fresh,
  seenTexts,
  seenAds,
  slots: MAX_NEW_ADS_PER_RUN,
  geocode: dgis.geocode,
  extract: createGeminiExtractor({ apiKey: config.geminiKey, model: config.moderationModel }),
});
// Photos are ready before the ad is saved, so moderation always sees them.
for (const item of prepared) item.buffers = await downloadPhotos(item.post.photos);
const saved = saveImports({ db, prepared, slots: Infinity, uploadsDir });
let photoCount = 0;
for (const item of saved) {
  const kept = addListingPhotos({ db, listingId: item.listingId, buffers: item.buffers, uploadsDir });
  photoCount += kept;
  console.log(`added  ${item.sourceUrl}  ${item.title}  ${item.price} KZT  photos: ${kept}`);
}
console.log(`Posts: ${posts.length}. New: ${fresh.length}. Checked by AI: ${calls}. Imported: ${saved.length}. Photos: ${photoCount}.`);
await client.disconnect();
process.exit(0);
