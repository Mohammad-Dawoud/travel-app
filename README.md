# Travel Guide App

An academic travel planner with departure countdown, return date, duration, weather and destination imagery. The server binds to `127.0.0.1`. Mock mode is deterministic and credential-free. Live mode uses GeoNames and Weatherbit with Wikimedia Commons as the default image provider. Pixabay is optional.

## Run mock mode

Use Node.js 24.22.3 and npm 11.19.1. Run from this checkout in PowerShell.

```powershell
$travelNode = (Resolve-Path -LiteralPath '../../P3-T01-A/ND0067-P01-Image-Processing-API/.local/node-v24.22.3-win-x64').Path
$env:Path = "$travelNode;$env:Path"
$env:TRAVEL_PORT = '4175'
$env:TRAVEL_PROVIDER_MODE = 'mock'
npm ci --ignore-scripts --include=optional --no-audit --no-fund
npm run demo
```

Open [the local app](http://127.0.0.1:4175). Try Paris, Tokyo or Cairo. Dates use UTC calendar days. Press Ctrl+C in the server terminal to stop.

## Configure live mode

1. Create a [GeoNames account](https://www.geonames.org/create-account) and enable free web services under its account settings. Use the account username.
2. Create a [Weatherbit account](https://www.weatherbit.io/account/create), obtain an API key and confirm the account's enabled endpoints and usage rights.
3. Wikimedia Commons needs no API credential. For optional Pixabay access, use an approved [Pixabay account](https://pixabay.com/accounts/register/) and obtain the key from the [API documentation](https://pixabay.com/api/docs/).

Use fresh owner-managed credentials. Revoke or rotate any historically exposed credentials from the provider account. Keep the populated file local. The tracked template contains empty values.

```powershell
New-Item -ItemType Directory -Path '.local' -Force | Out-Null
if (!(Test-Path -LiteralPath '.local/live.env')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.local/live.env'
}
notepad '.local/live.env'
```

Fill in `GEONAMES_USERNAME` and `WEATHERBIT_API_KEY` in the editor. Keep `TRAVEL_IMAGE_PROVIDER=wikimedia` and leave `PIXABAY_API_KEY` blank. For explicitly selected `pixabay`, configure `PIXABAY_API_KEY` locally. Leave `WEATHERBIT_FORECAST_DAYS=7` for the free plan. Select `16` only if your existing account already permits it. After the isolated PATH setup shown above, run:

```powershell
$env:TRAVEL_PORT = '4175'
$env:TRAVEL_PROVIDER_MODE = 'live'
$env:TRAVEL_IMAGE_PROVIDER = 'wikimedia'
npm run demo:live
```

Open [the local app](http://127.0.0.1:4175). Try `Lisbon, Portugal`. Where multiple places match, enter `City, Country` or `City, Region, Country`. Close the server with Ctrl+C. Node gives existing terminal environment variables precedence over its local environment file. Use a fresh shell if it contains older credential settings.

## Provider limits and offline behavior

- GeoNames uses its documented secure.geonames.org HTTPS endpoint. Free access lists 10,000 daily and 1,000 hourly credits per account. Search consumes one credit. The app links to GeoNames for attribution. [Overview](https://www.geonames.org/export/) · [Credits](https://www.geonames.org/export/credits.html)
- Weatherbit Free lists current conditions and a seven-day daily forecast, with up to 50 calls per day and one per second. The app uses at most one Weatherbit call per trip. Today shows current conditions with the UTC observation time. Future dates require an exact forecast match. Weatherbit data is held only for the current response and browser view, and its source and formatting attribution are visible. Free access is non-commercial. Check the applicable license before public or portfolio use. [Pricing](https://www.weatherbit.io/pricing) · [Terms](https://www.weatherbit.io/terms)
- Wikimedia starts with a free PageImages result from a Wikipedia city article checked by name and location. When Wikipedia lacks coordinates it can check the linked Wikidata item. An unsuitable lead triggers one bounded Commons text search. Commons file metadata, creator, source, restrictions and license must pass the local policy. The app downloads one validated JPEG and shows the source, title, creator, license and thumbnail disclosure. The Wikimedia-specific limit is 960 pixels per side and 2 MiB. Search and image records share the 12-entry, 24-hour private cache, with separate provider keys. [PageImages](https://www.mediawiki.org/wiki/API:Pageimages) · [ImageInfo](https://www.mediawiki.org/wiki/API:Imageinfo) · [Commons reuse](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia)
- Pixabay documents a default 100 calls per 60 seconds, 24-hour response caching, and no permanent direct image embedding or mass downloads. The app preserves one selected result or an empty result per canonical query for 24 hours across restarts, downloads only a selected candidate, and displays it from an opaque local image path with source credit. The ignored SQLite cache holds at most 12 entries with a 2 MiB limit per JPEG. Expired records are removed on cache use and startup. Use one live process per checkout. Empty, invalid or unrelated photo results show the labeled local illustration. Verify relevance visually. [API documentation](https://pixabay.com/api/docs/) · [Content license](https://pixabay.com/service/license-summary/)
- The service worker precaches the local application shell and its owned static assets. Live lookups, weather and destination photos require the server and stay outside that cache. The offline form shows a reconnect message.

Missing credentials stop live startup with the required field names. GeoNames authorization errors call for checking service activation. Weatherbit authorization or forecast-window warnings call for checking the existing plan and selected date. Image fallback can indicate absent relevant results, unsafe or unsupported image data, unavailable media, or a full cache. Wait for normal expiration if the cache is full. If port 4175 is occupied, leave the existing listener alone and choose a free port. Use that port for the browser URL and for TRAVEL_PORT in both terminals.

## Verification

```powershell
npm run build
npm run lint
npm run format:check
npm test
$env:PLAYWRIGHT_BROWSERS_PATH = (Resolve-Path -LiteralPath '../../P3-T03-A/ND0067-P03-My-Store/.local/browsers').Path
npm run test:e2e
```

Regression tests require no credentials. Live adapter tests inject upstream responses. The pinned browser is Chromium headless shell 159.0.8154.6, revision 1255.

For an explicit live check, start the live server first. In a second PowerShell terminal with the same isolated Node and browser PATH setup:

```powershell
$env:TRAVEL_PORT = '4175' # Match the port of the live server.
$env:TRAVEL_PROVIDER_MODE = 'live'
$env:TRAVEL_IMAGE_PROVIDER = 'wikimedia' # Match the server's provider.
$env:TRAVEL_LIVE_SMOKE = '1'
npm run smoke:live
```

One run submits five trips, paced at least 1.1 seconds apart. Paris, Tokyo, Cairo and Ramallah check current conditions. Lisbon checks an exact departure forecast two days ahead. Allow at most five GeoNames requests, five Weatherbit requests, 20 Wikimedia metadata requests and five selected JPEG downloads. Optional Pixabay uses at most five search calls and five downloads instead. The script records sanitized outcomes and private screenshots of successful displays in `.local/live-smoke`. Visually review photo relevance and the linked source and license. Stop the server after review.
