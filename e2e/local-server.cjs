const net = require('node:net');
const { createApp } = require('../src/server/app');
const { lookupFixture } = require('../src/server/fixtures');
const { start, stop } = require('../src/server');

let outboundAttempts = 0;
function denyOutbound() {
  outboundAttempts++;
  console.error('Unexpected outbound request from the test application.');
  throw new Error('Test server outbound networking is disabled.');
}
net.Socket.prototype.connect = denyOutbound;
globalThis.fetch = denyOutbound;

function lookup(provider, params, options) {
  if (provider === 'geonames' && params.get('q') === 'Markup Bay') {
    return Response.json({
      geonames: [
        {
          name: '<strong>Harbor</strong>',
          countryName: 'Fixture Land',
          lat: 1,
          lng: 2,
        },
      ],
    });
  }
  if (provider === 'weatherbit' && params.get('lat') === '1') {
    return Response.json({
      data: [
        {
          valid_date: params.get('today'),
          temp: 19,
          weather: { description: '<em>Cloudy</em>' },
        },
      ],
    });
  }
  if (provider === 'pixabay' && params.get('q') === 'Markup Bay') {
    return Response.json({
      hits: [
        { id: 'unknown', webformatURL: 'https://example.invalid/image.svg' },
      ],
    });
  }
  return lookupFixture(provider, params, options);
}

const server = start({
  port: 4176,
  app: createApp({ lookup, clock: () => new Date('2026-01-30T12:00:00Z') }),
});
server.once('listening', () => process.send?.({ ready: true }));
let stopped = false;
function shutdown() {
  if (stopped) return;
  stopped = true;
  void stop(server).then(() => {
    console.log(
      'Fixture server stopped. Outbound attempts: ' + outboundAttempts,
    );
    process.exitCode = outboundAttempts ? 1 : 0;
    if (process.connected) process.disconnect();
  });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

process.on('message', (message) => {
  if (message === 'shutdown') shutdown();
});
