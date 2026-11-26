import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const observations = new WeakMap();
const cacheAssets = [
  '/app.css',
  '/app.js',
  '/assets/coast.svg',
  '/assets/fallback.svg',
  '/assets/hero.svg',
  '/assets/hills.svg',
  '/assets/logo.svg',
  '/index.html',
];

test.beforeEach(async ({ browser, page, context, baseURL }) => {
  expect(browser.version()).toBe('159.0.8154.6');
  await page.clock.setFixedTime(new Date('2026-01-30T12:00:00Z'));
  const violations = [];
  const requests = [];
  observations.set(page, { violations, requests });
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== baseURL) violations.push('unexpected outbound URL');
    requests.push({
      path: url.pathname,
      method: request.method(),
      worker: Boolean(request.serviceWorker()),
    });
  });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.origin === baseURL ? route.continue() : route.abort();
  });
  page.on('pageerror', () => violations.push('page error'));
});

test.afterEach(async ({ page }) => {
  const { violations, requests } = observations.get(page);
  expect(violations).toEqual([]);
  expect(
    requests.every(
      ({ method, path: requestPath }) =>
        method === 'GET' || (method === 'POST' && requestPath === '/all-apis'),
    ),
  ).toBe(true);
});

async function fillTrip(
  page,
  {
    destination = 'Paris',
    departure = '2026-01-30',
    returning = '2026-02-02',
  } = {},
) {
  await page.getByLabel('Destination').fill(destination);
  await page.getByLabel('Departure date').fill(departure);
  await page.getByLabel('Return date').fill(returning);
}

async function capture(page, info, state) {
  const folder = process.env.TRAVEL_SCREENSHOT_DIR;
  if (!folder) return;
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: path.join(folder, info.project.name + '-' + state + '.png'),
    fullPage: true,
  });
}

test.describe('online use with a fresh network context', () => {
  test.use({ serviceWorkers: 'block' });

  test('plans a cross-month trip from the keyboard and closes the result', async ({
    page,
  }, info) => {
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Plan Your Journey' }),
    ).toBeVisible();
    const submit = page.getByRole('button', { name: 'Plan My Trip' });
    expect((await submit.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await capture(page, info, 'form');
    await page.keyboard.press('Tab');
    const departure = page.getByLabel('Departure date');
    await expect(departure).toBeFocused();
    await expect(departure).toHaveCSS('outline-style', 'solid');
    await fillTrip(page);
    await page.getByLabel('Destination').press('Enter');
    const location = page.getByRole('heading', { name: 'Paris, France' });
    await expect(location).toBeVisible();
    await expect(location).toBeFocused();
    await expect(page.locator('#duration')).toHaveText('3 days');
    await expect(page.locator('#countdown')).toHaveText('Today');
    await expect(page.locator('#weather')).toContainText(
      'Synthetic near-term snapshot',
    );
    await expect(page.locator('#trip-image')).toHaveAttribute(
      'src',
      '/assets/coast.svg',
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await capture(page, info, 'result');
    await page.evaluate(() => {
      window.print = () => {
        document.body.dataset.printed = 'yes';
      };
    });
    await page.getByRole('button', { name: 'Print trip' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-printed', 'yes');
    expect(errors).toEqual([]);
    await page.getByRole('button', { name: 'Close trip' }).click();
    await expect(location).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Plan My Trip' }),
    ).toBeFocused();
  });

  test('handles reversed dates, no destination match and a same-day forecast', async ({
    page,
  }, info) => {
    await page.goto('/');
    await fillTrip(page, { departure: '2026-02-02', returning: '2026-01-30' });
    await page.getByRole('button', { name: 'Plan My Trip' }).click();
    await expect(page.getByRole('alert')).toContainText('dates in order');
    expect(
      observations.get(page).requests.filter(({ method }) => method === 'POST'),
    ).toHaveLength(0);
    await fillTrip(page, { destination: 'Unknown Town' });
    await page.getByRole('button', { name: 'Plan My Trip' }).click();
    await expect(page.getByRole('alert')).toContainText(
      'outside the demo catalog',
    );
    await capture(page, info, 'error');
    await fillTrip(page, { departure: '2026-02-07', returning: '2026-02-07' });
    await page.getByRole('button', { name: 'Plan My Trip' }).click();
    await expect(page.locator('#duration')).toHaveText('0 days');
    await expect(page.locator('#weather')).toContainText(
      'Synthetic departure forecast (2026-02-07)',
    );
  });

  test('renders markup-like fixture values as text and uses only the local fallback', async ({
    page,
  }) => {
    await page.goto('/');
    await fillTrip(page, { destination: 'Markup Bay' });
    await page.getByRole('button', { name: 'Plan My Trip' }).click();
    await expect(page.locator('#destination-name')).toHaveText(
      '<strong>Harbor</strong>, Fixture Land',
    );
    await expect(page.locator('#destination-name strong')).toHaveCount(0);
    await expect(page.locator('#weather')).toContainText('<em>Cloudy</em>');
    await expect(page.locator('#weather em')).toHaveCount(0);
    await expect(page.locator('#trip-image')).toHaveAttribute(
      'src',
      '/assets/fallback.svg',
    );
    await expect(page.locator('#warnings')).toContainText(
      'fallback illustration',
    );
  });
});

test.describe('offline shell in a fresh worker-enabled context', () => {
  test.use({ serviceWorkers: 'allow' });

  test('activates, controls the page, and cleans and serves only the allowed shell assets', async ({
    context,
    page,
    baseURL,
  }, info) => {
    const obsolete = 'workbox-precache-v1-' + baseURL + '/';
    await page.goto('/assets/logo.svg');
    await page.evaluate(async (name) => {
      const cache = await caches.open(name);
      await cache.put('/obsolete.css', new Response('old fixture'));
    }, obsolete);
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload();
    expect(
      await page.evaluate(() => navigator.serviceWorker.controller?.state),
    ).toBe('activated');

    const unknown = await page.evaluate(
      async () => (await fetch('/unrelated')).status,
    );
    expect(unknown).toBe(404);
    await fillTrip(page);
    await page.getByRole('button', { name: 'Plan My Trip' }).click();
    await expect(page.locator('#duration')).toHaveText('3 days');
    const stored = await page.evaluate(async () => {
      const keys = await caches.keys();
      const requests = await Promise.all(
        keys.map(async (name) => (await caches.open(name)).keys()),
      );
      return {
        keys,
        paths: requests
          .flat()
          .map((request) => new URL(request.url).pathname)
          .sort(),
      };
    });
    expect(stored.keys).not.toContain(obsolete);
    expect(stored.paths).toEqual(cacheAssets);
    expect(
      observations
        .get(page)
        .requests.some(
          ({ worker, path: requestPath }) =>
            worker && requestPath === '/app.js',
        ),
    ).toBe(true);

    await context.setOffline(true);
    const response = await page.reload();
    expect(response.fromServiceWorker()).toBe(true);
    await expect(
      page.getByRole('heading', { name: 'Plan Your Journey' }),
    ).toBeVisible();
    expect(
      await page
        .locator('header img')
        .evaluate((image) => image.complete && image.naturalWidth > 0),
    ).toBe(true);
    expect(
      await page.evaluate(async () => {
        try {
          await fetch('/unrelated');
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
    await fillTrip(page);
    await page.getByRole('button', { name: 'Plan My Trip' }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Offline. Reconnect to look up a trip.',
    );
    await capture(page, info, 'offline');
  });
});
