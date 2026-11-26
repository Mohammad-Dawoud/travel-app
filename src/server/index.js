const { createServer } = require('node:http');
const { createApp } = require('./app');

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

if (require.main === module) {
  const port = Number(process.env.TRAVEL_PORT ?? 4175);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid local port.');
  if (
    process.env.TRAVEL_PROVIDER_MODE &&
    process.env.TRAVEL_PROVIDER_MODE !== 'mock'
  ) {
    throw new Error('This demo uses local fixture providers.');
  }
  const server = start({ port });
  server.once('error', (error) => {
    console.error(
      'Could not start the local demo:',
      error.code ?? 'listen failure',
    );
    process.exitCode = 1;
  });
  server.once('listening', () =>
    console.log('Travel App demo: http://127.0.0.1:' + server.address().port),
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

module.exports = { start, stop };
