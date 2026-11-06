# Krisha Kaskelen

A student housing site for Kaskelen, Kazakhstan, built as a CSS 225 Web Development project.
People can find apartments near SDU University, see them on a map, read reviews, and send rental or purchase requests.

The frontend uses React and React Router. The backend uses Express and SQLite. The interface is available in English, Russian and Kazakh.

## Getting started

You need Node.js 22.13 or newer.

```bash
npm install
npm start
```

Then open http://localhost:3000. This one command builds the frontend and starts the server, which serves both the site and the API.

Do not open the HTML files directly or through Live Server, because the forms and data need the server.

For development with automatic reloading, run `npm run dev` and open http://localhost:5173.

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
- **Favorites and chat:** users can save ads and message owners.
- **Moderation:** an AI model approves or rejects each ad and review, and gives a reason.

## Configuration

Copy `.env.example` to `.env`. The `.env` file must stay out of Git.

| Variable | Used for | Without it |
|---|---|---|
| `DGIS_API_KEY` | Map, address lookup and 2GIS data | The map and address lookup do not work |
| `GEMINI_API_KEY` | AI moderation through Google Gemini, which has a free tier. It takes priority over Claude | Falls back to `ANTHROPIC_API_KEY` |
| `ANTHROPIC_API_KEY` | AI moderation through Claude, which is paid | With neither key, local runs publish content unchecked and label it under "My ads". Production keeps it pending |
| `SERPAPI_KEY` | Importing public Google results with `npm run import` | The import command does not run |
| `MODERATION_MODEL` | Choosing the moderation model | Uses `gemini-flash-lite-latest` or `claude-opus-5-5` |
| `PORT` | Server port | Uses 3000 |

## Sample data

The first start creates `data/app.db` with five ads. Three are test ads, one of them for sale. Two are public ads found on domler.kz, which `npm run import` can replace.
These ads skip AI moderation because they are fixed sample data.

Two demo accounts exist outside production. Both use the password `demo-password`.

- `owner@example.com` owns the test ads.
- `tenant@example.com` wrote the sample review.

To start over, stop the server and delete the `data` folder.

## Try the rental flow

1. Sign up and press "Rent this" or "Buy this" on an ad.
2. Send the request with a date and a message.
3. In another browser, log in as `owner@example.com` and open "Requests".
4. Accept the request. The ad leaves the search and is marked as rented or sold.
5. Press "Return to search" on the ad page to open it again.

A request does not take payment or create a contract. It passes contact details to the owner and records the decision.

## Telegram import

This reads public channels with your Telegram account. It only searches and reads, and never sends anything.

1. Put `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` and `TELEGRAM_PHONE` from https://my.telegram.org in `.env`. It also needs `GEMINI_API_KEY`.
2. Run `npm run telegram:qr` once and scan the code in the Telegram app under Settings, Devices. Or run `npm run telegram:login` and enter the code Telegram sends you, usually inside the app and not by SMS.
3. Run `npm run import:telegram`.

It finds channels by keywords, or reads the ones listed in `TELEGRAM_CHANNELS`. Gemini extracts the rooms, price and address. Phone numbers, usernames and links are removed before anything is sent to Gemini or saved. Each ad links to its original post, keeps up to ten of its photos, and still goes through moderation. Photos are not edited, so a phone number written on a picture stays visible unless moderation rejects the ad. One run adds up to 12 ads, and ads already on the site are not checked again.

The login is stored in `data/telegram.session`. That file gives full access to the Telegram account, so never share or commit it. To revoke it, end the session in Telegram under Settings, Devices.

## How it works

- **2GIS key:** it stays on the server. The browser gets the map picture from `/api/map/image` and draws the pins itself.
- **Phone numbers:** the site and the server accept only 11-digit Kazakhstan numbers.
- **Moderation:** it runs in the background every 30 seconds and right after a submission. With a key set, an item with no decision stays hidden. Phone numbers are never sent to the AI provider.
- **Import:** it keeps only the title and short text from Google results and removes phone numbers. krisha.kz pages are never requested, because the site blocks automated access, so its ads come only from Google's text and their map position is approximate. The krisha.kz agreement forbids copying without written permission, so remove these ads before any public launch.
- **Old pages:** the original static site is in `legacy-static/`.

## Known limitations

- **2GIS reviews:** the demo key gets no access to review texts, so only the building rating and review count appear.
- **2GIS demo key:** it lasts one month and allows 1000 requests per service.
- **Gemini free tier:** Google may use free-tier prompts to improve its products, and the daily limit can change. When it runs out, new items wait and are retried automatically.
- **Google import:** it adds an ad only when Google's text shows a price and a usable Kaskelen address, so a run may add nothing.

## Photo credits

The hero image and the photos on the test ads come from [Unsplash](https://unsplash.com/license) and are free to use. They are not pictures of the listed apartments, so the test ads label them as example photos. Ads imported from other sites never use them.
