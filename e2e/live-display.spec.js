import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { jpeg } from '../test/live-fixtures.cjs';

test.use({ serviceWorkers: 'block' });

test('displays live-mode wording and an attributed local JPEG with injected contract data', async ({
  page,
  context,
  baseURL,
}, info) => {
  const foreign = [];
  const tokenPath = '/trip-photo/' + 'a'.repeat(32);
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === baseURL)
      return route.continue();
    foreign.push('unexpected request');
    return route.abort();
  });
  await page.route('**/trip-mode', (route) =>
    route.fulfill({ json: { mode: 'live' } }),
  );
  await page.route('**' + tokenPath, (route) =>
    route.fulfill({ contentType: 'image/jpeg', body: jpeg }),
  );
  await page.route('**/all-apis', (route) =>
    route.fulfill({
      json: {
        location: { name: 'Lisbon', country: 'Portugal' },
        departureDate: '2026-01-30',
        returnDate: '2026-02-02',
        countdownDays: 0,
        durationDays: 3,
        weather: {
          kind: 'current',
          date: '2026-01-30 08:00 UTC',
          temperatureC: 18,
          description: 'Fixture conditions',
        },
        image: tokenPath,
        photo: {
          creator: 'Fixture Photographer',
          source: 'https://pixabay.com/photos/lisbon-123456/',
        },
        warnings: [],
        synthetic: false,
      },
    }),
  );
  await page.clock.setFixedTime(new Date('2026-01-30T12:00:00Z'));
  await page.goto('/');
  await expect(page.locator('#mode-note')).toContainText('Live lookup');
  await expect(page.locator('#mode-note')).not.toContainText('Try Paris');
  await page.getByLabel('Destination').fill('Lisbon, Portugal');
  await page.getByLabel('Departure date').fill('2026-01-30');
  await page.getByLabel('Return date').fill('2026-02-02');
  await page.getByRole('button', { name: 'Plan My Trip' }).click();
  await expect(page.locator('#destination-name')).toHaveText(
    'Lisbon, Portugal',
  );
  await expect(page.locator('#duration')).toHaveText('3 days');
  await expect(page.locator('#weather')).toContainText('Current conditions');
  await expect(page.getByRole('link', { name: 'GeoNames' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Weatherbit' })).toBeVisible();
  await expect(
    page.getByRole('link', {
      name: 'Photo by Fixture Photographer on Pixabay',
    }),
  ).toHaveAttribute('href', 'https://pixabay.com/photos/lisbon-123456/');
  await expect
    .poll(() =>
      page.locator('#trip-image').evaluate((image) => image.naturalWidth),
    )
    .toBe(24);
  expect(foreign).toEqual([]);
  const folder = process.env.TRAVEL_SCREENSHOT_DIR;
  if (folder) {
    await page.locator('#mode-note').evaluate((note) => {
      note.textContent += ' Injected verification data.';
    });
    await mkdir(folder, { recursive: true });
    await page.screenshot({
      path: path.join(folder, info.project.name + '-live-ui-injected.png'),
      fullPage: true,
    });
  }
});
