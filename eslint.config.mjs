import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['.local/**', 'dist/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: [
      'src/shared/**/*.js',
      'src/server/**/*.js',
      'tools/**/*.js',
      '**/*.cjs',
    ],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    files: ['src/client/**/*.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.commonjs } },
  },
  {
    files: ['src/client/service-worker.js'],
    languageOptions: {
      globals: { ...globals.serviceworker, PRECACHE_MANIFEST: 'readonly' },
    },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.jest, ...globals.browser },
    },
  },
  {
    files: ['e2e/**/*.js', 'playwright.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
