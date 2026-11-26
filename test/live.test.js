const { once } = require('node:events');
const { mkdirSync, mkdtempSync, unlinkSync, rmdirSync } = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { setTimeout: wait } = require('node:timers/promises');
const supertest = require('supertest');
const { createApp } = require('../src/server/app');
const { start, stop } = require('../src/server');
const { readProviderConfig } = require('../src/server/live-config');
const {
  createLiveProviders,
  imageUrl,
  jsonTimeout,
} = require('../src/server/live-providers');
const {
  openPixabayCache,
  maxEntries,
  photoLimit,
  ttl,
} = require('../src/server/pixabay-cache');
const {
  ProviderError,
  publicIPv4,
  readHttps,
} = require('../src/server/https-provider');
const { validJpeg } = require('../src/server/jpeg');
const { jpeg, samplePlace, sampleHit } = require('./live-fixtures.cjs');

const config = {
  mode: 'live',
  geonames: 'owner_fixture',
  weatherbit: 'weather_fixture_key',
  pixabay: 'photo_fixture_key',
  forecastDays: 7,
};
const today = '2026-01-30';
const input = {
  destination: 'Lisbon, Portugal',
  departureDate: today,
  returnDate: '2026-02-02',
};
const encoded = (body) => Buffer.from(JSON.stringify(body));
const geo = (places) =>
  encoded({ geonames: places, totalResultsCount: places.length });
const current = {
  ob_time: today + ' 08:00',
  temp: 18,
  weather: { description: 'Cloudy' },
};
let server;
let live;
let client;
let clock;

function fixture(url, options) {
  options.signal.throwIfAborted();
  if (url.hostname === 'api.geonames.org') return geo([samplePlace]);
  if (url.pathname === '/v2.0/current') return encoded({ data: [current] });
  if (url.pathname === '/v2.0/forecast/daily') {
    return encoded({
      data: [
        {
          valid_date: '2026-02-01',
          temp: 19,
          weather: { description: 'Sunny' },
        },
      ],
    });
  }
  if (url.pathname === '/api/') return encoded({ hits: [sampleHit] });
  if (url.pathname === '/get/sample_asset_640.jpg') return jpeg;
  throw new Error('Unexpected fixture call');
}

async function open(get = jest.fn(fixture)) {
  clock = 10000;
  const now = () => clock;
  live = createLiveProviders(config, {
    get,
    cache: openPixabayCache(':memory:', now),
    now,
  });
  server = start({
    port: 0,
    app: createApp({ live, clock: () => new Date(today + 'T12:00:00Z') }),
  });
  await once(server, 'listening');
  client = supertest('http://127.0.0.1:' + server.address().port);
  return get;
}

afterEach(async () => {
  if (server) await stop(server);
  if (live) live.close();
  server = undefined;
  live = undefined;
});

test('mock is the safe default and live configuration errors contain field names only', () => {
  expect(readProviderConfig({ WEATHERBIT_API_KEY: 'ignored' })).toEqual({
    mode: 'mock',
  });
  expect(() =>
    readProviderConfig({
      TRAVEL_PROVIDER_MODE: 'live',
      WEATHERBIT_API_KEY: 'one secret',
    }),
  ).toThrow(
    /^Live setup requires valid values in \.local\/live\.env for GEONAMES_USERNAME, WEATHERBIT_API_KEY, PIXABAY_API_KEY\.$/,
  );
  expect(
    readProviderConfig({
      TRAVEL_PROVIDER_MODE: 'live',
      GEONAMES_USERNAME: 'a',
      WEATHERBIT_API_KEY: 'b',
      PIXABAY_API_KEY: 'c',
    }),
  ).toMatchObject({ mode: 'live', forecastDays: 7 });
});

test('resolves a city beyond the mock catalog and serves valid JPEG through an opaque local endpoint', async () => {
  const get = await open();
  await client
    .get('/trip-mode')
    .expect(200, { mode: 'live' })
    .expect('Cache-Control', 'no-store');
  const result = await client
    .post('/all-apis')
    .send(input)
    .expect(200)
    .expect('Cache-Control', 'no-store');
  expect(result.body).toMatchObject({
    synthetic: false,
    durationDays: 3,
    location: {
      name: 'Lisbon',
      country: 'Portugal',
      latitude: 38.72,
      longitude: -9.14,
    },
    weather: { kind: 'current', temperatureC: 18, date: today + ' 08:00 UTC' },
    photo: { creator: 'Fixture Photographer', source: sampleHit.pageURL },
    warnings: [],
  });
  expect(result.body.image).toMatch(/^\/trip-photo\/[a-f0-9]{32}$/);
  for (const secret of [
    config.geonames,
    config.weatherbit,
    config.pixabay,
    sampleHit.webformatURL,
  ])
    expect(result.text).not.toContain(secret);
  const media = await client
    .get(result.body.image)
    .expect(200)
    .expect('Content-Type', 'image/jpeg')
    .expect('Cache-Control', 'no-store')
    .expect('Cross-Origin-Resource-Policy', 'same-origin');
  expect(media.body).toEqual(jpeg);
  const urls = get.mock.calls.map(([url]) => url);
  expect(urls[0].searchParams.get('name_equals')).toBe('Lisbon');
  expect(urls[0].searchParams.get('country')).toBe('PT');
  const weatherUrl = urls.find((url) => url.hostname === 'api.weatherbit.io');
  expect(weatherUrl.searchParams.get('lat')).toBe('38.72');
  expect(weatherUrl.searchParams.get('lon')).toBe('-9.14');
  const photoUrl = urls.find((url) => url.pathname === '/api/');
  expect(Object.fromEntries(photoUrl.searchParams)).toMatchObject({
    q: 'Lisbon Portugal',
    image_type: 'photo',
    orientation: 'horizontal',
    safesearch: 'true',
  });
  expect(urls).toHaveLength(4);
  await client.get('/trip-photo/invalid').expect(404);
});

test('handles unknown, ambiguous, malformed, unauthorized and quota-limited GeoNames results', async () => {
  const get = await open(
    jest.fn((url) => {
      const name = url.searchParams.get('name_equals');
      if (name === 'Unknown') return geo([]);
      if (name === 'Invalid') return geo([{ ...samplePlace, lat: 900 }]);
      if (name === 'Quota')
        return encoded({ status: { value: 19, message: config.geonames } });
      if (name === 'Login')
        return encoded({ status: { value: 10, message: config.geonames } });
      return geo([samplePlace, { ...samplePlace, geonameId: 99 }]);
    }),
  );
  for (const [destination, status, error] of [
    ['Unknown', 404, 'destination_not_found'],
    ['Invalid', 502, 'location_unavailable'],
    ['Quota', 503, 'location_rate_limited'],
    ['Login', 502, 'location_authorization'],
    ['Lisbon', 409, 'destination_ambiguous'],
  ]) {
    await client
      .post('/all-apis')
      .send({ ...input, destination })
      .expect(status, { error });
  }
  expect(get).toHaveBeenCalledTimes(5);
});

test('selects exact forecast date and skips upstream weather beyond configured horizon', async () => {
  const get = await open();
  const forecast = await client
    .post('/all-apis')
    .send({ ...input, departureDate: '2026-02-01' })
    .expect(200);
  expect(forecast.body.weather).toMatchObject({
    kind: 'live-forecast',
    date: '2026-02-01',
    temperatureC: 19,
  });
  clock += 1000;
  const missing = await client
    .post('/all-apis')
    .send({ ...input, departureDate: '2026-02-02' })
    .expect(200);
  expect(missing.body).toMatchObject({
    weather: null,
    warnings: ['weather_outside_window'],
  });
  clock += 1000;
  const later = await client
    .post('/all-apis')
    .send({ ...input, departureDate: '2026-02-06', returnDate: '2026-02-07' })
    .expect(200);
  expect(later.body).toMatchObject({
    weather: null,
    warnings: ['weather_outside_window'],
  });
  expect(
    get.mock.calls.filter(([url]) => url.hostname === 'api.weatherbit.io'),
  ).toHaveLength(2);
});

test.each(['authorization', 'rate_limited', 'malformed', 'echoed_key'])(
  'keeps weather failures and sensitive errors controlled (%s)',
  async (kind) => {
    await open((url, options) => {
      if (url.hostname !== 'api.weatherbit.io') return fixture(url, options);
      if (kind === 'malformed') return Buffer.from('invalid json');
      if (kind === 'echoed_key')
        return encoded({
          data: [
            {
              ...current,
              weather: { description: 'details ' + config.weatherbit },
            },
          ],
        });
      throw new ProviderError(kind);
    });
    const result = await client.post('/all-apis').send(input).expect(200);
    expect(result.body.weather).toBeNull();
    const warning =
      kind === 'authorization'
        ? 'weather_not_entitled'
        : kind === 'rate_limited'
          ? 'weather_rate_limited'
          : 'weather_unavailable';
    expect(result.body.warnings).toContain(warning);
    expect(result.text).not.toContain(config.weatherbit);
  },
);

test.each(['empty', 'irrelevant', 'unapproved', 'oversize', 'invalid'])(
  'serves the labeled local fallback for an unusable photo (%s)',
  async (kind) => {
    const get = await open(
      jest.fn((url, options) => {
        if (url.pathname === '/api/') {
          if (kind === 'empty') return encoded({ hits: [] });
          if (kind === 'irrelevant')
            return encoded({
              hits: [{ ...sampleHit, tags: 'ocean, Portugal' }],
            });
          if (kind === 'unapproved')
            return encoded({
              hits: [
                {
                  ...sampleHit,
                  webformatURL: 'https://example.invalid/get/photo_640.jpg',
                },
              ],
            });
        }
        if (url.pathname === '/get/sample_asset_640.jpg') {
          return kind === 'oversize'
            ? Buffer.alloc(photoLimit + 1)
            : Buffer.from('not an image');
        }
        return fixture(url, options);
      }),
    );
    const result = await client.post('/all-apis').send(input).expect(200);
    expect(result.body).toMatchObject({
      photo: null,
      image: '/assets/fallback.svg',
      warnings: ['image_unavailable'],
    });
    expect(
      get.mock.calls.some(([url]) => url.hostname === 'example.invalid'),
    ).toBe(false);
  },
);

test('honors the complete 24-hour photo search cache and expiration without persisting weather', async () => {
  const get = await open();
  const a = await client.post('/all-apis').send(input).expect(200);
  clock += ttl - 1;
  const b = await client.post('/all-apis').send(input).expect(200);
  expect(b.body.image).toBe(a.body.image);
  expect(
    get.mock.calls.filter(([url]) => url.hostname === 'api.weatherbit.io'),
  ).toHaveLength(2);
  expect(
    get.mock.calls.filter(([url]) => url.pathname === '/api/'),
  ).toHaveLength(1);
  expect(
    get.mock.calls.filter(([url]) => url.pathname.startsWith('/get/')),
  ).toHaveLength(1);
  clock++;
  await client.get(a.body.image).expect(404);
  const c = await client.post('/all-apis').send(input).expect(200);
  expect(c.body.image).not.toBe(a.body.image);
  expect(
    get.mock.calls.filter(([url]) => url.pathname === '/api/'),
  ).toHaveLength(2);
});

test('cache rejects excess entries without evicting active records', () => {
  const cache = openPixabayCache(':memory:');
  try {
    for (let i = 0; i < maxEntries; i++) cache.save('key' + i, null);
    expect(cache.hasRoom()).toBe(false);
    cache.save('extra', null);
    expect(cache.lookup('extra')).toBeNull();
    expect(cache.lookup('key0')).toEqual({ hit: null, token: null });
  } finally {
    cache.close();
  }
});

test('GeoNames deadline actually aborts delayed work and does not retry', async () => {
  const settled = jest.fn();
  const get = await open(
    jest.fn(async (_url, { signal }) => {
      try {
        await wait(jsonTimeout + 1000, undefined, { signal });
      } finally {
        settled(signal.aborted);
      }
    }),
  );
  await client.post('/all-apis').send(input).expect(504);
  expect(settled).toHaveBeenCalledTimes(1);
  expect(settled).toHaveBeenCalledWith(true);
  expect(get).toHaveBeenCalledTimes(1);
});

test('image URL checks, public address boundary, and structural JPEG limits are enforced', () => {
  expect(imageUrl(sampleHit.webformatURL)).not.toBeNull();
  for (const url of [
    'http://pixabay.com/get/photo_640.jpg',
    'https://example.invalid/get/photo_640.jpg',
    'https://pixabay.com/other/photo_640.jpg',
    'https://pixabay.com/get/photo_640.jpg?x=1',
  ])
    expect(imageUrl(url)).toBeNull();
  for (const ip of [
    '127.0.0.1',
    '10.2.3.4',
    '169.254.1.1',
    '192.168.1.2',
    '::1',
    '203.0.113.8',
  ])
    expect(publicIPv4(ip)).toBe(false);
  expect(publicIPv4('8.8.8.8')).toBe(true);
  expect(validJpeg(jpeg)).toBe(true);
  expect(validJpeg(jpeg.subarray(0, -2))).toBe(false);
  expect(validJpeg(Buffer.concat([jpeg, Buffer.from('trailing')]))).toBe(false);
});

test('HTTPS response handler rejects redirects before reading and cancels oversize streams', async () => {
  const url = new URL(sampleHit.webformatURL);
  const max = 16;
  const signal = new AbortController().signal;
  async function check(statusCode, bytes) {
    const response = new PassThrough();
    response.statusCode = statusCode;
    response.headers = {
      'content-type': 'image/jpeg',
      location: 'https://example.invalid/',
    };
    const open = jest.fn((_url, settings, callback) => {
      expect(settings.agent).toBe(false);
      const request = new PassThrough();
      setImmediate(() => {
        callback(response);
        response.end(bytes);
      });
      return request;
    });
    await expect(
      readHttps(url, '8.8.8.8', {
        signal,
        cap: max,
        accept: 'image/jpeg',
        open,
      }),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(open).toHaveBeenCalledTimes(1);
    expect(response.destroyed).toBe(true);
  }
  await check(302, Buffer.from('redirect'));
  await check(200, Buffer.alloc(max + 1));
});

test('disk cache keeps authorized results across local restarts and expires them safely', () => {
  const root = path.resolve('.local');
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(path.join(root, 'jest-photo-'));
  const filename = path.join(directory, 'cache.sqlite');
  let clock = 0;
  let cache = openPixabayCache(filename, () => clock);
  try {
    cache.save('lisbon portugal', { creator: 'Fixture' });
    const token = cache.savePhoto('lisbon portugal', jpeg);
    cache.close();
    cache = openPixabayCache(filename, () => clock);
    expect(Buffer.from(cache.getPhoto(token))).toEqual(jpeg);
    clock = ttl;
    expect(cache.getPhoto(token)).toBeNull();
  } finally {
    cache.close();
    unlinkSync(filename);
    rmdirSync(directory);
  }
});

test('photo deadline stops pending image work and keeps the live trip', async () => {
  const cancelled = jest.fn();
  const transport = await open(
    jest.fn(async (url, options) => {
      if (url.pathname.startsWith('/get/')) {
        try {
          await wait(5000, undefined, { signal: options.signal });
        } finally {
          cancelled(options.signal.aborted);
        }
      }
      return fixture(url, options);
    }),
  );
  const result = await client.post('/all-apis').send(input).expect(200);
  expect(cancelled).toHaveBeenCalledTimes(1);
  expect(cancelled).toHaveBeenCalledWith(true);
  expect(result.body).toMatchObject({
    warnings: ['image_unavailable'],
    synthetic: false,
    photo: null,
  });
  expect(transport).toHaveBeenCalledTimes(4);
}, 8000);
