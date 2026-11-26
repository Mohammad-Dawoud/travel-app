const { fork } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const path = require('node:path');

async function withDeadline(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Fixture server lifecycle timed out.')),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async () => {
  const child = fork(path.join(__dirname, 'local-server.cjs'));
  const exited = once(child, 'exit');
  try {
    const ready = once(child, 'message').then(([message]) => message.ready);
    const started = await withDeadline(
      Promise.race([ready, exited.then(() => false)]),
    );
    if (!started) throw new Error('Fixture server failed to start.');
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    throw error;
  }

  return async () => {
    if (child.connected) child.send('shutdown');
    try {
      const [code, signal] = await withDeadline(exited);
      if (code !== 0 || signal)
        throw new Error('Fixture server did not stop cleanly.');
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
    const check = net.createServer();
    check.listen(4176, '127.0.0.1');
    await once(check, 'listening');
    await new Promise((resolve, reject) =>
      check.close((error) => (error ? reject(error) : resolve())),
    );
    console.log('Fixture listener released port 4176.');
  };
};
