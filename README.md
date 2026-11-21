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
- **Search by phrase:** type what you want, such as "однушка до 120к рядом с SDU с мебелью", in Russian, Kazakh or English. Gemini turns it into filters, and plain rules do it when there is no key or Gemini fails. The filters appear as chips that can be removed one by one. Search also filters by distance to SDU and by amenities mentioned in the ad text (furniture, pets, internet and more), and sorts by distance, price or date.
- **Comparison:** the ⇄ button on an ad adds it to a comparison of up to four ads. The table marks the best price, price per m², area, distance and year, and shows which amenities each ad mentions. The list stays in the browser, and the page has a link to share it.
- **Reports:** a logged-in user can report an ad as fraud, wrong details, already taken, a copy or offensive.
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
| `DGIS_API_KEY` | Map, address lookup and 2GIS data | The map and address lookup do not work |
| `GEMINI_API_KEY` | AI moderation through Google Gemini, which has a free tier | Without it, local runs publish content unchecked and label it under "My ads". Production keeps it pending |
| `SERPAPI_KEY` | Importing public Google results with `npm run import` | The import command does not run |
| `MODERATION_MODEL` | Choosing the moderation model | Uses `gemini-flash-lite-latest` |
| `PORT` | Server port | Uses 3000 |

## Admins

Register on the site, then give that account admin rights:

```bash
npm run admin -- you@example.com
```

A phone number works too. Add `--remove` to take the rights away. The admin panel then appears in the profile menu. The database must be running.

## Ads from krisha.kz

The krisha.kz parser lives in [KrishaParser/](KrishaParser/), taken from [house-pricer](https://github.com/Damenzzzz/house-pricer/tree/main/KrishaParser). Its own README explains setup. Collect ads and load the newest export into the site:

```bash
cd KrishaParser
python -m krisha crawl --city kaskelen --max-pages 5
python -m krisha photos
python -m krisha export
cd .. && npm run import:krisha-parser
```

An older CSV file with a `photos` folder in the project folder loads the same way:

```bash
npm run import:krisha
```

The import replaces earlier krisha.kz ads and every test ad, and keeps Telegram ads and ads people posted on this site, so both sources show together. Phone numbers are removed from the text, up to ten photos are kept per ad, and each ad goes through AI moderation. Ads priced per month become rentals, and the rest become sales.

The CSV file and the photos stay out of Git. The krisha.kz agreement forbids copying its listings without written permission, so get that permission before any public launch.

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
- **Import:** it keeps only the title and short text from Google results and removes phone numbers. krisha.kz pages are never requested, because the site blocks automated access, so its ads come only from Google's text and their map position is approximate. The krisha.kz agreement forbids copying without written permission, so remove these ads before any public launch.
- **Old pages:** the original static site is in `legacy-static/`.

## Known limitations

- **2GIS reviews:** the demo key gets no access to review texts, so only the building rating and review count appear.
- **2GIS demo key:** it lasts one month and allows 1000 requests per service.
- **Gemini free tier:** Google may use free-tier prompts to improve its products, and the daily limit can change. When it runs out, new items wait and are retried automatically.
- **Google import:** it adds an ad only when Google's text shows a price and a usable Kaskelen address, so a run may add nothing.

## Photo credits

The hero image comes from [Unsplash](https://unsplash.com/license) and is free to use.
