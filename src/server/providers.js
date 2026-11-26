const { fallbackImage, placeImages } = require('../shared/images');
const providerLimit = 64 * 1024;
const providerTimeout = 1500;
const overallTimeout = 3000;

function deadline(milliseconds) {
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(new DOMException('Deadline elapsed', 'TimeoutError')),
    milliseconds,
  );
  return { signal: controller.signal, dispose: () => clearTimeout(timer) };
}

async function readProvider(response, signal) {
  if (
    !response.ok ||
    !response.body ||
    !/^application\/json(?:\s*;|$)/i.test(
      response.headers.get('content-type') ?? '',
    )
  ) {
    await response.body?.cancel();
    throw new Error('Provider returned unavailable data');
  }

  // Abort a pending read before releasing the stream lock.
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let json = '';
  try {
    signal.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > providerLimit)
        throw new Error('Provider response limit exceeded');
      json += decoder.decode(value, { stream: true });
    }
    return JSON.parse(json + decoder.decode());
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function readFixture(lookup, provider, query, outerSignal) {
  const timeout = deadline(providerTimeout);
  const signal = AbortSignal.any([outerSignal, timeout.signal]);
  try {
    signal.throwIfAborted();
    const response = await lookup(provider, new URLSearchParams(query), {
      signal,
    });
    return await readProvider(response, signal);
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  } finally {
    timeout.dispose();
  }
}

function isText(value) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    [...value].length <= 120
  );
}

function coordinate(value, limit) {
  if (
    typeof value !== 'number' &&
    !(typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value))
  )
    return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= limit ? parsed : null;
}

class TripError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function fetchTrip(lookup, trip, today, signal) {
  let places;
  try {
    const data = await readFixture(
      lookup,
      'geonames',
      { q: trip.destination, maxRows: '1' },
      signal,
    );
    places = data?.geonames;
  } catch (error) {
    if (error.name === 'TimeoutError')
      throw new TripError(504, 'location_timeout');
    throw new TripError(502, 'location_unavailable');
  }
  if (!Array.isArray(places) || places.length > 1)
    throw new TripError(502, 'location_unavailable');
  if (!places.length) throw new TripError(404, 'destination_not_found');
  const { name, countryName, lat, lng } = places[0] ?? {};
  const latitude = coordinate(lat, 90);
  const longitude = coordinate(lng, 180);
  if (
    !isText(name) ||
    !isText(countryName) ||
    latitude === null ||
    longitude === null
  ) {
    throw new TripError(502, 'location_unavailable');
  }

  const mode = trip.countdownDays <= 7 ? 'near-term' : 'forecast';
  const targetDate = mode === 'near-term' ? today : trip.departureDate;
  // Optional provider failures leave a valid location and trip intact.
  const [weatherResult, imageResult] = await Promise.allSettled([
    readFixture(
      lookup,
      'weatherbit',
      { lat: latitude, lon: longitude, today, mode },
      signal,
    ),
    readFixture(lookup, 'pixabay', { q: trip.destination }, signal),
  ]);
  const dates = weatherResult.value?.data;
  const entry =
    Array.isArray(dates) && dates.length <= 16
      ? dates.find((record) => record?.valid_date === targetDate)
      : null;
  const weather =
    entry &&
    Number.isFinite(entry.temp) &&
    entry.temp >= -100 &&
    entry.temp <= 70 &&
    isText(entry.weather?.description)
      ? {
          kind: mode,
          date: targetDate,
          temperatureC: entry.temp,
          description: entry.weather.description,
        }
      : null;
  const images = imageResult.value?.hits;
  const id = Array.isArray(images) && images.length <= 3 ? images[0]?.id : null;
  const image =
    typeof id === 'string' && Object.hasOwn(placeImages, id)
      ? placeImages[id]
      : fallbackImage;
  const warnings = [];
  if (!weather) warnings.push('weather_unavailable');
  if (image === fallbackImage) warnings.push('image_unavailable');

  return {
    ...trip,
    location: { name, country: countryName },
    weather,
    image,
    warnings,
    synthetic: true,
  };
}

module.exports = { deadline, fetchTrip, overallTimeout, TripError };
