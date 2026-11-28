const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { chromium } = require('@playwright/test');
const { calendarDay, calendarOffset } = require('../src/shared/trip');
const { localPhotoPattern, photoSource } = require('../src/shared/live-media');
const { readProviderConfig } = require('../src/server/live-config');

const destinations = [
  ['Paris, France', 'France', 0],
  ['Tokyo, Japan', 'Japan', 0],
  ['Cairo, Egypt', 'Egypt', 0],
  ['Lisbon, Portugal', 'Portugal', 2],
  ['Ramallah, PS', null, 0],
];

async function verify() {
  if (process.env.TRAVEL_LIVE_SMOKE !== '1')
    throw new Error(
      'Set TRAVEL_LIVE_SMOKE=1 only when you intend to make five live trip requests.',
    );
  const config = readProviderConfig();
  if (config.mode !== 'live')
    throw new Error('Configure live mode before opting in.');
  const port = Number(process.env.TRAVEL_PORT ?? 4175);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid local port.');
  const url = 'http://127.0.0.1:' + port;
  const mode = await fetch(url + '/trip-mode', {
    signal: AbortSignal.timeout(1500),
  });
  if (!mode.ok) throw new Error('Live server unavailable.');
  const info = await mode.json();
  if (info.mode !== 'live' || info.imageProvider !== config.imageProvider)
    throw new Error('Start the live demo on the selected loopback port first.');

  const browser = await chromium.launch({
    args: ['--disable-background-networking', '--no-proxy-server'],
  });
  const results = [];
  const folder = path.resolve('.local/live-smoke');
  try {
    if (browser.version() !== '159.0.8154.6')
      throw new Error('Unexpected Chromium version.');
    const context = await browser.newContext({
      serviceWorkers: 'block',
      viewport: { width: 1440, height: 1000 },
    });
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === url
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    await page.goto(url);
    const today = calendarDay(new Date());

    for (const [destination, country, offset] of destinations) {
      try {
        const date = calendarOffset(today, offset);
        const expectedWeather = offset ? 'live-forecast' : 'current';
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.getByLabel('Destination').fill(destination);
        await page.getByLabel('Departure date').fill(date);
        await page.getByLabel('Return date').fill(date);
        const response = page.waitForResponse(
          (item) =>
            item.url() === url + '/all-apis' &&
            item.request().method() === 'POST',
          { timeout: 26_000 },
        );
        await page.getByRole('button', { name: 'Plan My Trip' }).click();
        const http = await response;
        const trip = await http.json();
        if (
          !http.ok ||
          trip.synthetic !== false ||
          (country
            ? trip.location?.country !== country
            : trip.location?.name !== 'Ramallah') ||
          trip.weather?.kind !== expectedWeather ||
          (offset && trip.weather.date !== date) ||
          typeof trip.weather?.date !== 'string' ||
          !Number.isFinite(trip.weather?.temperatureC) ||
          !localPhotoPattern.test(trip.image) ||
          !photoSource(trip.photo)
        ) {
          results.push({
            destination,
            status: 'incomplete',
            http: http.status(),
            error: [
              'location_authorization',
              'location_rate_limited',
              'location_timeout',
              'location_unavailable',
              'destination_ambiguous',
              'destination_not_found',
            ].includes(trip.error)
              ? trip.error
              : null,
            location: country
              ? trip.location?.country === country
              : trip.location?.name === 'Ramallah',
            weather: Boolean(trip.weather),
            photo: Boolean(trip.photo),
          });
          continue;
        }
        const image = page.locator('#trip-image');
        await page.waitForFunction(
          (expected) => {
            const photo = globalThis.document.querySelector('#trip-image');
            return (
              photo.complete &&
              photo.naturalWidth > 0 &&
              photo.getAttribute('src') === expected
            );
          },
          trip.image,
          { timeout: 5000 },
        );
        await mkdir(folder, { recursive: true });
        for (const [viewport, width, height] of [
          ['desktop', 1440, 1000],
          ['mobile', 390, 844],
        ]) {
          await page.setViewportSize({ width, height });
          await image.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: path.join(
              folder,
              destination.split(',')[0].toLowerCase() + '-' + viewport + '.png',
            ),
            fullPage: true,
          });
        }
        results.push({
          destination,
          status: 'providers responded; photo relevance review pending',
          observation: trip.weather.date,
          source: photoSource(trip.photo),
          imageProvider: info.imageProvider,
          license: trip.photo.license ?? null,
        });
      } catch {
        results.push({ destination, status: 'browser or lookup check failed' });
      } finally {
        await wait(1100);
      }
    }
  } finally {
    await browser.close();
  }

  await mkdir(folder, { recursive: true });
  const summary = JSON.stringify(results, null, 2);
  await writeFile(path.join(folder, 'summary.json'), summary + '\n');
  console.log(summary);
  if (
    results.some(
      (item) =>
        item.status !== 'providers responded; photo relevance review pending',
    )
  )
    process.exitCode = 1;
}

verify().catch(() => {
  console.error(
    'Live smoke could not start. Verify opt-in, local credentials, pinned browser and the running live demo on the selected loopback port.',
  );
  process.exitCode = 1;
});
