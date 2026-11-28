const {
  createWikimediaImageProvider,
  assetUrl,
  selectPhoto,
} = require('../src/server/wikimedia-provider');
const { createLiveProviders } = require('../src/server/live-providers');
const { readProviderConfig } = require('../src/server/live-config');
const { openPixabayCache } = require('../src/server/pixabay-cache');
const { ProviderError } = require('../src/server/https-provider');
const { commonsLicense } = require('../src/shared/live-media');
const { jpeg, samplePlace, sampleHit } = require('./live-fixtures.cjs');

const ramallah = {
  name: 'Ramallah',
  country: 'Palestine',
  latitude: 31.8969,
  longitude: 35.2017,
};
const lisbon = {
  name: 'Lisbon',
  country: 'Portugal',
  latitude: 38.72,
  longitude: -9.14,
};
const photo = (city = 'Lisbon') => ({
  title: 'File:' + city + ' city.jpg',
  ns: 6,
  imageinfo: [
    {
      mime: 'image/jpeg',
      mediatype: 'BITMAP',
      descriptionurl:
        'https://commons.wikimedia.org/wiki/File:' + city + '_city.jpg',
      thumburl:
        'https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e7/' +
        city +
        '_city.jpg/960px-' +
        city +
        '_city.jpg?utm_source=commons.wikimedia.org',
      thumbwidth: 640,
      thumbheight: 480,
      extmetadata: {
        ImageDescription: { value: city + ' skyline' },
        Artist: {
          value: '<a href="https://commons.wikimedia.org/">A &amp; B</a>',
        },
        LicenseShortName: { value: 'CC BY-SA 4.0' },
        LicenseUrl: {
          value: 'https://creativecommons.org/licenses/by-sa/4.0/',
        },
        AttributionRequired: { value: 'true' },
      },
    },
  ],
});
const article = (location = lisbon) => ({
  title: location.name,
  ns: 0,
  coordinates: [
    { lat: location.latitude, lon: location.longitude, globe: 'earth' },
  ],
  pageimage: location.name + '_city.jpg',
});
const pages = (...entries) => ({ query: { pages: entries } });

test('defaults live to Wikimedia with two required credentials and preserves explicit Pixabay mode', () => {
  const env = {
    TRAVEL_PROVIDER_MODE: 'live',
    GEONAMES_USERNAME: 'geo',
    WEATHERBIT_API_KEY: 'weather',
  };
  expect(readProviderConfig(env)).toMatchObject({
    mode: 'live',
    imageProvider: 'wikimedia',
  });
  expect(readProviderConfig(env)).not.toHaveProperty('pixabay');
  expect(() =>
    readProviderConfig({ ...env, TRAVEL_IMAGE_PROVIDER: 'pixabay' }),
  ).toThrow('PIXABAY_API_KEY');
  expect(
    readProviderConfig({
      ...env,
      TRAVEL_IMAGE_PROVIDER: 'pixabay',
      PIXABAY_API_KEY: 'photo',
    }).imageProvider,
  ).toBe('pixabay');
  expect(readProviderConfig({ TRAVEL_IMAGE_PROVIDER: 'pixabay' })).toEqual({
    mode: 'mock',
  });
});

test('identifies the city article and validates source, license and HTML attribution', async () => {
  const get = jest.fn(async (host) =>
    host === 'en.wikipedia.org' ? pages(article()) : pages(photo()),
  );
  const provider = createWikimediaImageProvider(get);
  const result = await provider.select(lisbon, new AbortController().signal);
  expect(result).toMatchObject({
    provider: 'wikimedia',
    creator: 'A & B',
    license: 'CC BY-SA 4.0',
    title: 'Lisbon city.jpg',
  });
  expect(result.asset).not.toContain('utm_');
  expect(get.mock.calls[0][1]).toMatchObject({
    pilicense: 'free',
    titles: 'Lisbon|Lisbon, Portugal|Lisbon (Portugal)',
  });
  expect(get).toHaveBeenCalledTimes(2);
});

test.each([
  { missing: true },
  { coordinates: [{ lat: 30, lon: 30 }] },
  { pageprops: { disambiguation: '' } },
  { title: 'Lisbon station' },
  { coordinates: { broken: true } },
])(
  'returns no photo for a missing, incorrect or ambiguous article (%o)',
  async (override) => {
    const get = jest.fn(async () => pages({ ...article(), ...override }));
    await expect(
      createWikimediaImageProvider(get).select(
        lisbon,
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  },
);

test('uses bounded Wikidata identity and skips an unrelated lead and unsuitable fallback', async () => {
  const match = {
    ...article(ramallah),
    coordinates: undefined,
    pageprops: { wikibase_item: 'Q158119' },
  };
  const portrait = photo('Ramallah');
  portrait.title = 'File:Ramallah portrait.jpg';
  const get = jest.fn(async (host, query) => {
    if (host === 'en.wikipedia.org') return pages(match);
    if (host === 'www.wikidata.org')
      return {
        claims: {
          P625: [
            {
              rank: 'normal',
              mainsnak: {
                datavalue: {
                  value: {
                    latitude: ramallah.latitude,
                    longitude: ramallah.longitude,
                    globe: 'http://www.wikidata.org/entity/Q2',
                  },
                },
              },
            },
          ],
        },
      };
    if (query.titles) return pages(photo('Nearby'));
    expect(query.gsrlimit).toBe(8);
    return pages(portrait, photo('Ramallah'));
  });
  await expect(
    createWikimediaImageProvider(get).select(
      ramallah,
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({ title: 'Ramallah city.jpg' });
  expect(get).toHaveBeenCalledTimes(4);
});

test('rejects unsupported sources, extra restrictions, absent credit and active HTML', () => {
  const bad = [
    'https://thumb.wikimedia.org.evil.invalid/wikipedia/commons/thumb/e/e7/X.jpg/960px-X.jpg',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/X.jpg/960px-X.jpg?bad=1',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/X.jpg/960px-Y.jpg',
  ];
  for (const value of bad) expect(assetUrl(value)).toBeNull();
  const mismatch = photo();
  mismatch.imageinfo[0].descriptionurl =
    'https://commons.wikimedia.org/wiki/File:Different.jpg';
  expect(selectPhoto(mismatch, lisbon)).toBeNull();
  const unsupported = photo();
  unsupported.imageinfo[0].extmetadata.Restrictions = { value: 'personality' };
  expect(selectPhoto(unsupported, lisbon)).toBeNull();
  for (const value of ['', '<script>author</script>', '&#x3c;img src=x>']) {
    const unsafe = photo();
    unsafe.imageinfo[0].extmetadata.Artist = { value };
    expect(selectPhoto(unsafe, lisbon)).toBeNull();
  }
  expect(
    commonsLicense(
      'CC BY-NC 4.0',
      'https://creativecommons.org/licenses/by-nc/4.0/',
    ),
  ).toBeNull();
  expect(
    commonsLicense(
      'Public domain',
      'https://creativecommons.org/publicdomain/mark/1.0/',
      'True',
    ),
  ).toBeNull();
  expect(
    commonsLicense(
      'CC0',
      'http://creativecommons.org/publicdomain/zero/1.0/deed.en',
    ),
  ).toMatchObject({ license: 'CC0' });
});

test('rate limits are not retried and cancellation reaches the Wikimedia lookup', async () => {
  const rate = jest.fn(async () => {
    throw new ProviderError('rate_limited');
  });
  const signal = new AbortController();
  await expect(
    createWikimediaImageProvider(rate).select(lisbon, signal.signal),
  ).rejects.toThrow('rate_limited');
  expect(rate).toHaveBeenCalledTimes(1);
  const wait = jest.fn(
    (_host, _query, source) =>
      new Promise((_, reject) =>
        source.addEventListener('abort', () => reject(source.reason), {
          once: true,
        }),
      ),
  );
  const lookup = createWikimediaImageProvider(wait).select(
    lisbon,
    signal.signal,
  );
  signal.abort();
  await expect(lookup).rejects.toMatchObject({ name: 'AbortError' });
});

test('Pixabay and Wikimedia retain distinct cached images for one city', async () => {
  const cache = openPixabayCache(':memory:');
  const get = jest.fn(async (url) => {
    if (url.hostname === 'secure.geonames.org')
      return Buffer.from(
        JSON.stringify({ totalResultsCount: 1, geonames: [samplePlace] }),
      );
    if (url.hostname === 'api.weatherbit.io') return Buffer.from('{"data":[]}');
    if (url.hostname === 'en.wikipedia.org')
      return Buffer.from(JSON.stringify(pages(article())));
    if (url.hostname === 'commons.wikimedia.org')
      return Buffer.from(JSON.stringify(pages(photo())));
    if (url.pathname === '/api/')
      return Buffer.from(JSON.stringify({ hits: [sampleHit] }));
    return jpeg;
  });
  const config = {
    geonames: 'geo',
    weatherbit: 'weather',
    pixabay: 'pix',
    forecastDays: 7,
  };
  const trip = { destination: 'Lisbon, Portugal', countdownDays: 0 };
  const signal = new AbortController().signal;
  try {
    const wiki = createLiveProviders(
      { ...config, imageProvider: 'wikimedia' },
      { cache, get },
    );
    const pix = createLiveProviders(
      { ...config, imageProvider: 'pixabay' },
      { cache, get },
    );
    const a = await wiki.trip(trip, signal);
    const b = await pix.trip(trip, signal);
    expect(a.photo.provider).toBe('wikimedia');
    expect(b.photo.source).toBe(sampleHit.pageURL);
    expect(a.image).not.toBe(b.image);
    expect((await wiki.trip(trip, signal)).image).toBe(a.image);
    expect(
      get.mock.calls.filter(([url]) => url.hostname === 'en.wikipedia.org'),
    ).toHaveLength(1);
  } finally {
    cache.close();
  }
});

test('canonicalizes country aliases so France sends FR and matches the returned city', async () => {
  const cache = openPixabayCache(':memory:');
  const get = jest.fn(async (url) => {
    if (url.hostname === 'secure.geonames.org') {
      expect(url.searchParams.get('country')).toBe('FR');
      return Buffer.from(
        JSON.stringify({
          totalResultsCount: 1,
          geonames: [
            {
              ...samplePlace,
              name: 'Paris',
              countryName: 'France',
              countryCode: 'FR',
              lat: 48.8567,
              lng: 2.3522,
            },
          ],
        }),
      );
    }
    if (url.hostname === 'api.weatherbit.io') return Buffer.from('{"data":[]}');
    return Buffer.from('{"query":{"pages":[]}}');
  });
  const provider = createLiveProviders(
    { geonames: 'geo', weatherbit: 'weather', forecastDays: 7 },
    { cache, get },
  );
  try {
    const trip = await provider.trip(
      { destination: 'Paris, France', countdownDays: 0 },
      new AbortController().signal,
    );
    expect(trip.location).toMatchObject({ name: 'Paris', country: 'France' });
    expect(trip.photo).toBeNull();
  } finally {
    provider.close();
  }
});
