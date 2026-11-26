import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

cleanupOutdatedCaches();
precacheAndRoute(PRECACHE_MANIFEST, {
  directoryIndex: 'index.html',
  cleanURLs: false,
  ignoreURLParametersMatching: [],
});
