const express = require('express');
const path = require('node:path');
const { calendarDay, validateTrip } = require('../shared/trip');
const { lookupFixture } = require('./fixtures');
const {
  deadline,
  fetchTrip,
  overallTimeout,
  TripError,
} = require('./providers');

const { localPhotoPattern } = require('../shared/live-media');

function createApp({
  lookup = lookupFixture,
  clock = () => new Date(),
  live,
} = {}) {
  const app = express();
  const dist = path.resolve(__dirname, '../../dist');
  const parse = express.json({ limit: 4096, inflate: false });
  let activeTrips = 0;

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy':
        "default-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    if (req.hostname !== '127.0.0.1')
      return res.status(400).type('text').send('Invalid local host.');
    next();
  });

  app.post('/all-apis', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.is('application/json'))
      return res.status(415).json({ error: 'invalid_content_type' });
    const origin = req.get('origin');
    if (origin && origin !== 'http://' + req.get('host'))
      return res.status(403).json({ error: 'invalid_origin' });
    if (activeTrips >= 8)
      return res.status(429).json({ error: 'trip_capacity' });

    activeTrips++;
    const disconnected = new AbortController();
    const onClose = () => disconnected.abort();
    res.once('close', onClose);
    try {
      await new Promise((resolve, reject) => {
        parse(req, res, (error) => (error ? reject(error) : resolve()));
      });
      if (res.destroyed) return;
      const today = calendarDay(clock());
      const trip = validateTrip(req.body, today);
      if (!trip) return res.status(400).json({ error: 'invalid_trip' });

      const timeout = deadline(live ? live.timeout : overallTimeout);
      const signal = AbortSignal.any([timeout.signal, disconnected.signal]);
      try {
        const result = live
          ? await live.trip(trip, signal)
          : await fetchTrip(lookup, trip, today, signal);
        if (!res.destroyed) return res.json(result);
      } finally {
        timeout.dispose();
      }
    } catch (error) {
      if (res.destroyed) return;
      if (error instanceof TripError)
        return res.status(error.status).json({ error: error.code });
      if (error.status === 413)
        return res.status(413).json({ error: 'body_too_large' });
      if (error.status === 415)
        return res.status(415).json({ error: 'invalid_content_type' });
      if (error.status === 400)
        return res.status(400).json({ error: 'invalid_json' });
      return res.status(500).json({ error: 'trip_unavailable' });
    } finally {
      res.off('close', onClose);
      activeTrips--;
    }
  });

  app.get('/trip-mode', (req, res) =>
    res
      .set('Cache-Control', 'no-store')
      .json(
        live
          ? { mode: 'live', imageProvider: live.imageProvider }
          : { mode: 'mock' },
      ),
  );
  app.get('/trip-photo/:token', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!live || !localPhotoPattern.test(req.path)) return res.sendStatus(404);
    try {
      const photo = live.getPhoto(req.params.token);
      return photo
        ? res.type('jpeg').send(Buffer.from(photo))
        : res.sendStatus(404);
    } catch {
      return res.sendStatus(503);
    }
  });
  app.get('/', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  app.use(
    express.static(dist, { index: false, redirect: false, dotfiles: 'deny' }),
  );
  app.use((req, res) => res.status(404).type('text').send('Not found.'));
  return app;
}

module.exports = { createApp };
