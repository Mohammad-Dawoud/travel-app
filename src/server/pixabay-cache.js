const { DatabaseSync } = require('node:sqlite');
const { randomBytes } = require('node:crypto');
const { mkdirSync, lstatSync } = require('node:fs');
const path = require('node:path');

const ttl = 24 * 60 * 60 * 1000;
const maxEntries = 12;
const photoLimit = 2 * 1024 * 1024;

function openPixabayCache(
  filename = path.resolve('.local/pixabay-cache.sqlite'),
  now = Date.now,
) {
  if (filename !== ':memory:') {
    const directory = path.dirname(filename);
    mkdirSync(directory, { recursive: true });
    const base = lstatSync(directory);
    const existing = lstatSync(filename, { throwIfNoEntry: false });
    if (
      !base.isDirectory() ||
      base.isSymbolicLink() ||
      (existing && !existing.isFile())
    )
      throw new Error('Invalid local photo cache path.');
  }
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA page_size=4096;
    PRAGMA busy_timeout=200;
    PRAGMA journal_mode=DELETE;
    PRAGMA secure_delete=ON;
    PRAGMA max_page_count=8192;
    CREATE TABLE IF NOT EXISTS entries (
      lookup TEXT PRIMARY KEY,
      expires INTEGER NOT NULL,
      hit TEXT NOT NULL CHECK(length(hit) <= 2048),
      photo BLOB CHECK(length(photo) <= 2097152),
      token TEXT UNIQUE
    ) STRICT;
  `);
  if (
    db.prepare('PRAGMA page_size').get().page_size !== 4096 ||
    db.prepare('PRAGMA max_page_count').get().max_page_count !== 8192
  ) {
    db.close();
    throw new Error('Invalid local photo cache size settings.');
  }
  const purge = db.prepare('DELETE FROM entries WHERE expires <= ?');
  const count = db.prepare('SELECT count(*) AS size FROM entries');
  const find = db.prepare(
    'SELECT hit, token FROM entries WHERE lookup=? AND expires>?',
  );
  const save = db.prepare(
    'INSERT OR IGNORE INTO entries (lookup, expires, hit) SELECT ?, ?, ? WHERE (SELECT count(*) FROM entries) < 12',
  );
  const store = db.prepare(
    'UPDATE entries SET photo=?, token=? WHERE lookup=? AND expires>? AND token IS NULL',
  );
  const get = db.prepare(
    'SELECT photo FROM entries WHERE token=? AND expires>?',
  );
  function cleanup() {
    purge.run(now());
  }
  cleanup();

  return {
    lookup(key) {
      cleanup();
      const row = find.get(key, now());
      return row ? { hit: JSON.parse(row.hit), token: row.token } : null;
    },
    hasRoom(reserved = 0) {
      cleanup();
      return count.get().size + reserved < maxEntries;
    },
    save(key, hit) {
      const at = now();
      purge.run(at);
      save.run(key, at + ttl, JSON.stringify(hit));
    },
    savePhoto(key, bytes) {
      if (!bytes.length || bytes.length > photoLimit) return null;
      const token = randomBytes(16).toString('hex');
      store.run(bytes, token, key, now());
      return find.get(key, now())?.token ?? null;
    },
    getPhoto(token) {
      cleanup();
      return get.get(token, now())?.photo ?? null;
    },
    close: () => db.close(),
  };
}

module.exports = { openPixabayCache, photoLimit, ttl, maxEntries };
