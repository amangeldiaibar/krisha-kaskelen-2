# Krisha Kaskelen

A student housing site for Kaskelen, Kazakhstan, built as a CSS 225 Web Development project.
People can find apartments near SDU University, see them on a map, read reviews, and send rental or purchase requests.

The frontend uses React and React Router. The backend uses Express and PostgreSQL. The interface is available in English, Russian and Kazakh.

## Getting started

You need Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Then open http://localhost:5173. This starts the database, the server and the frontend together, and reloads them when the code changes. The very first start creates the database files in `data/postgres`, which takes up to a minute.

To run the built site instead, use `npm start` and open http://localhost:3000. It also starts the database.

Do not open the HTML files directly or through Live Server, because the forms and data need the server.

To check the code:

```bash
npm test
npm run lint
```

## Features

- **Search:** filter ads by deal type, rooms, price, year built and district.
- **Map:** every ad with a known address has a pin on one 2GIS map, along with its straight-line distance to SDU.
- **Rent and buy requests:** a user sends a request with a date and a message, and the owner accepts or declines it.
- **Ad management:** owners can post, edit and delete their own ads. Deleting also removes the ad's photos, reviews, requests and chats.
- **Reviews:** users can leave one review per ad, and never on their own ad.
- **Profile:** the photo and name at the top right open a menu with settings, favorites, own ads, requests and messages. In settings a user can change the name, phone, profile photo and password.
- **Favorites and chat:** users can save ads and message owners. Messages arrive live, without a page refresh.
- **Moderation:** an AI model approves or rejects each ad and review, and gives a reason. An admin can overrule it.
- **Search by phrase:** type what you want, such as "однушка до 120к рядом с SDU с мебелью", in Russian, Kazakh or English. Gemini turns it into filters, and plain rules do it when there is no key or Gemini fails. The filters appear as chips that can be removed one by one. Search also filters by distance to SDU and by amenities mentioned in the ad text (furniture, pets, internet and more), and sorts by distance (the default), price or date.
- **Comparison:** the ⇄ button on an ad adds it to a comparison of up to four ads. The table marks the best price, price per m², area, distance and year, and shows which amenities each ad mentions. The list stays in the browser, and the page has a link to share it.
- **Reports:** a logged-in user can report an ad as fraud, wrong details, already taken, a copy or offensive.
- **Forgot password:** "Forgot your password?" on the login page mails a one-time link to the account's email (it works 30 minutes, at most 3 letters an hour). Setting a new password logs the account out everywhere else. Set `SMTP_URL`, `MAIL_FROM` and `PUBLIC_URL` in `.env` to send real letters; without `SMTP_URL` the link is printed in the server terminal.
- **Support:** the header links to Favorites and Support. On the support page a logged-in person picks a topic and writes to the admins; their messages and the admins' answers stay listed there. Admins answer or close messages in the Support tab of the admin panel.
- **Near SDU first:** search lists the nearest flats first, and each card says how far it is, such as "3.8 km to SDU". The site serves Kaskelen and the villages around it, within 12 km of SDU. Moderation refuses ads farther away, or without a photo or an address found on the map, before the AI sees them and tells the author why; the Telegram import does not save them. The limit is `MAX_AD_DISTANCE_KM` in `server/config.js`.
- **Fresh ads only:** every card says when the ad was last updated ("Updated 2 days ago"): the date on the krisha.kz card, the date of the Telegram post, or the owner's last edit here. Ads from krisha.kz and Telegram not updated for 30 days leave search, since the flat is likely taken. The limit is `STALE_AFTER_DAYS` in `server/config.js`.
- **Flatmates:** on any rental that is still free, a person presses "I'm looking for flatmates" and adds a short note about themselves. Others see the list, and "Write" opens a chat between the two of them, even for ads from krisha.kz or Telegram that have no owner on the site. Cards show how many people look for flatmates there.
- **Duplicates:** the same flat posted on krisha.kz and in Telegram is found by deal, rooms, price, area, floor, address, phone and wording. An admin keeps one ad and the copy leaves search; the main ad then links to where else it is published. An owner who posts the same flat twice is refused and sent to the existing ad.
- **Admin panel** (`/ru/admin`): counts of what needs attention, ads with filters by status and source, AI decisions with an override, likely duplicates side by side, reports, reviews, users with blocking, and a log of every admin action. A blocked user is logged out everywhere, cannot log in, and their ads leave search.

## Database

All site data lives in PostgreSQL: accounts with their name, phone, email, password hash and profile photo, login sessions, ads and their photos, reviews, favorites, chats and messages, rent and buy requests, and cached 2GIS answers. Photo files themselves stay in `data/uploads`, and the database keeps their names.

`npm run dev` and `npm start` run a real PostgreSQL 18 server from the `embedded-postgres` package, so nothing has to be installed. `npm run db` starts only the database, for example to run an import while the site is off. It keeps its files in `data/postgres`, which stays out of Git, and accepts connections only from this computer. To look at the data in a client such as TablePlus, DBeaver or pgAdmin while it runs, connect to:

```
postgres://krisha:krisha@localhost:54329/krisha
```

To use another PostgreSQL server, for example a hosted one, set `DATABASE_URL` in `.env`. The site creates its tables on start. In production `DATABASE_URL` is required.

The site used SQLite before. To move accounts, ads and everything else from `data/app.db` into an empty PostgreSQL database, start the database and run:

```bash
npm run db:import-sqlite
```

It keeps ids and dates, and leaves the SQLite file as it was.

Tests start their own PostgreSQL server on port 54330 with its files in `node_modules/.cache`, so they never touch the site's data. To run them against another server, set `TEST_DATABASE_URL`. Its tables are wiped on every run.

## Configuration

Copy `.env.example` to `.env`. The `.env` file must stay out of Git.

| Variable | Used for | Without it |
|---|---|---|
| `DATABASE_URL` | The PostgreSQL server to use | Uses the local one from `npm run db`. Production does not start |
| `DGIS_API_KEY` | Map, address lookup and 2GIS data | The map does not work. Addresses are looked up in OpenStreetMap |
| `GEMINI_API_KEY` | AI moderation through Google Gemini, which has a free tier | Without it, local runs publish content unchecked and label it under "My ads". Production keeps it pending |
| `MODERATION_MODEL` | Choosing the moderation model | Uses `gemini-flash-lite-latest` |
| `PORT` | Server port | Uses 3000 |

## Admins

Register on the site, then give that account admin rights:

```bash
npm run admin -- you@example.com
```

A phone number works too. Add `--remove` to take the rights away. The admin panel then appears in the profile menu. The database must be running.

After that, admins make others admins on the site, as in a Telegram channel: **Users** in the admin panel → **Make admin**, then tick the sections the new admin gets:

- **Ads and the site:** moderation, deleting ads, duplicates and reports;
- **Reviews;**
- **Support messages;**
- **Users:** blocking.

An admin with every section ticked can also make admins and read the log. **Change access** edits an admin's sections, and **Remove from admins** takes the rights away. Nobody can change their own rights. The server enforces the sections, so a limited admin gets "forbidden" from any other part of the panel. Admins made with `npm run admin` get every section.

## Ads from krisha.kz

The krisha.kz parser lives in [KrishaParser/](KrishaParser/), taken from [house-pricer](https://github.com/Damenzzzz/house-pricer/tree/main/KrishaParser). Its own README explains setup. Collect ads and load the newest export into the site:

```bash
cd KrishaParser
python -m krisha crawl --city kaskelen --max-pages 5
python -m krisha photos --expand
python -m krisha export
cd .. && npm run import:krisha-parser
```

When krisha.kz blocks the parser (status 468), save the search pages from your browser instead (for sales: https://krisha.kz/prodazha/kvartiry/kaskelen/, then `?page=2` and so on) into one folder and read them without any requests to krisha.kz:

```bash
python -m krisha import-html data/saved --city kaskelen --deal sale
```

Then run `photos --expand`, `export` and `npm run import:krisha-parser` as above.

An older CSV file with a `photos` folder in the project folder loads the same way:

```bash
npm run import:krisha
```

The import replaces earlier krisha.kz ads and every test ad, and keeps Telegram ads and ads people posted on this site, so both sources show together. Phone numbers are removed from the text, up to ten photos are kept per ad, and each ad goes through AI moderation. Ads priced per month become rentals, and the rest become sales.

The CSV file and the photos stay out of Git. The krisha.kz agreement forbids copying its listings without written permission, so get that permission before any public launch.

## Ads from Telegram

`npm run import:telegram` reads the channels in `TELEGRAM_CHANNELS` (log in first with `npm run telegram:login`). Gemini reads each post, and only rentals in the served area are kept: Kaskelen within 12 km of SDU, and the villages between Kaskelen and Almaty, from Долан and Алмалыбак to Коксай and Almaty Arena. For channels about all of Almaty, list them in `TELEGRAM_AREA_CHANNELS` too: then only posts that name Kaskelen, SDU or one of those villages reach the AI.

```
TELEGRAM_CHANNELS=SDU_housing,kvartira_v_almaty
TELEGRAM_AREA_CHANNELS=kvartira_v_almaty
```

Each run adds at most 12 ads and asks the AI about at most 40 posts, so run it again for more.

## Try the rental flow

Rent and buy requests work for ads that people post on this site. Imported ads link to their source page instead, because their owners are not on this site.

1. Create two accounts. With the first, post an ad.
2. With the second, press "Rent this" or "Buy this" on that ad and send the request.
3. With the first account, open "Requests" and accept it. The ad leaves the search and is marked as rented or sold.
4. Press "Return to search" on the ad page to open it again.

A request does not take payment or create a contract. It passes contact details to the owner and records the decision.

## How it works

- **2GIS key:** it stays on the server. The browser gets the map picture from `/api/map/image` and draws the pins itself.
- **Phone numbers:** a phone field has a country picker with dialling codes. The site and the server accept full mobile numbers of the countries listed in `shared/phones.js` and store them in one format, such as `+7 700 000 00 00`. A number typed without a plus sign is read as a Kazakhstan one.
- **Moderation:** it runs in the background every 30 seconds and right after a submission. With a key set, an item with no decision stays hidden. Phone numbers are never sent to the AI provider.
- **krisha.kz import:** ads come from KrishaParser, which reads krisha.kz search pages only. Ad pages answer 403, so ads carry what the search card shows, and phone numbers are removed. krisha.kz may block the parser for a while after frequent runs (status 468), so run it about once a day. The krisha.kz agreement forbids copying without written permission, so get that permission before any public launch.
- **Old pages:** the original static site is in `legacy-static/`.

## Known limitations

- **2GIS reviews:** the demo key gets no access to review texts, so only the building rating and review count appear.
- **2GIS demo key:** it lasts one month and allows 1000 requests per service.
- **Address lookup without 2GIS:** when 2GIS refuses the key or does not know an address, the server asks OpenStreetMap (Nominatim), one request a second, and caches the answer for 30 days. Ads that name only a street get the street's point, so their distance to SDU is approximate. Address data © OpenStreetMap contributors.
- **Gemini free tier:** Google may use free-tier prompts to improve its products, and the daily limit can change. When it runs out, new items wait and are retried automatically.
- **Google import:** it adds an ad only when Google's text shows a price and a usable Kaskelen address, so a run may add nothing.

## Photo credits

The hero image comes from [Unsplash](https://unsplash.com/license) and is free to use.
