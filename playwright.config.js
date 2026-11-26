const { defineConfig } = require('@playwright/test');

const port = 4176;
module.exports = defineConfig({
  testDir: './e2e',
  outputDir: '.local/playwright-results',
  reporter: 'list',
  timeout: 20_000,
  workers: 1,
  globalSetup: './e2e/global-setup.cjs',
  use: {
    baseURL: 'http://127.0.0.1:' + port,
    browserName: 'chromium',
    launchOptions: {
      args: [
        '--disable-background-networking',
        '--disable-sync',
        '--no-proxy-server',
        '--host-resolver-rules=MAP * ~NOTFOUND,EXCLUDE 127.0.0.1',
      ],
    },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: 'mobile',
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
