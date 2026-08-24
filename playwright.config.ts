import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Builds the static site, then boots the Express server that serves dist/
    // and exposes POST /api/book (server/index.js, Task 9).
    command: 'npm run build && node server/index.js',
    url: `${BASE_URL}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
