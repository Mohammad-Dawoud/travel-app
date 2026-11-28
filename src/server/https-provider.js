const { Resolver } = require('node:dns/promises');
const { request } = require('node:https');
const { isIP } = require('node:net');
const { Writable } = require('node:stream');

class ProviderError extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind;
  }
}

function publicIPv4(ip) {
  if (isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split('.').map(Number);
  return (
    a > 0 &&
    a < 224 &&
    a !== 10 &&
    a !== 127 &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(
      a === 192 &&
      (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))
    ) &&
    !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) &&
    !(a === 203 && b === 0 && c === 113)
  );
}

async function resolvePublic(host, signal) {
  const resolver = new Resolver({ timeout: 1200, tries: 1 });
  const cancel = () => resolver.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    const addresses = await resolver.resolve4(host);
    signal.throwIfAborted();
    if (!addresses.length || addresses.some((ip) => !publicIPv4(ip)))
      throw new ProviderError('unavailable');
    return addresses[0];
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

function readHttps(url, address, { signal, cap, accept, open = request }) {
  return new Promise((resolve, reject) => {
    const upstream = open(
      url,
      {
        agent: false,
        family: 4,
        autoSelectFamily: false,
        signal,
        lookup: (_host, _options, callback) => callback(null, address, 4),
        headers: {
          Accept: accept,
          'Accept-Encoding': 'identity',
          'User-Agent':
            'TravelGuideApp/0.1 (local academic project; https://github.com/Mohammad-Dawoud/travel-app)',
        },
      },
      (response) => {
        const status = response.statusCode;
        if (status !== 200) {
          response.destroy();
          reject(
            new ProviderError(
              status === 429
                ? 'rate_limited'
                : [401, 403].includes(status)
                  ? 'authorization'
                  : 'unavailable',
            ),
          );
          return;
        }
        const type = String(response.headers['content-type'] ?? '')
          .split(';')[0]
          .trim()
          .toLowerCase();
        const encoding = response.headers['content-encoding'] ?? 'identity';
        const declared = Number(response.headers['content-length'] ?? 0);
        if (
          type !== accept ||
          encoding !== 'identity' ||
          !Number.isSafeInteger(declared) ||
          declared < 0 ||
          declared > cap
        ) {
          response.destroy();
          reject(new ProviderError('invalid'));
          return;
        }
        let length = 0;
        const chunks = [];
        const sink = new Writable({
          write(chunk, _encoding, callback) {
            length += chunk.length;
            if (length > cap) return callback(new ProviderError('invalid'));
            chunks.push(chunk);
            callback();
          },
        });
        void require('node:stream/promises')
          .pipeline(response, sink, { signal })
          .then(() => resolve(Buffer.concat(chunks, length)), reject);
      },
    );
    upstream.once('error', reject);
    upstream.end();
  });
}

async function providerGet(url, { hosts, signal, cap, accept }) {
  try {
    if (
      url.protocol !== 'https:' ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      !hosts.includes(url.hostname)
    ) {
      throw new ProviderError('invalid');
    }
    const address = await resolvePublic(url.hostname, signal);
    return await readHttps(url, address, { signal, cap, accept });
  } catch (error) {
    if (signal.aborted) signal.throwIfAborted();
    // Never forward transport errors, which can contain the upstream URL.
    throw error instanceof ProviderError
      ? error
      : new ProviderError('unavailable');
  }
}

module.exports = { providerGet, publicIPv4, ProviderError, readHttps };
