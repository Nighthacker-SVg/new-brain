import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testIgnore: process.env.ATTENDX_LOCAL_TESTS === '1'
    ? ['**/office.spec.ts', '**/live.spec.ts', '**/embedded-preview.spec.ts']
    : ['**/local-mode.spec.ts'],
  fullyParallel: true,
  workers: 2,
  retries: 0,
  timeout: 45_000,
  reporter: 'list',
  use: {
    baseURL: process.env.ATTENDX_BASE_URL || 'http://127.0.0.1:4175',
    viewport: { width: 1488, height: 1057 },
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.ATTENDX_CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },
  webServer: process.env.ATTENDX_BASE_URL ? undefined : {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4175 --strictPort',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
