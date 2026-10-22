import { expect } from '@playwright/test';
import { resolve, join } from 'node:path';
import type { UsageRecord } from '../src/usage';
import { test, defaults, origin, context, ui, worker } from './support/paletteFixture';
import { openStorageOverlay } from './support/paletteHelpers';
import { registerPaletteFixture } from './support/paletteFixture';

registerPaletteFixture();

test.describe(() => {
  const language: string = 'English';
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test(`${language} storage list copies exact values, details, names and restores navigation`, { tag: '@clipboard' }, async () => {
  const chinese = language === 'Chinese';
  const page = await context.newPage(); await page.goto(`${origin}/Storage-fixture`);
  const raw = '{"message":"你好\\nworld","enabled":true}';
  await page.evaluate(value => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('app.config', value);
    localStorage.setItem('empty', '');
    localStorage.setItem('markup', '<img src=x onerror=alert(1)>');
    sessionStorage.setItem('session-only', 'session-value');
  }, raw);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const surface = await openStorageOverlay(page);
  const rootInput = surface.locator('.search-bar input');
  await rootInput.fill('local storage'); await rootInput.press('Enter');
  const input = surface.locator('.storage-search input');
  await expect(surface.locator('.storage-row')).toHaveCount(3);
  await expect(surface.locator('.storage-preview .preview-code')).toHaveValue(JSON.stringify(JSON.parse(raw), null, 2));
  await expect(surface.locator('.storage-row').first()).not.toContainText(raw);
  await expect(input).toBeFocused();
  await input.press('Control+n');
  await expect(surface.locator('.storage-row[aria-selected="true"]')).toContainText('empty');
  await input.press('Enter');
  await expect(surface.locator('.operation-feedback')).toContainText(chinese ? '已复制值' : 'Value copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('');
  await input.press('Control+p');
  await input.fill('config');
  await expect(surface.locator('.operation-feedback')).toContainText(chinese ? '已复制值' : 'Value copied');
  await expect(surface.locator('.storage-row mark')).toHaveText('config');
  await input.press('Enter');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(raw);
  await expect(input).toBeFocused();
  await input.press('Meta+k');
  const actionInput = surface.locator('.action-search input');
  await actionInput.press('Control+n');
  await expect(surface.locator('.action-row[aria-selected="true"]')).toContainText(chinese ? '复制名称' : 'Copy Name');
  await actionInput.press('Enter');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('app.config');
  await expect(input).toHaveValue('config');
  await input.press('Meta+k'); await actionInput.fill('details'); await actionInput.press('Enter');
  await expect(surface.locator('.storage-value')).toHaveText(JSON.stringify(JSON.parse(raw), null, 2));
  await expect(surface.locator('.storage-detail')).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(raw);
  await surface.locator('.palette').screenshot({ path: test.info().outputPath(`storage-detail-${language}.png`) });
  await page.keyboard.press('Escape');
  await expect(input).toHaveValue('config'); await expect(input).toBeFocused();
  // The task header returns from details one layer at a time, like Escape.
  await input.press('Meta+k'); await actionInput.fill('details'); await actionInput.press('Enter');
  await expect(surface.locator('.storage-detail')).toBeFocused();
  await surface.locator('.task-back').click();
  await expect(input).toHaveValue('config'); await expect(input).toBeFocused();
  await input.fill('markup'); await input.press('Enter');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('<img src=x onerror=alert(1)>');
  await expect(surface.locator('.storage-row img')).toHaveCount(0);
  await input.fill('absent'); await expect(surface.locator('.empty')).toContainText(chinese ? '没有找到' : 'No results found');
  await input.fill('');
  await page.emulateMedia({ colorScheme: 'dark' });
  await surface.locator('.palette').screenshot({ path: test.info().outputPath(`storage-dark-${language}.png`) });
  await page.emulateMedia({ colorScheme: 'light' });
  await surface.locator('.palette').screenshot({ path: test.info().outputPath(`storage-light-${language}.png`) });
  await page.setViewportSize({ width: 390, height: 600 });

  expect(await surface.locator('.footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await surface.locator('.palette').screenshot({ path: test.info().outputPath(`storage-narrow-${language}.png`) });
  await input.press('Escape');
  await expect(rootInput).toHaveValue('local storage'); await expect(rootInput).toBeFocused();
  // Preserve the source page as Chrome's active tab for the next root command.
  await worker.evaluate(async url => { const [tab] = await chrome.tabs.query({ url }); await chrome.tabs.update(tab.id!, { active: true }); }, page.url());
  await rootInput.fill('session storage');
  await expect(surface.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
  await expect(surface.locator('[id="justonehop-command:sessionStorage"]')).toHaveAttribute('aria-selected', 'true');
  await rootInput.press('Enter');
  await expect(surface.locator('.storage-row')).toHaveCount(1);
  await expect(surface.locator('.storage-row')).toContainText('session-only');
  await input.press('Enter'); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('session-value');
  const saved = await worker.evaluate(() => chrome.storage.local.get(null));
  expect(JSON.stringify(saved)).not.toContain('app.config');
  expect(JSON.stringify(saved)).not.toContain('session-value');
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test('English storage cookies expose HttpOnly and same-name paths, refresh, empty and changed-page errors', { tag: '@clipboard' }, async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Storage/nested`);
  await context.addCookies([
    { name: 'token', value: 'root-token', url: origin, httpOnly: true },
    { name: 'token', value: 'path-token', domain: '127.0.0.1', path: '/Storage' },
    { name: 'outside', value: 'outside', domain: '127.0.0.1', path: '/Other' },
  ]);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const surface = await openStorageOverlay(page); await surface.locator('.search-bar input').fill('cookie'); await page.keyboard.press('Enter');
  await expect(surface.locator('.storage-row')).toHaveCount(2);
  await expect(surface.locator('.storage-cookie-scope')).toContainText(['/', '/Storage']);
  await expect(surface.locator('.storage-preview .preview-code')).toHaveValue('root-token');
  await expect(surface.locator('.storage-preview .preview-info')).toContainText('true / false');
  await page.setViewportSize({ width: 390, height: 440 });
  await expect(surface.locator('.storage-preview .preview-code')).toBeInViewport({ ratio: 1 });
  const info = surface.locator('.storage-preview .preview-info');
  await info.focus(); await info.press('End');
  expect(await info.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('storage-cookie-preview-narrow.png') });
  await surface.locator('.storage-search input').focus();
  await page.keyboard.press('Enter'); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('root-token');
  await page.keyboard.press('Meta+k'); await surface.locator('.action-search input').fill('details'); await page.keyboard.press('Enter');
  await expect(surface.locator('.cookie-metadata')).toContainText('true / false');
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('storage-cookie-detail.png') });
  await page.keyboard.press('Escape');
  await context.clearCookies();
  await page.keyboard.press('Meta+k'); await surface.locator('.action-search input').fill('refresh'); await page.keyboard.press('Enter');
  await expect(surface.locator('.empty')).toContainText('No entries');
  await page.evaluate(() => history.pushState({}, '', '/Changed'));
  await page.keyboard.press('Meta+k'); await surface.locator('.action-search input').fill('refresh'); await page.keyboard.press('Enter');
  await expect(surface.locator('.palette-footer [role="alert"]')).toContainText('The page changed');
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test('English storage restricted pages show a recoverable explanation', async () => {
  await ui.locator('.search-bar input').fill('local storage'); await ui.keyboard.press('Enter');
  await expect(ui.locator('.storage-error')).toContainText('HTTP or HTTPS');
  await ui.keyboard.press('Enter');
  await expect(ui.locator('.storage-error')).toContainText('HTTP or HTTPS');
  await ui.keyboard.press('Escape');
  await expect(ui.locator('.search-bar input')).toBeFocused();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test('English storage long values scroll, refresh preserves query, and session storage stays with the source tab', { tag: '@clipboard' }, async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Storage-long`);
  const raw = Array.from({ length: 2000 }, (_, i) => `line ${i}: 你好 ☀`).join('\n');
  await page.evaluate(value => { localStorage.setItem('long.value', value); sessionStorage.setItem('source', 'source-session'); }, raw);
  const other = await context.newPage(); await other.goto(`${origin}/Storage-other`);
  await other.evaluate(() => sessionStorage.setItem('other', 'other-session'));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const surface = await openStorageOverlay(page);
  const rootInput = surface.locator('.search-bar input');
  await rootInput.fill('local storage'); await rootInput.press('Enter');
  const input = surface.locator('.storage-search input');
  await expect(surface.locator('.storage-row')).toContainText('long.value');
  await input.fill('long'); await input.press('Enter');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(raw);
  await input.press('Meta+k'); await surface.locator('.action-search input').fill('details'); await page.keyboard.press('Enter');
  await expect(surface.locator('.storage-detail')).toBeFocused();
  await page.keyboard.press('Control+n');
  expect(await surface.locator('.storage-detail').evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Meta+ArrowDown');
  expect(await surface.locator('.storage-detail').evaluate(node => node.scrollTop + node.clientHeight >= node.scrollHeight - 1)).toBe(true);
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.setItem('long.value', 'updated-value'));
  await input.press('Meta+k'); await surface.locator('.action-search input').fill('refresh'); await page.keyboard.press('Enter');
  await expect(input).toHaveValue('long');
  await expect(surface.locator('.storage-preview .preview-code')).toHaveValue('updated-value');
  await expect(input).toBeFocused();
  await input.press('Enter'); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('updated-value');
  await input.press('Escape'); await rootInput.fill('session storage'); await rootInput.press('Enter');
  await expect(surface.locator('.storage-row')).toHaveCount(1);
  await expect(surface.locator('.storage-preview .preview-code')).toHaveValue('source-session');
  await input.press('Enter'); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('source-session');
  await input.press('Escape'); await rootInput.press('Escape');
  await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
});
});

for (const vimium of [false, true]) test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, vimium } });
  test(`English closed storage overlay preserves ${vimium ? 'Vimium' : 'production'} keyboard isolation through every layer`, { tag: '@clipboard' }, async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Closed-storage`);
  await page.evaluate(() => { localStorage.setItem('config', '{"native":true}'); localStorage.setItem('empty', ''); });
  await context.grantPermissions(['clipboard-read']);
  await page.bringToFront();
  const id = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, page.url());
  await worker.evaluate(async tabId => {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, { source: 'justonehop', type: 'toggle' });
  }, id);
  const cdp = await context.newCDPSession(page);
  const ax = async () => {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
    return (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes;
  };
  const combo = async () => (await ax()).find(node => node.role?.value === 'combobox');
  await expect.poll(async () => (await combo())?.name?.value).toBe('Search commands, tabs, bookmarks, and history');
  await page.keyboard.type('local storage');
  await expect.poll(async () => (await combo())?.value?.value).toBe('local storage');
  // Input stays available while the snapshot/history results are still loading.
  await expect.poll(async () => {
    const nodes = await ax();
    return nodes.some(node => node.role?.value === 'listbox' && !node.properties?.some(property => property.name === 'busy' && property.value?.value === true))
      && nodes.some(node => node.role?.value === 'option' && node.name?.value?.includes('View Local Storage')
        && node.properties?.some(property => property.name === 'selected' && property.value?.value === true));
  }).toBe(true);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await combo())?.name?.value).toBe('Search storage keys');
  await expect.poll(async () => (await ax()).filter(node => node.role?.value === 'option').length).toBe(2);
  const selectedName = async () => (await ax()).find(node => node.role?.value === 'option' && node.properties?.some(property => property.name === 'selected' && property.value?.value === true))?.name?.value;
  await page.keyboard.press('Control+n');
  await expect.poll(selectedName).toContain('empty');
  await page.keyboard.press('Control+p');
  await expect.poll(selectedName).toContain('config');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('{"native":true}');
  await page.keyboard.press('Meta+k');
  await expect.poll(async () => (await combo())?.name?.value).toBe('Search actions');
  await page.keyboard.type('details'); await page.keyboard.press('Enter');
  await expect.poll(async () => (await ax()).some(node => node.name?.value === 'JSON preview · copies original value')).toBe(true);
  await page.keyboard.press('Meta+k'); await page.keyboard.press('Escape');
  await expect.poll(async () => (await ax()).some(node => node.name?.value === 'JSON preview · copies original value')).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await combo())?.name?.value).toBe('Search storage keys');
  await page.setViewportSize({ width: 390, height: 600 });
  await page.screenshot({ path: test.info().outputPath('storage-closed-vimium.png') });
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await combo())?.name?.value).toBe('Search commands, tabs, bookmarks, and history');
  await expect.poll(async () => (await combo())?.value?.value).toBe('local storage');
  await page.keyboard.press('Escape');
  await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English cookie authorization handles missing grants, denial, navigation and exact website requests', async () => {
  const source = await context.newPage(); await source.goto(`${origin}/Cookie-permission`);
  const target = await worker.evaluate(async url => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
    return { tabId: tab.id!, windowId: tab.windowId, expectedUrl: url };
  }, source.url());
  const denied = await ui.evaluate(payload => chrome.runtime.sendMessage({ source: 'justonehop', type: 'read-page-storage', payload: { ...payload, kind: 'cookies', query: 'cookie' } }), target);
  expect(denied).toEqual({ ok: false, error: 'Allow access to this website to view its cookies.' });
  const opened = context.waitForEvent('page');
  await ui.evaluate(payload => chrome.runtime.sendMessage({ source: 'justonehop', type: 'open-cookie-access', payload }), target);
  const permission = await opened;
  await expect(permission.getByRole('button', { name: 'Continue to Chrome' })).toBeEnabled();
  await expect(permission.locator('.permission-site')).toHaveText('127.0.0.1');
  await expect(permission.getByRole('button', { name: 'Continue to Chrome' })).toHaveCSS('height', '32px');
  await expect(permission.locator('h1')).toHaveCSS('font-size', '20px');
  await permission.setViewportSize({ width: 390, height: 516 });
  await expect(permission.locator('main.cookie-access')).toHaveCount(1);
  await expect(permission.locator('.cookie-access > svg')).toHaveCount(1);
  await test.info().attach('permission-layout', { body: JSON.stringify(await permission.evaluate(() => ({
    html: document.body.innerHTML, height: innerHeight, scrollHeight: document.documentElement.scrollHeight,
    icons: [...document.querySelectorAll('svg')].map(node => ({ rect: node.getBoundingClientRect().toJSON(), html: node.outerHTML })),
  }))), contentType: 'application/json' });
  await permission.screenshot({ path: test.info().outputPath('cookie-permission.png') });
  // Model Chrome's decision in headless; the real native prompt is tested manually.
  await permission.evaluate(() => {
    (window as unknown as { requested: unknown[] }).requested = [];
    chrome.permissions.request = async args => { (window as unknown as { requested: unknown[] }).requested.push(args); return false; };
  });
  await permission.getByRole('button', { name: 'Continue to Chrome' }).click();
  await expect(permission.getByRole('alert')).toContainText('Access was not granted');
  expect(await permission.evaluate(() => (window as unknown as { requested: unknown[] }).requested)).toEqual([{ origins: ['*://127.0.0.1/*'] }]);
  await source.goto('about:blank');
  await expect(permission.getByRole('alert')).toContainText('The page changed');
  await expect(permission.getByRole('button', { name: 'Continue to Chrome' })).toBeDisabled();
  await permission.close();
  await source.goto(target.expectedUrl);
  const reopened = context.waitForEvent('page');
  await ui.evaluate(payload => chrome.runtime.sendMessage({ source: 'justonehop', type: 'open-cookie-access', payload }), target);
  const accepted = await reopened;
  await expect(accepted.getByRole('button', { name: 'Continue to Chrome' })).toBeEnabled();
  await accepted.evaluate(() => { chrome.permissions.request = async args => args.origins?.length === 1 && args.origins[0] === '*://127.0.0.1/*'; });
  await accepted.getByRole('button', { name: 'Continue to Chrome' }).click();
  await expect.poll(() => accepted.isClosed()).toBe(true);
  expect(await worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage?.some(record => record.target === 'command:cookies') || false)).toBe(false);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', cookieDomains: true } });
  test('English storage cookie domains include parent, Secure, ordinary and current-partition cookies only', async () => {
  const site = 'https://app.example.test/nested';
  await context.route('https://app.example.test/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Cookie domains fixture</title>' }));
  const source = await context.newPage(); await source.goto(site);
  const target = await worker.evaluate(async url => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
    await chrome.cookies.set({ url, name: 'ordinary', value: 'ordinary-value', secure: false, path: '/' });
    await chrome.cookies.set({ url, name: 'secure', value: 'secure-value', secure: true, path: '/' });
    await chrome.cookies.set({ url, name: 'parent', value: 'parent-value', domain: '.example.test', httpOnly: true, path: '/' });
    await chrome.cookies.set({ url, name: 'partitioned', value: 'current-partition', secure: true, sameSite: 'no_restriction', path: '/', partitionKey: { topLevelSite: 'https://example.test', hasCrossSiteAncestor: false } });
    await chrome.cookies.set({ url, name: 'foreign-partition', value: 'excluded', secure: true, sameSite: 'no_restriction', path: '/', partitionKey: { topLevelSite: 'https://other.test', hasCrossSiteAncestor: true } });
    return { kind: 'cookies', tabId: tab.id!, windowId: tab.windowId, expectedUrl: url };
  }, site);
  const reply = await ui.evaluate(payload => chrome.runtime.sendMessage({ source: 'justonehop', type: 'read-page-storage', payload }), target);
  expect(reply.ok).toBe(true);
  expect(reply.data.entries.map((entry: { name: string }) => entry.name)).toEqual(['ordinary', 'parent', 'partitioned', 'secure']);
  expect(reply.data.entries.find((entry: { name: string }) => entry.name === 'parent').cookie.httpOnly).toBe(true);
  expect(reply.data.entries.find((entry: { name: string }) => entry.name === 'partitioned').cookie.partitionKey.topLevelSite).toBe('https://example.test');
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English cookie native permission request accepts the production manifest patterns', { tag: '@windows' }, async () => {
  // Exercise Chrome itself: two separate scheme declarations do not authorize a
  // wildcard-scheme request, even though they appear to cover the same URLs.
  const result = await ui.evaluate(() => Promise.race([
    chrome.permissions.request({ origins: ['*://127.0.0.1/*'] }).then(granted => ({ granted }), error => ({ error: error.message })),
    new Promise<{ pending: true }>(resolve => setTimeout(() => resolve({ pending: true }), 750)),
  ]));
  expect(result).not.toHaveProperty('error');
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English palette launch storage overlay Escape returns after clicking non-focusable content', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Escape-content`);
  await worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  const surface = page.frameLocator('.justonehop-frame');
  const search = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  for (const [query, heading, action] of [['settings', 'Settings', 'settings'], ['local storage', 'Local Storage', 'localStorage'], ['session storage', 'Session Storage', 'sessionStorage']]) {
    await search.fill(query);
    await search.press('Meta+ArrowUp');
    await expect(surface.locator(`[id="justonehop-command:${action}"]`)).toHaveAttribute('aria-selected', 'true');
    await search.press('Enter');
    await surface.locator('.palette-footer-title').filter({ hasText: heading }).click();
    await page.keyboard.press('Escape'); await expect(search).toBeFocused();
    await expect(search).toHaveValue(query);
  }
  await search.fill('ctrl tab'); await page.keyboard.press('Enter');
  await surface.getByRole('button', { name: 'Set Up', exact: true }).click();
  await page.keyboard.press('Meta+k');
  await surface.locator('.action-heading').click(); await page.keyboard.press('Escape');
  await expect(surface.locator('.primary-action')).toBeFocused();
  await surface.locator('.binding-guide p').first().click(); await page.keyboard.press('Escape');
  await expect(surface.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  await surface.locator('.settings-view .palette-footer-title').click();
  await page.keyboard.press('Escape'); await expect(search).toBeFocused();
  await search.fill('local storage'); await page.keyboard.press('Enter');
  await surface.locator('.palette-footer-context').click(); await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
  await search.fill('no-such-command');
  await expect(surface.locator('[id^="justonehop-command:"]')).toHaveCount(0);
  await expect(surface.locator('[id^="justonehop-google:"]')).toHaveCount(1);
  await surface.locator('.palette-footer-title').click();
  await page.keyboard.press('Escape'); await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English palette launch storage overlay Escape routes from the document through storage layers', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Escape-storage-layers`);
  await page.evaluate(() => { localStorage.setItem('fixture', '{"hello":"world"}'); sessionStorage.setItem('fixture', 'session'); });
  const open = () => worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  await open();
  const surface = page.frameLocator('.justonehop-frame');
  const search = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  const blur = () => surface.locator('.justonehop-app').evaluate(node => {
    ((node.getRootNode() as ShadowRoot).activeElement as HTMLElement)?.blur();
  });
  const escape = async () => { await blur(); await page.keyboard.press('Escape'); };
  const enterStorage = async (command: 'local storage' | 'session storage') => {
    await search.fill(command);
    // Returning from a layer starts a fresh search; Enter is blocked while its
    // results are pending. Wait for the intended command before exercising Escape.
    await expect(surface.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
    await expect(surface.locator(`[id="justonehop-command:${command === 'local storage' ? 'localStorage' : 'sessionStorage'}"]`)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
  };
  for (const command of ['local storage', 'session storage'] as const) {
    await enterStorage(command);
    const keys = surface.getByRole('combobox', { name: 'Search storage keys' });
    await expect(surface.locator('.storage-row')).toHaveCount(1);
    await page.keyboard.press('Meta+k');
    await surface.getByRole('combobox', { name: 'Search actions' }).fill('details');
    await page.keyboard.press('Enter');
    await expect(surface.locator('.storage-detail')).toBeVisible();
    await page.keyboard.press('Meta+k'); await escape();
    await expect(surface.locator('.storage-detail')).toBeFocused();
    await escape(); await expect(keys).toBeFocused();
    await escape(); await expect(search).toBeFocused();
    await expect(search).toHaveValue(command);
  }
  await enterStorage('local storage');
  // Composition owns Escape until committed; repeated keydown must not pop again.
  await surface.locator('.justonehop-app').evaluate(node => {
    const doc = node.ownerDocument;
    doc.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true }));
    doc.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, repeat: true }));
  });
  await expect(surface.getByRole('combobox', { name: 'Search storage keys' })).toBeVisible();
  await escape(); await expect(search).toBeFocused();
  await escape(); await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
  // Reopen to catch stale registrations/listeners left behind by the prior mount.
  await open(); await expect(search).toBeFocused();
  await enterStorage('local storage');
  await escape(); await expect(search).toBeFocused();
  await escape(); await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test('English interaction polish storage shares menu footer highlighting and focus restoration', { tag: '@clipboard' }, async () => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage(); await page.goto(`${origin}/Interaction-polish`);
  const raw = JSON.stringify({ lines: Array.from({ length: 120 }, (_, index) => `Value ${index}: 你好`) });
  await page.evaluate(value => {
    localStorage.setItem('polish.key', 'value');
    localStorage.setItem('polish.long', value);
    for (let index = 0; index < 24; index++) localStorage.setItem(`z.key.${String(index).padStart(2, '0')}`, `${index}`);
  }, raw);
  const surface = await openStorageOverlay(page);
  await surface.locator('.search-bar input').fill('local storage'); await page.keyboard.press('Enter');
  const search = surface.locator('.storage-search input');
  // A secondary list names its layer at the left of the footer and spends nothing on the ↑↓ hint.
  await expect(surface.locator('.palette-footer .navigation-hint')).toHaveCount(0);
  await expect(surface.locator('.palette-footer-title')).toHaveText('Local Storage');
  await expect(surface.locator('.storage-row')).toHaveCount(26);
  const locationTitle = await surface.locator('.palette-footer-title').boundingBox();
  const contextBox = await surface.locator('.palette-footer-context').boundingBox();
  await page.evaluate(() => navigator.clipboard.writeText('before selection'));
  await surface.locator('.storage-row').first().click();
  await expect(surface.locator('.storage-preview .preview-code')).toHaveValue('value');
  await expect(surface.locator('.operation-feedback')).toBeEmpty();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('before selection');
  await surface.locator('.palette-footer .primary-action').click();
  await expect(surface.locator('.operation-feedback')).toContainText('Value copied');
  await expect(surface.locator('.palette-footer-context')).toBeHidden();
  expect(await surface.locator('.palette-footer-title').boundingBox()).toEqual(locationTitle);
  expect((await surface.locator('.operation-feedback').boundingBox())!.x).toBe(contextBox!.x);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('value');
  await search.fill('polish');
  await search.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 3));
  await surface.locator('.storage-row').first().click({ button: 'right' });
  const actions = surface.getByRole('combobox', { name: 'Search actions' });
  await expect(actions).toBeFocused(); await actions.fill('copy');
  await expect(surface.locator('.action-row mark')).toHaveCount(2);
  await surface.locator('.palette-footer-title').click();
  await expect(surface.locator('.storage-view')).toBeFocused();
  for (const key of ['ArrowDown', 'Control+n', 'PageDown', 'Meta+ArrowDown']) await page.keyboard.press(key);
  await expect(surface.locator('.storage-row[aria-selected="true"]')).toHaveText('polish.key');
  await expect(surface.locator('.action-heading')).toHaveText('polish.key');
  await page.keyboard.press('Tab'); await expect(actions).toBeFocused();
  await surface.locator('.palette-footer-title').click();
  await expect(surface.locator('.action-search .search-focus, .action-search .search-dismiss')).toHaveCount(0);
  await page.keyboard.press('Shift+Tab'); await expect(actions).toBeFocused();
  await actions.press('Control+n');
  await expect(surface.locator('.palette-footer .primary-action')).toHaveText(/Copy Name/);
  await actions.press('Tab'); await expect(actions).toBeFocused();
  const primary = surface.locator('.palette-footer .primary-action');
  await primary.focus();
  for (const key of ['Shift+Enter', 'Control+Enter', 'Alt+Enter', 'Meta+Enter', 'Shift+Space']) {
    await primary.press(key);
    await expect(surface.locator('.action-menu')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('value');
  }
  const prevented = await primary.evaluate(node => [
    { key: 'Enter', repeat: true }, { key: 'Enter', isComposing: true }, { key: 'Enter', keyCode: 229 },
  ].map(init => !node.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }))));
  expect(prevented).toEqual([true, true, true]);
  await primary.press('Enter');
  await expect(surface.locator('.action-menu')).toHaveCount(0);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('polish.key');
  await expect(search).toBeFocused();
  expect(await search.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 3]);
  await search.fill('');
  const preview = surface.locator('.storage-preview');
  const value = preview.locator('.preview-code');
  const list = surface.locator('.storage-results');
  const longRow = surface.getByRole('option', { name: 'polish.long', exact: true });
  for (const size of [{ width: 1100, height: 760 }, { width: 390, height: 440 }]) {
    await page.setViewportSize(size);
    await longRow.click();
    await expect(value).toHaveValue(JSON.stringify(JSON.parse(raw), null, 2));
    await expect(value).toHaveAttribute('readonly', '');
    await expect(preview.locator('h1, .storage-value-label')).toHaveCount(0);
    await expect(preview.locator('.preview-info')).toContainText('Keypolish.long');
    await expect(preview.locator('.preview-info')).toContainText('Content TypeJSON');
    const valueBox = (await value.boundingBox())!;
    const infoBox = (await preview.locator('.preview-info').boundingBox())!;
    expect(valueBox.y + valueBox.height).toBeLessThan(infoBox.y);
    await surface.getByRole('option', { name: 'polish.key', exact: true }).hover();
    await expect(longRow).toHaveAttribute('aria-selected', 'true');
    const listBox = (await list.boundingBox())!;
    const previewBox = (await preview.boundingBox())!;
    if (size.width > 520) {
      expect(listBox.x + listBox.width).toBeLessThanOrEqual(previewBox.x);
      expect(listBox.y).toBe(previewBox.y);
    } else {
      expect(listBox.y + listBox.height).toBeLessThanOrEqual(previewBox.y);
      expect(listBox.width).toBe(previewBox.width);
    }
    await expect(list).toBeInViewport({ ratio: 1 });
    await expect(preview).toBeInViewport({ ratio: 1 });
    const footerBox = await surface.locator('.palette-footer').boundingBox();
    const searchBox = await surface.locator('.storage-search').boundingBox();
    await search.press('Control+p');
    await expect(preview.locator('.preview-code')).toHaveValue('value');
    await search.press('Control+n');
    await search.press('Enter');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(raw);
    await search.press('Tab'); await expect(surface.locator('.storage-search .search-dismiss')).toBeFocused();
    await page.keyboard.press('Tab'); await expect(value).toBeFocused();
    const listScroll = await list.evaluate(node => node.scrollTop);
    await value.press('PageDown');
    await expect.poll(() => value.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await expect(longRow).toHaveAttribute('aria-selected', 'true');
    expect(await list.evaluate(node => node.scrollTop)).toBe(listScroll);
    // Native PageDown scrolls over several frames; compare independent scrolling
    // only after the preview has stopped, rather than sampling its animation.
    let previewScroll = -1;
    let stableSamples = 0;
    await expect.poll(async () => {
      const current = await value.evaluate(node => node.scrollTop);
      stableSamples = current === previewScroll ? stableSamples + 1 : 0;
      previewScroll = current;
      return stableSamples;
    }, { intervals: [100], timeout: 3000 }).toBeGreaterThanOrEqual(3);
    await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
    expect(await list.evaluate(node => node.scrollTop)).toBeGreaterThan(listScroll);
    expect(await value.evaluate(node => node.scrollTop)).toBe(previewScroll);
    expect(await surface.locator('.palette-footer').boundingBox()).toEqual(footerBox);
    expect(await surface.locator('.storage-search').boundingBox()).toEqual(searchBox);
    await value.press('Tab'); await expect(surface.locator('.palette-footer .footer-back')).toBeFocused();
    await list.evaluate(node => { node.scrollTop = 0; });
    await value.evaluate(node => { node.scrollTop = 0; });
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await surface.locator('.palette').screenshot({ path: test.info().outputPath(`storage-preview-${theme}-${size.width}.png`) });
    }
    expect(await surface.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  await search.fill('missing-key');
  await expect(preview).toHaveCount(0);
  await expect(surface.locator('.palette-footer .primary-action')).toBeDisabled();
  await surface.locator('.palette-footer .footer-back').click();
  await expect(surface.locator('.search-bar input')).toHaveValue('local storage');
});
});
