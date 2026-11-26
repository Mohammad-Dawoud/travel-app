# Travel Guide App

An academic travel-planning demo with a destination lookup, departure countdown, trip duration and synthetic weather. The local Express API runs deterministic GeoNames, Weatherbit and Pixabay fixtures. Try Paris, Tokyo or Cairo. This demonstration uses no live providers or credentials.

## Run locally

Use Node.js 24.22.3 and npm 11.19.1. From this working copy on Windows:

```powershell
$travelNode = (Resolve-Path -LiteralPath '../../P3-T01-A/ND0067-P01-Image-Processing-API/.local/node-v24.22.3-win-x64').Path
$env:Path = "$travelNode;$env:Path"
npm ci --ignore-scripts --include=optional --no-audit --no-fund
npm run demo
```

Open [http://127.0.0.1:4175](http://127.0.0.1:4175). Use today or a future UTC calendar date and a return on or after departure. Stop with Ctrl+C in the launch terminal.

The production build uses Webpack, Sass and Babel. Workbox caches the installed shell and owned static assets. Trip lookup requires the local server. Trip submissions and responses stay outside the service-worker cache.

The compass and illustrations were independently authored for this recovery. The demo uses system fonts and provides a local fallback illustration. The original portfolio snapshot and wider publication approval are separate.

## Verification

```powershell
npm run build
npm run lint
npm run format:check
npm test
$env:PLAYWRIGHT_BROWSERS_PATH = (Resolve-Path -LiteralPath '../../P3-T03-A/ND0067-P03-My-Store/.local/browsers').Path
npm run test:e2e
```

The browser checks use Playwright 1.65.1 with Chromium headless shell revision 1255 on a separate loopback port. Jest and SuperTest check the client validation and actual HTTP route with synthetic fixtures.
