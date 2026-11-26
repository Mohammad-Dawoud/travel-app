const { once } = require('node:events');
const { request } = require('node:http');
const { setTimeout: wait } = require('node:timers/promises');
const testRequest = require('supertest');
const { createApp } = require('../src/server/app');
const { lookupFixture } = require('../src/server/fixtures');
const { start, stop } = require('../src/server');
const { calendarOffset } = require('../src/shared/trip');

const today = '2026-01-30';
const valid = {
  destination: 'Paris',
  departureDate: today,
  returnDate: '2026-02-02',
};
let server;
let client;
let origin;

async function open(lookup) {
  server = start({
    port: 0,
    app: createApp({ lookup, clock: () => new Date(today + 'T00:00:00Z') }),
  });
  await once(server, 'listening');
  const address = server.address();
  expect(address.address).toBe('127.0.0.1');
  origin = 'http://127.0.0.1:' + address.port;
  client = testRequest(origin);
}

afterEach(async () => {
  if (server) await stop(server);
  server = undefined;
});

test('valid trip uses exactly three encoded fixture lookups with a same-origin JSON response', async () => {
  const lookup = jest.fn(lookupFixture);
  await open(lookup);
  const result = await client
    .post('/all-apis')
    .send(valid)
    .expect(200)
    .expect('Cache-Control', 'no-store');
  expect(result.body).toMatchObject({
    location: { name: 'Paris', country: 'France' },
    departureDate: today,
    returnDate: '2026-02-02',
    durationDays: 3,
    countdownDays: 0,
    image: '/assets/coast.svg',
    weather: { kind: 'near-term', date: today },
    synthetic: true,
    warnings: [],
  });
  expect(result.body.geonames).toBeUndefined();
  expect(
    lookup.mock.calls.map(([provider, params]) => [
      provider,
      params.toString(),
    ]),
  ).toEqual([
    ['geonames', 'q=Paris&maxRows=1'],
    ['weatherbit', 'lat=48.86&lon=2.35&today=2026-01-30&mode=near-term'],
    ['pixabay', 'q=Paris'],
  ]);
});

test('forecast uses the exact departure date and preserves trips outside the fixture horizon', async () => {
  await open();
  const date = calendarOffset(today, 8);
  const forecast = await client
    .post('/all-apis')
    .send({ ...valid, departureDate: date, returnDate: date })
    .expect(200);
  expect(forecast.body.weather).toMatchObject({ kind: 'forecast', date });
  const later = calendarOffset(today, 16);
  const partial = await client
    .post('/all-apis')
    .send({ ...valid, departureDate: later, returnDate: later })
    .expect(200);
  expect(partial.body.weather).toBeNull();
  expect(partial.body.warnings).toEqual(['weather_unavailable']);
});

test('rejects malformed JSON, invalid input, cross-origin and over-limit bodies before providers', async () => {
  const lookup = jest.fn(lookupFixture);
  await open(lookup);
  await client
    .post('/all-apis')
    .set('Content-Type', 'application/json')
    .send('{')
    .expect(400, { error: 'invalid_json' });
  await client
    .post('/all-apis')
    .send({ ...valid, departureDate: '2026-02-30' })
    .expect(400, { error: 'invalid_trip' });
  await client
    .post('/all-apis')
    .send({ ...valid, returnDate: '2026-01-29' })
    .expect(400, { error: 'invalid_trip' });
  await client
    .post('/all-apis')
    .send({ ...valid, destination: 'A' })
    .expect(400, { error: 'invalid_trip' });
  await client
    .post('/all-apis')
    .set('Host', 'example.invalid')
    .send(valid)
    .expect(400);
  await client
    .post('/all-apis')
    .set('Origin', 'http://example.invalid')
    .send(valid)
    .expect(403);
  await client.post('/all-apis').type('text').send('fixture').expect(415);
  const exact = JSON.stringify(valid).padEnd(4096);
  await client
    .post('/all-apis')
    .type('application/json')
    .send(exact + ' ')
    .expect(413);
  expect(lookup).not.toHaveBeenCalled();
  await client
    .post('/all-apis')
    .type('application/json')
    .send(exact)
    .expect(200);
});

test('empty location and malformed coordinates do not trigger downstream lookups', async () => {
  const lookup = jest.fn((provider, query, options) =>
    query.get('q') === 'Paris'
      ? Response.json({
          geonames: [
            { name: 'Paris', countryName: 'France', lat: 200, lng: 2 },
          ],
        })
      : lookupFixture(provider, query, options),
  );
  await open(lookup);
  await client
    .post('/all-apis')
    .send({ ...valid, destination: 'Unknown town' })
    .expect(404);
  await client
    .post('/all-apis')
    .send(valid)
    .expect(502, { error: 'location_unavailable' });
  expect(lookup).toHaveBeenCalledTimes(2);
});

test('optional HTTP failure and malformed image produce a bounded partial trip', async () => {
  await open((provider, query, options) => {
    if (provider === 'weatherbit')
      return Response.json({ privateFixture: true }, { status: 503 });
    if (provider === 'pixabay')
      return Response.json({ hits: [{ id: 'other' }] });
    return lookupFixture(provider, query, options);
  });
  const result = await client.post('/all-apis').send(valid).expect(200);
  expect(result.body).toMatchObject({
    weather: null,
    image: '/assets/fallback.svg',
    warnings: ['weather_unavailable', 'image_unavailable'],
  });
  expect(result.text).not.toContain('privateFixture');
});

test('provider streaming limit cancels the reader and returns normalized failure', async () => {
  const cancel = jest.fn();
  await open(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(64 * 1024 + 1));
          },
          cancel,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
  );
  await client
    .post('/all-apis')
    .send(valid)
    .expect(502, { error: 'location_unavailable' });
  expect(cancel).toHaveBeenCalledTimes(1);
});

test('required provider deadline cancels actual delayed work before responding', async () => {
  const settled = jest.fn();
  await open(async (name, query, { signal }) => {
    try {
      await wait(4000, undefined, { signal });
    } finally {
      settled(signal.aborted);
    }
  });
  await client
    .post('/all-apis')
    .send(valid)
    .expect(504, { error: 'location_timeout' });
  expect(settled).toHaveBeenCalledWith(true);
  expect(settled).toHaveBeenCalledTimes(1);
});

test('optional timeout cancels the pending body and releases its reader', async () => {
  const cancel = jest.fn();
  const stream = new ReadableStream({ cancel });
  await open((provider, query, options) =>
    provider === 'weatherbit'
      ? new Response(stream, {
          headers: { 'Content-Type': 'application/json' },
        })
      : lookupFixture(provider, query, options),
  );
  const result = await client.post('/all-apis').send(valid).expect(200);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(stream.locked).toBe(false);
  expect(result.body.warnings).toEqual(['weather_unavailable']);
});

test('client disconnection cancels pending work and releases capacity', async () => {
  const entered = Promise.withResolvers();
  const exited = Promise.withResolvers();
  await open(async (provider, query, options) => {
    if (query.get('q') === 'Cairo') {
      entered.resolve();
      try {
        await wait(4000, undefined, options);
      } finally {
        exited.resolve(options.signal.aborted);
      }
    }
    return lookupFixture(provider, query, options);
  });
  const outgoing = request(origin + '/all-apis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  outgoing.on('error', () => {});
  outgoing.end(JSON.stringify({ ...valid, destination: 'Cairo' }));
  await entered.promise;
  outgoing.destroy();
  await expect(exited.promise).resolves.toBe(true);
  await client.post('/all-apis').send(valid).expect(200);
});

test('rejects the ninth active request and accepts later trips after cleanup', async () => {
  const ready = Promise.withResolvers();
  const release = Promise.withResolvers();
  let count = 0;
  await open(async (provider, query, options) => {
    if (provider === 'geonames') {
      count++;
      if (count === 8) ready.resolve();
      await release.promise;
    }
    return lookupFixture(provider, query, options);
  });
  const jobs = Array.from({ length: 8 }, () =>
    client
      .post('/all-apis')
      .send(valid)
      .expect(200)
      .then((result) => result),
  );
  try {
    await ready.promise;
    await client.post('/all-apis').send(valid).expect(429);
    expect(count).toBe(8);
  } finally {
    release.resolve();
    await Promise.all(jobs);
  }
  await client.post('/all-apis').send(valid).expect(200);
});
