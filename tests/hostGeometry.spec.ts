import { expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, defaults, origin, context, ui, worker } from './support/paletteFixture';
import { openStorageOverlay, openNativePalette } from './support/paletteHelpers';
import { registerPaletteFixture } from './support/paletteFixture';

registerPaletteFixture();

test.describe(() => {
  const language: string = 'English';
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test(`${language} storage and Tab Group layers preserve main palette geometry`, async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Layout-host`);
  await page.evaluate(() => { localStorage.setItem('layout.key', 'preview value'); });
  const sourceId = await worker.evaluate(async origin => {
    const source = (await chrome.tabs.query({})).find(tab => tab.url === `${origin}/Layout-host`)!;
    const tab = await chrome.tabs.create({ url: `${origin}/Layout-member`, active: false });
    const id = await chrome.tabs.group({ tabIds: [source.id!, tab.id!] });
    await chrome.tabGroups.update(id, { title: 'Layout Group Unique', color: 'blue' });
    for (let at = 0; at < 7; at++) await chrome.tabs.create({ url: `${origin}/Layout-other-${at}`, active: false });
    return source.id!;
  }, origin);
  const surface = await openStorageOverlay(page);
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    expect(await page.locator('#justonehop-command-palette').evaluate(host =>
      getComputedStyle(host.shadowRoot!.querySelector('dialog')!, '::backdrop').backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    await expect(surface.locator('.overlay')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  }
  await page.emulateMedia({ colorScheme: 'light' });
  const root = surface.locator('.search-bar input');
  await expect(surface.locator('.result.tab')).toHaveCount(0);
  await root.fill('Layout');
  await expect(surface.locator('.result.tab')).toHaveCount(9);
  await expect(surface.locator(`[id="justonehop-tab:${sourceId}"] .current-badge`)).toHaveText(language === 'English' ? 'Current' : '当前');
  await expect(surface.locator('.result.tab .current-badge')).toHaveCount(1);
  async function geometry() {
    return surface.locator('.palette').evaluate(panel => {
      const box = (selector: string) => {
        const rect = panel.querySelector(selector)!.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      const rect = panel.getBoundingClientRect();
      const title = box('.result .entry-title');
      const footerTitle = box('.palette-footer-title');
      const footerType = getComputedStyle(panel.querySelector('.palette-footer-title')!);
      const textSlot = box('.palette-footer-text');
      return {
        panel: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        footer: box('.palette-footer'), search: box('.search-bar, .storage-search'),
        input: box('.search-bar input, .storage-search input'), row: box('.result'),
        icon: box('.result .entry-icon'), title: { x: title.x, y: title.y, height: title.height },
        navigation: box('.footer-hint-pet'), footerTitle: { x: footerTitle.x, y: footerTitle.y, height: footerTitle.height },
        footerType: { size: footerType.fontSize, weight: footerType.fontWeight, color: footerType.color },
        textStart: { x: textSlot.x, y: textSlot.y, height: textSlot.height },
      };
    });
  }
  for (const size of [{ width: 750, height: 760 }, { width: 390, height: 600 }, { width: 390, height: 440 }]) {
    await page.setViewportSize(size);
    await root.fill('local storage');
    await expect(surface.getByRole('option').first()).toBeVisible();
    const main = await geometry();
    await surface.locator('.palette-footer').screenshot({ path: test.info().outputPath(`footer-main-${language}-${size.width}x${size.height}.png`) });
    expect(main.footer.height).toBe(44);
    expect(main.search.height).toBe(56);
    expect(main.row.y - main.search.y - main.search.height).toBe(4);
    expect(main.row.height).toBe(40);
    await surface.locator('.palette').screenshot({ path: test.info().outputPath(`search-content-spacing-${language}-${size.width}x${size.height}.png`) });
    expect(main.panel.height).toBeLessThanOrEqual(516);
    await root.press('Enter');
    await expect(surface.locator('.storage-row')).toHaveCount(1);
    const storage = await geometry();
    await surface.locator('.palette-footer').screenshot({ path: test.info().outputPath(`footer-storage-${language}-${size.width}x${size.height}.png`) });
    for (const key of ['panel', 'footer', 'search', 'icon', 'title', 'navigation', 'footerTitle', 'footerType', 'textStart'] as const) expect(storage[key]).toEqual(main[key]);
    expect(storage.row.x).toBe(main.row.x); expect(storage.row.y).toBe(main.row.y); expect(storage.row.height).toBe(main.row.height);
    if (size.width > 520) expect(storage.row.width).toBeLessThan(main.row.width);
    else expect(storage.row.width).toBe(main.row.width);
    expect(storage.input.x).toBe(main.input.x);
    expect(storage.input.y).toBe(main.input.y);
    await expect(surface.locator('.palette-footer .primary-action')).toBeInViewport();
    expect(await surface.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await expect(surface.locator('.storage-search .search-dismiss')).toHaveText('esc');
    await surface.locator('.storage-search .search-dismiss').click();
    await expect(root).toBeFocused(); await expect(root).toHaveValue('local storage');
    await root.fill('Layout Group Unique');
    await expect(surface.getByRole('option').filter({ hasText: 'Layout Group Unique' }).first()).toBeVisible();
    const groupMain = await geometry();
    await surface.getByRole('option').filter({ hasText: 'Layout Group Unique' }).first().click();
    await expect(surface.locator('.group-view .result')).toHaveCount(2);
    await expect(surface.locator('.group-view .current-badge')).toHaveCount(1);
    await expect(surface.locator(`[id="group-tab:${sourceId}"] .current-badge`)).toHaveCount(1);
    const group = await geometry();
    for (const key of ['panel', 'footer', 'search', 'row', 'icon', 'title', 'navigation', 'footerTitle', 'footerType', 'textStart'] as const) expect(group[key]).toEqual(groupMain[key]);
    expect(group.input.x).toBe(groupMain.input.x);
    expect(group.input.y).toBe(groupMain.input.y);
    await expect(surface.locator('.palette-footer .primary-action')).toBeInViewport();
    await expect(surface.locator('.group-view .search-dismiss')).toHaveText('esc');
    await surface.locator('.group-view .search-dismiss').click(); await expect(root).toBeFocused();
  }
  await page.setViewportSize({ width: 750, height: 760 });
  await surface.locator('.settings-button').click();
  const settingsInput = surface.locator('.settings-search input');
  await expect(settingsInput).toBeFocused();
  expect((await surface.locator('.settings-search').boundingBox())!.height).toBe(56);
  await surface.locator('.palette').screenshot({ path: test.info().outputPath(`compact-search-settings-${language}.png`) });
  await surface.locator('.overlay').click({ position: { x: 2, y: 2 } });
  await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English palette launch storage overlay opens centered on a fresh ordinary page', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Fresh-launch`);
  // The ordinary page already has the lightweight recent-key listener, but not the palette.
  const id = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, page.url());
  await expect.poll(() => worker.evaluate(async tabId => {
    try { return await chrome.tabs.sendMessage(tabId, { source: 'justonehop-recent', type: 'arm', session: 'launch-check', modifier: 'Control' }, { frameId: 0 }); }
    catch { return null; }
  }, id)).not.toBeNull();
  await worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  await expect(page.locator('#justonehop-command-palette')).toBeAttached();
  expect(await worker.evaluate(tabId => chrome.action.getPopup({ tabId }), id)).toBe('');
  const surface = page.frameLocator('.justonehop-frame');
  await expect(surface.getByRole('combobox')).toBeFocused();
  const bounds = await surface.locator('.palette').boundingBox();
  expect(Math.abs(bounds!.x + bounds!.width / 2 - 550)).toBeLessThan(1);
  await surface.getByRole('combobox').fill('settings'); await page.keyboard.press('Enter');
  await expect(surface.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  const settings = await surface.locator('.palette').boundingBox();
  expect(settings!.x).toBe(bounds!.x); expect(settings!.y).toBe(bounds!.y);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
  // A successful launch must also recover any per-tab popup left by an earlier failure.
  await worker.evaluate(async tabId => {
    await chrome.action.setPopup({ tabId, popup: 'popup.html' });
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  }, id);
  await expect(page.locator('#justonehop-command-palette')).toBeAttached();
  expect(await worker.evaluate(tabId => chrome.action.getPopup({ tabId }), id)).toBe('');
});
});

test.describe('headed', { tag: '@headed' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true, headed: true } });
  test('English palette launch native page anchors a separate window to the browser and executes against the source', async () => {
  const { source, palette } = await openNativePalette();
  const bounds = await palette.evaluate(async sourceId => {
    const current = await chrome.windows.getCurrent();
    const owner = await chrome.windows.get(sourceId);
    const reply = await chrome.runtime.sendMessage({ source: 'justonehop', type: 'snapshot' });
    const tab = await chrome.tabs.get(reply.data.currentTabId);
    return { current, owner, tab, snapshot: reply.data, screenX, screenY, outerWidth, outerHeight, innerWidth, innerHeight };
  }, source.windowId);
  expect(bounds.current.type).toBe('popup');
  expect(bounds.snapshot.windowId).toBe(source.windowId);
  expect(bounds.snapshot.currentTabId).toBe(source.tabId);
  const viewportWidth = bounds.tab.width!, viewportHeight = bounds.tab.height!;
  const expectedWidth = Math.min(750, viewportWidth - (viewportWidth <= 520 ? 20 : 48));
  const topInset = viewportWidth <= 520 ? 24 : Math.min(150, Math.max(28, viewportHeight * .16));
  const expectedTop = bounds.owner.top! + (bounds.owner.width! <= 520 ? 24 : Math.min(150, Math.max(28, bounds.owner.height! * .16)));
  const contentTop = bounds.screenY + bounds.outerHeight - bounds.innerHeight - (bounds.outerWidth - bounds.innerWidth) / 2;
  expect(Math.abs(contentTop - expectedTop)).toBeLessThan(3);
  expect(Math.abs(bounds.screenX + bounds.outerWidth / 2 - bounds.owner.left! - bounds.owner.width! / 2)).toBeLessThan(3);
  expect(bounds.innerWidth).toBe(expectedWidth);
  expect(Math.abs(bounds.innerHeight - Math.min(516, viewportHeight - topInset - 24))).toBeLessThanOrEqual(1);
  const input = palette.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await input.fill('settings'); await input.press('Enter');
  await expect(palette.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  await palette.keyboard.press('Escape'); await expect(input).toBeFocused();
  await input.fill('pin tab');
  await input.press('Enter');
  await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).pinned, source.tabId)).toBe(true);
  await expect(input).toHaveValue('pin tab');
  await expect(input).toBeFocused();
  await expect(palette.locator('[id="justonehop-command:pin"] .entry-title')).toContainText('Unpin Tab');
  expect((await worker.evaluate(id => chrome.tabs.get(id), source.tabId)).windowId).toBe(source.windowId);
});
});

// Chrome forbids tabs.setZoom on chrome:// pages. Exercise the real standalone
// controllers with a zoomable HTTP source by changing only its launch-time URL
// classification in the test worker; all geometry APIs still read the real tab.
async function launchStandaloneForGeometry(tabId: number, command = 'toggle-palette') {
  await worker.evaluate(async ({ tabId, command }) => {
    const source = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(source.windowId, { focused: true });
    const query = chrome.tabs.query, send = chrome.tabs.sendMessage;
    Object.defineProperty(chrome.tabs, 'query', { configurable: true, value: async (options: chrome.tabs.QueryInfo) =>
      (await query(options)).map(tab => tab.id === tabId ? { ...tab, url: 'chrome://version/', pendingUrl: undefined } : tab) });
    Object.defineProperty(chrome.tabs, 'sendMessage', { configurable: true, value: (id: number, message: { source?: string; type?: string }, options?: chrome.tabs.MessageSendOptions) =>
      id === tabId && message.source === 'justonehop-recent' && message.type === 'arm' ? Promise.resolve({ held: true }) : send(id, message, options) });
    try {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback(command)));
    } finally {
      Object.defineProperty(chrome.tabs, 'query', { configurable: true, value: query });
      Object.defineProperty(chrome.tabs, 'sendMessage', { configurable: true, value: send });
    }
  }, { tabId, command });
}

async function pointerViewport(page: Page, zoom: number) {
  await page.evaluate(zoom => {
    (window as any).__contentOrigin = undefined;
    document.addEventListener('pointermove', event => {
      if (event.isTrusted) (window as any).__contentOrigin = {
        left: event.screenX - event.clientX * zoom, top: event.screenY - event.clientY * zoom,
      };
    }, { once: true });
  }, zoom);
  await page.mouse.move(101, 103);
  await page.waitForFunction(() => Boolean((window as any).__contentOrigin));
  return page.evaluate(() => (window as any).__contentOrigin as { left: number; top: number });
}

for (const layout of ['horizontal tabs', 'vertical tabs']) for (const zoom of [1, 1.25, .8]) test.describe('headed', { tag: '@headed' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true, headed: true, verticalTabs: layout === 'vertical tabs' } });
  test(`English palette launch hosts preserve their viewport and browser anchors with ${layout} at ${zoom * 100}% zoom`, async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Screen-alignment`); await page.bringToFront();
  const source = await worker.evaluate(async ({ url, zoom }) => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
    await chrome.tabs.setZoom(tab.id!, zoom);
    return { tabId: tab.id!, windowId: tab.windowId };
  }, { url: page.url(), zoom });
  const viewport = await pointerViewport(page, zoom);
  if (layout === 'vertical tabs') expect(viewport.left - await page.evaluate(() => screenX)).toBeGreaterThan(200);
  await worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  const surface = page.frameLocator('.justonehop-frame');
  await expect(surface.getByRole('combobox')).toBeFocused();
  // The overlay belongs to the page viewport; the standalone panel belongs to
  // the browser window. Observe both anchors independently at each source zoom.
  const box = await surface.locator('.palette').evaluate(node => {
    const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  const pageSize = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(Math.abs(box.x + box.width / 2 - pageSize.width / 2)).toBeLessThan(1);
  const overlayInset = pageSize.width <= 520 ? 24 : Math.min(150, Math.max(28, pageSize.height * .16));
  expect(Math.abs(box.y - overlayInset)).toBeLessThan(1);
  await page.keyboard.press('Escape');
  // Start with a different extension-origin zoom. Temporary panels must copy
  // their source's zoom without changing this other extension page.
  await ui.evaluate(async () => { const tab = await chrome.tabs.getCurrent(); await chrome.tabs.setZoom(tab!.id!, 1.5); });
  await launchStandaloneForGeometry(source.tabId);
  await expect.poll(() => context.pages().some(page => page.url().includes('popup.html#window='))).toBe(true);
  const popup = context.pages().find(page => page.url().includes('popup.html#window='))!;
  await expect(popup.getByRole('combobox')).toBeFocused();
  const native = await popup.locator('.palette').evaluate(async node => {
    const tab = await chrome.tabs.getCurrent(), own = await chrome.windows.getCurrent(), zoom = await chrome.tabs.getZoom(tab!.id!);
    const rect = node.getBoundingClientRect(), frameWidth = own.width! - tab!.width!, frameHeight = own.height! - tab!.height!;
    return { left: own.left! + frameWidth / 2 + rect.x * zoom,
      top: own.top! + frameHeight - frameWidth / 2 + rect.y * zoom, width: rect.width * zoom, height: rect.height * zoom, zoom };
  });
  expect(native.zoom).toBe(zoom);
  const owner = await worker.evaluate(id => chrome.windows.get(id), source.windowId);
  expect(Math.abs(native.left + native.width / 2 - owner.left! - owner.width! / 2)).toBeLessThan(3);
  const nativeInset = owner.width! / zoom <= 520 ? 24 * zoom : Math.min(150 * zoom, Math.max(28 * zoom, owner.height! * .16));
  expect(Math.abs(native.top - owner.top! - nativeInset)).toBeLessThan(3);
  expect(Math.abs(native.width - box.width * zoom)).toBeLessThanOrEqual(1);
  expect(Math.abs(native.height - box.height * zoom)).toBeLessThanOrEqual(1);
  expect(await ui.evaluate(async () => chrome.tabs.getZoom((await chrome.tabs.getCurrent())!.id!))).toBe(1.5);
  expect((await worker.evaluate(id => chrome.tabs.get(id), source.tabId)).windowId).toBe(source.windowId);
});
});

for (const zoom of [1, 1.25, .8]) test.describe('headed', { tag: '@headed' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true, headed: true } });
  test(`English palette launch native visual sizing matches the recent switcher at ${zoom * 100}% zoom and stays compact`, async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Switcher-screen-alignment`); await page.bringToFront();
  const source = await worker.evaluate(async ({ url, zoom }) => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
    await chrome.tabs.setZoom(tab.id!, zoom); return { tabId: tab.id!, windowId: tab.windowId };
  }, { url: page.url(), zoom });
  await launchStandaloneForGeometry(source.tabId);
  await expect.poll(() => context.pages().some(page => page.url().includes('popup.html#window='))).toBe(true);
  const palette = context.pages().find(page => page.url().includes('popup.html#window='))!;
  await expect(palette.getByRole('combobox')).toBeFocused();
  const bounds = await palette.evaluate(() => chrome.windows.getCurrent());
  expect(await palette.locator('.search-bar').evaluate(node => node.getBoundingClientRect().height)).toBeCloseTo(56, 1);
  await palette.keyboard.press('Escape').catch(error => { if (!palette.isClosed()) throw error; });
  await expect.poll(() => palette.isClosed()).toBe(true);
  await page.bringToFront();
  await launchStandaloneForGeometry(source.tabId, 'switch-recent');
  await expect.poll(() => context.pages().some(page => page.url().includes('switcher.html?'))).toBe(true);
  const switcher = context.pages().find(page => page.url().includes('switcher.html?'))!;
  await expect(switcher.getByRole('option').first()).toBeVisible();
  await expect(switcher.getByRole('listbox')).toBeFocused();
  await expect(switcher.getByRole('combobox')).toBeDisabled();
  expect(await switcher.evaluate(async () => chrome.tabs.getZoom((await chrome.tabs.getCurrent())!.id!))).toBe(zoom);
  expect(await switcher.locator('.search-bar').evaluate(node => node.getBoundingClientRect().height)).toBeCloseTo(56, 1);
  const actual = await switcher.evaluate(() => chrome.windows.getCurrent());
  for (const key of ['width', 'height', 'left', 'top'] as const) expect(actual[key]).toBe(bounds[key]);
  const rendered = await switcher.evaluate(async () => {
    const tab = (await chrome.tabs.getCurrent())!;
    const rect = (selector: string) => { const box = document.querySelector(selector)!.getBoundingClientRect();
      return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height }; };
    return { innerWidth, innerHeight, tabWidth: tab.width!, tabHeight: tab.height!,
      bodyWidth: document.body.scrollWidth, bodyHeight: document.body.scrollHeight,
      footer: rect('.palette-footer'), close: rect('.close-button') };
  });
  expect(Math.abs(rendered.innerWidth * zoom - rendered.tabWidth)).toBeLessThanOrEqual(zoom);
  expect(Math.abs(rendered.innerHeight * zoom - rendered.tabHeight)).toBeLessThanOrEqual(zoom);
  expect(rendered.bodyWidth).toBeLessThanOrEqual(rendered.innerWidth);
  expect(rendered.bodyHeight).toBeLessThanOrEqual(rendered.innerHeight);
  for (const box of [rendered.footer, rendered.close]) {
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(rendered.innerWidth + 1); expect(box.bottom).toBeLessThanOrEqual(rendered.innerHeight + 1);
  }
  expect(Math.abs(rendered.footer.bottom - rendered.innerHeight)).toBeLessThanOrEqual(1);
  // Capture the native content rectangle in screen DIPs. CSS viewport dimensions
  // crop the image at browser zoom because the capture surface uses native units.
  const capture = await context.newCDPSession(switcher);
  const screenshot = await capture.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: rendered.tabWidth, height: rendered.tabHeight, scale: 1 } });
  await writeFile(test.info().outputPath(`justonehop-switcher-polish-${zoom * 100}.png`), Buffer.from(screenshot.data, 'base64'));
  await capture.detach();
  await switcher.evaluate(async () => chrome.tabs.setZoom((await chrome.tabs.getCurrent())!.id!, 1));
  await switcher.setViewportSize({ width: 390, height: 440 });
  expect(await switcher.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(390);
  const footer = await switcher.locator('.palette-footer').boundingBox();
  expect(footer!.height).toBe(44);
  expect(footer!.y + footer!.height).toBe(440);
  await expect(switcher.locator('.recent-help')).toHaveCount(0);
  expect(await switcher.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(switcher.locator('footer').getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  expect(await worker.evaluate(async id => (await chrome.tabs.get(id)).active, source.tabId)).toBe(true);
});
});
