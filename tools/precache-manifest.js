const { createHash } = require('node:crypto');
const {
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} = require('node:fs');

const graphics = [
  'logo.svg',
  'hero.svg',
  'coast.svg',
  'hills.svg',
  'fallback.svg',
];
mkdirSync('dist/assets', { recursive: true });
for (const file of graphics)
  copyFileSync('src/client/graphics/' + file, 'dist/assets/' + file);
const files = [
  'index.html',
  'app.js',
  'app.css',
  ...graphics.map((file) => 'assets/' + file),
];
const manifest = files.map((file) => ({
  url: '/' + file,
  revision: createHash('sha256')
    .update(readFileSync('dist/' + file))
    .digest('hex'),
}));
mkdirSync('.local', { recursive: true });
writeFileSync('.local/precache-manifest.json', JSON.stringify(manifest));
