function readProviderConfig(env = process.env) {
  const mode = env.TRAVEL_PROVIDER_MODE || 'mock';
  if (mode === 'mock') return { mode };
  if (mode !== 'live')
    throw new Error('Set TRAVEL_PROVIDER_MODE to mock or live.');
  const names = ['GEONAMES_USERNAME', 'WEATHERBIT_API_KEY', 'PIXABAY_API_KEY'];
  const missing = names.filter(
    (name) => !/^[a-z0-9_.-]{1,128}$/i.test(env[name] ?? ''),
  );
  if (missing.length)
    throw new Error(
      'Live setup requires valid values in .local/live.env for ' +
        missing.join(', ') +
        '.',
    );
  const forecastDays = Number(env.WEATHERBIT_FORECAST_DAYS || '7');
  if (forecastDays !== 7 && forecastDays !== 16)
    throw new Error(
      'Set WEATHERBIT_FORECAST_DAYS to 7 or 16 according to your Weatherbit plan.',
    );
  return {
    mode,
    geonames: env.GEONAMES_USERNAME,
    weatherbit: env.WEATHERBIT_API_KEY,
    pixabay: env.PIXABAY_API_KEY,
    forecastDays,
  };
}

module.exports = { readProviderConfig };
