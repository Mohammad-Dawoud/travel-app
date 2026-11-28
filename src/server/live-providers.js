const { fallbackImage } = require('../shared/images');
const { pixabaySource } = require('../shared/live-media');
const { deadline, TripError } = require('./providers');
const { openPixabayCache, photoLimit } = require('./pixabay-cache');
const { providerGet, ProviderError } = require('./https-provider');
const { validJpeg } = require('./jpeg');
const { createWikimediaImageProvider } = require('./wikimedia-provider');

const jsonTimeout = 3000;
const photoTimeout = 4000;
const liveDeadline = 10_000;
const wikimediaDeadline = 22_000;
const geonamesHost = 'secure.geonames.org';
const weatherbitHost = 'api.weatherbit.io';
const pixabayHost = 'pixabay.com';
const imageHosts = [pixabayHost, 'cdn.pixabay.com'];
const regionNames = new Intl.DisplayNames(['en'], {
  type: 'region',
  fallback: 'none',
});
const regionCodes = new Map();
for (const a of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
  for (const b of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const code = a + b;
    const name = regionNames.of(code);
    if (name && name !== code)
      regionCodes.set(fold(name), new Intl.Locale('und-' + code).region);
  }
}

function fold(value) {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/ +/g, ' ');
}

function boundedText(value, limit = 120) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    [...value].length <= limit &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

function point(value, limit) {
  if (
    typeof value !== 'number' &&
    !(typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value))
  )
    return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= limit ? parsed : null;
}

function httpsUrl(host, pathname, query) {
  const url = new URL(pathname, 'https://' + host);
  url.search = new URLSearchParams(query);
  return url;
}

function imageUrl(value) {
  if (typeof value !== 'string' || value.length > 300) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !imageHosts.includes(url.hostname)
    )
      return null;
    const path =
      url.hostname === pixabayHost
        ? /^\/get\/[a-z0-9_-]+_640\.jpg$/i
        : /^\/photo\/\d{4}\/\d{2}\/\d{2}\/\d{2}\/\d{2}\/[a-z0-9_-]+_640\.jpg$/i;
    return path.test(url.pathname) ? url : null;
  } catch {
    return null;
  }
}

async function limited(get, url, hosts, outer, image = false) {
  const timer = deadline(image ? photoTimeout : jsonTimeout);
  const signal = AbortSignal.any([outer, timer.signal]);
  try {
    signal.throwIfAborted();
    const cap = image ? photoLimit : 64 * 1024;
    const bytes = await get(url, {
      hosts,
      signal,
      cap,
      accept: image ? 'image/jpeg' : 'application/json',
    });
    signal.throwIfAborted();
    if (!Buffer.isBuffer(bytes) || bytes.length > cap)
      throw new ProviderError('invalid');
    if (image) return bytes;
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (signal.aborted) signal.throwIfAborted();
    throw error instanceof ProviderError ? error : new ProviderError('invalid');
  } finally {
    timer.dispose();
  }
}

function parsePlace(record) {
  const {
    name,
    countryName,
    countryCode,
    adminName1,
    lat,
    lng,
    geonameId,
    fcode,
  } = record ?? {};
  const latitude = point(lat, 90);
  const longitude = point(lng, 180);
  if (
    !boundedText(name, 80) ||
    !boundedText(countryName, 80) ||
    !/^[A-Z]{2}$/.test(countryCode ?? '') ||
    latitude === null ||
    longitude === null ||
    !Number.isSafeInteger(geonameId) ||
    geonameId < 1 ||
    !/^(?:PPL|PPLA[2-5]?|PPLC)$/.test(fcode ?? '')
  )
    return null;
  return {
    name,
    country: countryName,
    countryCode,
    region: boundedText(adminName1, 80) ? adminName1 : '',
    latitude,
    longitude,
    id: geonameId,
  };
}

async function findPlace(get, config, destination, signal) {
  const parts = destination.split(',').map((field) => field.trim());
  if (parts.length > 3 || parts.some((field) => !field))
    throw new TripError(400, 'invalid_trip');
  const [city] = parts;
  const qualifier = parts.length > 1 ? parts.at(-1) : '';
  const country = /^[a-z]{2}$/i.test(qualifier)
    ? new Intl.Locale('und-' + qualifier.toUpperCase()).region
    : (regionCodes.get(fold(qualifier)) ?? '');
  const query = {
    name_equals: city,
    featureClass: 'P',
    maxRows: '10',
    style: 'MEDIUM',
    lang: 'en',
    username: config.geonames,
    ...(country ? { country } : {}),
  };

  let data;
  try {
    data = await limited(
      get,
      httpsUrl(geonamesHost, '/searchJSON', query),
      [geonamesHost],
      signal,
    );
  } catch (error) {
    if (error.name === 'TimeoutError')
      throw new TripError(504, 'location_timeout');
    if (error.kind === 'authorization')
      throw new TripError(502, 'location_authorization');
    if (error.kind === 'rate_limited')
      throw new TripError(503, 'location_rate_limited');
    throw new TripError(502, 'location_unavailable');
  }
  const code = data?.status?.value;
  if (code === 10) throw new TripError(502, 'location_authorization');
  if ([18, 19, 20].includes(code))
    throw new TripError(503, 'location_rate_limited');
  if (code === 13) throw new TripError(504, 'location_timeout');
  if (
    !Array.isArray(data?.geonames) ||
    data.geonames.length > 10 ||
    !Number.isSafeInteger(data.totalResultsCount)
  ) {
    throw new TripError(502, 'location_unavailable');
  }
  if (
    data.totalResultsCount < data.geonames.length ||
    (data.totalResultsCount > 0 && !data.geonames.length)
  )
    throw new TripError(502, 'location_unavailable');
  const matches = new Map();
  for (const candidate of data.geonames) {
    const match = parsePlace(candidate);
    if (
      !match ||
      ![candidate.name, candidate.toponymName].some(
        (name) => boundedText(name, 80) && fold(name) === fold(city),
      )
    )
      continue;
    if (
      qualifier &&
      (country
        ? match.countryCode !== country
        : fold(match.country) !== fold(qualifier))
    )
      continue;
    if (parts.length === 3 && fold(match.region) !== fold(parts[1])) continue;
    matches.set(match.id, match);
  }
  if (matches.size > 1 || data.totalResultsCount > 10)
    throw new TripError(409, 'destination_ambiguous');
  if (!matches.size) {
    if (data.geonames.length && !data.geonames.some(parsePlace))
      throw new TripError(502, 'location_unavailable');
    throw new TripError(404, 'destination_not_found');
  }
  const {
    name,
    country: countryName,
    latitude,
    longitude,
  } = matches.values().next().value;
  return { name, country: countryName, latitude, longitude };
}

function weatherDetails(entry, kind, date) {
  if (
    !entry ||
    !Number.isFinite(entry.temp) ||
    entry.temp < -100 ||
    entry.temp > 70 ||
    !boundedText(entry.weather?.description)
  )
    return null;
  return {
    kind,
    date,
    temperatureC: entry.temp,
    description: entry.weather.description,
  };
}

function observationTime(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)
  )
    return null;
  const timestamp = value.replace(' ', 'T') + ':00Z';
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().startsWith(timestamp.slice(0, 16))
    ? value + ' UTC'
    : null;
}

function selectPhoto(data, location) {
  if (!Array.isArray(data?.hits) || data.hits.length > 5)
    throw new ProviderError('invalid');
  const city = fold(location.name);
  for (const hit of data.hits) {
    if (
      !hit ||
      hit.type !== 'photo' ||
      !boundedText(hit.tags, 300) ||
      !boundedText(hit.user, 80)
    )
      continue;
    const tags = hit.tags.split(',').map(fold);
    if (
      !tags.includes(city) &&
      !tags.includes(city + ' ' + fold(location.country))
    )
      continue;
    const source = pixabaySource(hit.pageURL);
    const asset = imageUrl(hit.webformatURL);
    if (source && asset)
      return { source, asset: asset.href, creator: hit.user };
  }
  return null;
}

function createPixabayImageProvider(get, config) {
  return {
    name: 'pixabay',
    imageHosts,
    assetUrl: imageUrl,
    maxSide: 640,
    async select(location, signal) {
      const query = location.name + ' ' + location.country;
      if ([...query].length > 100) return null;
      const params = {
        key: config.pixabay,
        q: query,
        image_type: 'photo',
        orientation: 'horizontal',
        safesearch: 'true',
        order: 'popular',
        per_page: '5',
      };
      const data = await limited(
        get,
        httpsUrl(pixabayHost, '/api/', params),
        [pixabayHost],
        signal,
      );
      return selectPhoto(data, location);
    },
    attribution: ({ source, creator }) =>
      pixabaySource(source) && boundedText(creator, 80)
        ? { source, creator }
        : null,
  };
}

function createLiveProviders(
  config,
  { get = providerGet, cache = openPixabayCache(), now = Date.now } = {},
) {
  let lastWeather = -Infinity;
  const working = new Set();
  const secrets = [config.geonames, config.weatherbit, config.pixabay].filter(
    Boolean,
  );
  const media =
    config.imageProvider === 'pixabay'
      ? createPixabayImageProvider(get, config)
      : createWikimediaImageProvider((host, parameters, signal) =>
          limited(
            get,
            httpsUrl(host, '/w/api.php', parameters),
            [host],
            signal,
          ),
        );
  const safe = (...fields) =>
    fields.every((field) =>
      secrets.every((secret) =>
        secret.length >= 8 ? !field.includes(secret) : field !== secret,
      ),
    );

  async function weather(location, trip, signal) {
    const current = trip.countdownDays === 0;
    if (!current && trip.countdownDays >= config.forecastDays)
      return { warning: 'weather_outside_window' };
    if (now() - lastWeather < 1000) return { warning: 'weather_rate_limited' };
    lastWeather = now();
    const query = {
      lat: location.latitude,
      lon: location.longitude,
      key: config.weatherbit,
      units: 'M',
      ...(current ? {} : { days: config.forecastDays }),
    };
    try {
      const resource = current ? '/v2.0/current' : '/v2.0/forecast/daily';
      const payload = await limited(
        get,
        httpsUrl(weatherbitHost, resource, query),
        [weatherbitHost],
        signal,
      );
      const entries = payload?.data;
      if (
        !Array.isArray(entries) ||
        entries.length > (current ? 1 : config.forecastDays)
      )
        return { warning: 'weather_unavailable' };
      const entry = current
        ? entries[0]
        : entries.find((item) => item?.valid_date === trip.departureDate);
      if (!current && !entry) return { warning: 'weather_outside_window' };
      const date = current
        ? observationTime(entry?.ob_time)
        : trip.departureDate;
      const value =
        date &&
        weatherDetails(entry, current ? 'current' : 'live-forecast', date);
      return value && safe(value.description)
        ? { value }
        : { warning: 'weather_unavailable' };
    } catch (error) {
      const warnings = {
        authorization: 'weather_not_entitled',
        rate_limited: 'weather_rate_limited',
      };
      return { warning: warnings[error.kind] ?? 'weather_unavailable' };
    }
  }

  async function photo(location, signal) {
    const previousKey = fold(location.name + ' ' + location.country);
    // Coordinates separate same-named places. Pixabay retains its pre-existing city/country quota key.
    const key =
      media.name +
      ':' +
      previousKey +
      (media.name === 'wikimedia'
        ? ':' +
          location.latitude.toFixed(3) +
          ',' +
          location.longitude.toFixed(3)
        : '');
    if (working.has(key) || (media.name === 'wikimedia' && working.size > 0))
      return null;
    working.add(key);
    try {
      let cacheKey = key;
      let saved = cache.lookup(cacheKey);
      if (!saved && media.name === 'pixabay') {
        // Existing, unprefixed records predate Wikimedia and can only belong to Pixabay.
        saved = cache.lookup(previousKey);
        if (saved) cacheKey = previousKey;
      }
      if (!saved) {
        if (!cache.hasRoom(working.size - 1)) return null;
        const candidate = await media.select(location, signal);
        signal.throwIfAborted();
        cache.save(
          cacheKey,
          candidate && safe(...Object.values(candidate)) ? candidate : null,
        );
        saved = cache.lookup(cacheKey);
      }
      if (!saved?.hit || !safe(...Object.values(saved.hit))) return null;
      const url = media.assetUrl(saved.hit.asset);
      const attribution = media.attribution(saved.hit);
      if (!url || !attribution) return null;
      let token = saved.token;
      if (!token) {
        const bytes = await limited(get, url, media.imageHosts, signal, true);
        if (!validJpeg(bytes, media.maxSide)) return null;
        token = cache.savePhoto(cacheKey, bytes);
      }
      return token
        ? { image: '/trip-photo/' + token, photo: attribution }
        : null;
    } catch {
      return null;
    } finally {
      working.delete(key);
    }
  }

  return {
    imageProvider: media.name,
    timeout: media.name === 'wikimedia' ? wikimediaDeadline : liveDeadline,
    async trip(trip, signal) {
      const location = await findPlace(get, config, trip.destination, signal);
      if (!safe(location.name, location.country))
        throw new TripError(502, 'location_unavailable');
      const [conditions, picture] = await Promise.all([
        weather(location, trip, signal),
        photo(location, signal),
      ]);
      return {
        ...trip,
        location,
        weather: conditions.value ?? null,
        image: picture?.image ?? fallbackImage,
        photo: picture?.photo ?? null,
        synthetic: false,
        warnings: [
          conditions.warning,
          picture ? null : 'image_unavailable',
        ].filter(Boolean),
      };
    },
    getPhoto: (token) => cache.getPhoto(token),
    close: () => cache.close(),
  };
}

module.exports = {
  createLiveProviders,
  imageUrl,
  liveDeadline,
  jsonTimeout,
  photoTimeout,
};
