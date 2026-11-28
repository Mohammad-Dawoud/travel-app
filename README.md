# Travel Guide App

Travel App was my original capstone project for Udacity's Front End Web Developer Nanodegree. The later technical recovery restored the local build and server, added deterministic weather and image fixtures, and implemented bounded live provider requests and a service worker for the app shell.

Plan a trip by destination, departure date and return date. The app shows the departure countdown, trip duration, weather and a destination photograph or local illustration. The default mode uses synthetic data and needs no credentials. Optional live mode uses GeoNames and Weatherbit, with Wikimedia Commons as the default photo provider.

## Run locally in mock mode

Install [Node.js 24.22.3 LTS](https://nodejs.org/en/blog/release/v24.22.3/) with npm 11.19.1 and make both available on your PATH. Use a fresh terminal without a live-mode override. From a fresh clone:

```sh
git clone https://github.com/Mohammad-Dawoud/travel-app.git
cd travel-app
node --version
npm --version
npm ci --ignore-scripts --include=optional --no-audit --no-fund
npm run demo
```

`npm run demo` builds the client and service worker, then starts Express. Open [http://127.0.0.1:4175](http://127.0.0.1:4175) and try Paris, Tokyo or Cairo. Dates use UTC calendar days. The server listens on loopback. Press Ctrl+C to stop it. If port 4175 is busy, set `TRAVEL_PORT` to a free local port and use the address printed at startup.

The pinned npm CLI has separately tracked advisory findings in its bundled dependencies. Use the reviewed lock and trusted npm registry inputs. The install command disables package lifecycle scripts.

## Optional live mode

1. Use your [GeoNames account](https://www.geonames.org/create-account) with free web services enabled and your [Weatherbit account](https://www.weatherbit.io/account/create) with the required endpoint access and usage rights.
2. Copy `.env.example` to `.local/live.env` inside this clone. In PowerShell, with the working directory set to the repository:

   ```powershell
   New-Item -ItemType Directory -Path '.local' -Force | Out-Null
   if (!(Test-Path -LiteralPath '.local/live.env')) {
     Copy-Item -LiteralPath '.env.example' -Destination '.local/live.env'
   }
   ```

3. Edit that private file locally. Set `GEONAMES_USERNAME` and `WEATHERBIT_API_KEY` using fresh owner-managed values. Keep `TRAVEL_PROVIDER_MODE=live` and `TRAVEL_IMAGE_PROVIDER=wikimedia`. Wikimedia Commons requires no key. Keep `WEATHERBIT_FORECAST_DAYS=7` unless your account supports 16 days. For explicitly selected `pixabay`, use your [approved Pixabay account](https://pixabay.com/accounts/register/) and set `PIXABAY_API_KEY`. Genuine Pixabay access remains unverified for this app.
4. Run `npm run demo:live` and open the printed loopback URL. Try `Lisbon, Portugal`. If the city is ambiguous, add the country or region. Stop with Ctrl+C.

The server reads `.local/live.env` only for the explicit live commands. Keep the file out of Git, browser code and screenshots. Existing shell variables take precedence over the file, so use a fresh shell if you configured providers in another session. Revoke or rotate any historically exposed key through its provider.

## Provider data, photo credits and offline behavior

- **GeoNames** resolves destinations on its secure HTTPS endpoint. Use the limits and credits for your account. The app links to GeoNames for attribution. [Web services overview](https://www.geonames.org/export/) · [Credit limits](https://www.geonames.org/export/credits.html)
- **Weatherbit** supplies current conditions with a UTC observation time or an exact-date forecast when the departure is within the available window. Weather responses are transient and attributed in the app. Confirm your plan's limits and public-use rights before any hosted demo or redistribution. Free access is non-commercial. [Pricing](https://www.weatherbit.io/pricing) · [Terms](https://www.weatherbit.io/terms)
- **Wikimedia Commons** starts with an article check via Wikipedia PageImages, then verifies the image source and license using Commons metadata. The app displays a title, creator, source and license link plus the thumbnail disclosure. Retain the creator, source, applicable license and change disclosures if you reuse an image. Follow any share-alike requirements of the particular file. The app keeps selected thumbnails in a private bounded cache. [PageImages](https://www.mediawiki.org/wiki/API:Pageimages) · [ImageInfo](https://www.mediawiki.org/wiki/API:Imageinfo) · [Commons reuse requirements](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia)
- **Pixabay** is optional. The app keeps selected results or empty results in an ignored 24-hour cache and shows source credit. A missing or unsuitable photo displays a labeled local illustration. [API documentation](https://pixabay.com/api/docs/) · [Content license](https://pixabay.com/service/license-summary/)
- The **service worker** can reload the app shell and owned static assets after an online visit. Trip lookup requires the local server. Live weather and destination photos stay out of the offline cache.

## Verification and scope

From the repository root after the locked install, run:

```sh
npm run build
npm run lint
npm run format:check
npm test
npm exec -- playwright install --only-shell chromium
npm run test:e2e
```

The regression suites use fixture data. Playwright 1.65.1 uses Chromium headless shell 159.0.8154.6 (revision 1255). Keep local port 4176 available for the browser tests. On other operating systems, see the [Playwright browser setup](https://playwright.dev/docs/browsers) for platform dependencies.

The accepted Windows x64 loopback recovery passed build, lint, formatting, 54 Jest tests and 10 Playwright cases at desktop and narrow widths. Five live trips passed with genuine GeoNames, Weatherbit and Wikimedia responses, including an exact-date forecast. The owner passed six additional manual checks. The optional Pixabay path was checked with fixtures only.

For the opt-in live smoke, keep the live server running and use a second PowerShell terminal in the same checkout with the same `TRAVEL_PORT` if you changed it:

```powershell
$env:TRAVEL_LIVE_SMOKE = '1'
npm run smoke:live
```

The smoke sends five trip requests and uses the providers' account quotas. Install the browser above before running it. Keep its verification outputs private and stop the server after review.

The original academic submission passed its historical assessment. Historical design comparison and the historical choice of optional enhancement remain unverified. The current recovery verifies the return-date and trip-duration feature. Verification covers a local portfolio demo. Production readiness, public deployment and redistribution of provider data or photos remain separate.
