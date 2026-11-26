const { calendarOffset } = require('../shared/trip');

const places = new Map([
  [
    'paris',
    {
      name: 'Paris',
      countryName: 'France',
      lat: 48.86,
      lng: 2.35,
      image: 'coast',
    },
  ],
  [
    'tokyo',
    {
      name: 'Tokyo',
      countryName: 'Japan',
      lat: 35.68,
      lng: 139.69,
      image: 'hills',
    },
  ],
  ['cairo', { name: 'Cairo', countryName: 'Egypt', lat: 30.04, lng: 31.24 }],
]);

// These responses are local, deterministic and synthetic.
async function lookupFixture(provider, parameters, { signal }) {
  signal.throwIfAborted();
  if (provider === 'geonames') {
    const place = places.get(parameters.get('q').toLowerCase());
    if (!place) return Response.json({ geonames: [] });
    const { name, countryName, lat, lng } = place;
    return Response.json({ geonames: [{ name, countryName, lat, lng }] });
  }
  if (provider === 'weatherbit') {
    const today = parameters.get('today');
    const entries = Array.from({ length: 16 }, (_, offset) => ({
      valid_date: calendarOffset(today, offset),
      temp: 18 + (offset % 5),
      weather: { description: offset % 2 ? 'Partly cloudy' : 'Clear' },
    }));
    return Response.json({
      data:
        parameters.get('mode') === 'near-term' ? entries.slice(0, 1) : entries,
    });
  }
  if (provider === 'pixabay') {
    const place = places.get(parameters.get('q').toLowerCase());
    return Response.json({ hits: place?.image ? [{ id: place.image }] : [] });
  }
  throw new Error('Unknown fixture adapter');
}

module.exports = { lookupFixture };
