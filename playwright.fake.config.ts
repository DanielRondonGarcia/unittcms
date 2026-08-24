import { defineConfig, devices } from '@playwright/test';
import devConfig from './playwright.dev.config';

const databasePath = '/tmp/unittcms-automation-e2e.sqlite';

export default defineConfig({
  ...devConfig,
  reporter: 'line',
  fullyParallel: false,
  workers: 1,
  use: {
    ...devConfig.use,
    video: 'off',
    screenshot: 'off',
    trace: 'off',
  },
  projects: [
    {
      name: 'fake-chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
  webServer: [
    {
      command: 'cd backend && npm run build && npm run migrate && npm run start',
      env: {
        DATABASE_PATH: databasePath,
        SECRET_KEY: 'e2e-only-placeholder',
        FRONTEND_ORIGIN: 'http://localhost:8010',
      },
      url: 'http://localhost:8001',
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command:
        'cd frontend && npm run build && mkdir -p .next/standalone/.next && cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/public && PORT=8010 node .next/standalone/server.js',
      env: { NEXT_PUBLIC_BACKEND_ORIGIN: 'http://localhost:8001' },
      url: 'http://localhost:8010',
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
