import { test as base, chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { browserPath } from './browserPath';

// Ordinary Chromium is shared by the worker; each test still gets a fresh context.
// These pages prove UI behavior against simulated APIs, not extension integration.
export const test = base.extend<{ uiBoundary: void }>({
  browser: [async ({}, use) => {
    const browser = await chromium.launch({ executablePath: await browserPath() });
    try { await use(browser); } finally { await browser.close(); }
  }, { scope: 'worker' }],
  uiBoundary: [async ({ page, browser }, use, testInfo) => {
    testInfo.annotations.push({ type: 'test-layer', description: 'UI with simulated Chrome API; not extension integration' });
    testInfo.annotations.push({ type: 'browser-version', description: browser.version() });
    await page.route('https://justonehop.test/**', async route => {
      const file = new URL(route.request().url()).pathname.slice(1);
      if (['popup.html', 'popup.js', 'popup.css', 'help.html', 'help.js', 'help.css'].includes(file)) {
        await route.fulfill({ path: resolve('dist', file) });
      } else await route.abort();
    });
    await use();
  }, { auto: true }],
});
export { expect } from '@playwright/test';
