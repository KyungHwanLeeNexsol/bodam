import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../tests/patient-kiosk',
  testMatch: 'responsive.browser.ts',
  fullyParallel: true,
  outputDir: '../dist-ssr/patient-kiosk-browser-results',
  webServer: {
    command: 'npm run build:patient-kiosk && python3 -m http.server 3419 --bind 127.0.0.1 --directory dist-ssr/patient-kiosk',
    cwd: '..',
    url: 'http://127.0.0.1:3419/',
    reuseExistingServer: false,
  },
  use: {
    baseURL: 'http://127.0.0.1:3419/',
    launchOptions: process.env.BODAM_BROWSER_PATH ? { executablePath: process.env.BODAM_BROWSER_PATH } : {},
  },
});
