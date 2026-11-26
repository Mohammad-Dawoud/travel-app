const { createServer } = require('node:http');
const { createApp } = require('./app');
const { readProviderConfig } = require('./live-config');

function start({ port = 4175, app = createApp() } = {}) {
  const server = createServer(
    { requestTimeout: 5000, headersTimeout: 5000 },
    app,
  );
  server.listen(port, '127.0.0.1');
  return server;
}

function stop(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function main() {
  const port = Number(process.env.TRAVEL_PORT ?? 4175);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid local port.');
  const config = readProviderConfig();
  let live;
  if (config.mode === 'live') {
    try {
      const { createLiveProviders } = require('./live-providers');
      live = createLiveProviders(config);
    } catch {
      throw new Error(
        'Could not open the local Pixabay cache. Check .local permissions and use the approved Node.js runtime.',
      );
    }
  }
  const server = start({ port, app: createApp({ live }) });
  const closeCache = () => {
    if (live) {
      live.close();
      live = undefined;
    }
  };
  server.once('close', closeCache);
  server.once('error', closeCache);
  server.once('error', (error) => {
    console.error(
      'Could not start the local demo:',
      error.code ?? 'listen failure',
    );
    process.exitCode = 1;
  });
  server.once('listening', () =>
    console.log(
      'Travel App (' +
        config.mode +
        '): http://127.0.0.1:' +
        server.address().port,
    ),
  );
  let stopping = false;
  function shutdown() {
    if (stopping) return;
    stopping = true;
    void stop(server).then(
      () => {
        console.log('Travel App stopped.');
        if (process.connected) process.disconnect();
      },
      () => {
        process.exitCode = 1;
        if (process.connected) process.disconnect();
      },
    );
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  if (process.connected)
    process.on('message', (message) => {
      if (message === 'shutdown') shutdown();
    });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { start, stop };
