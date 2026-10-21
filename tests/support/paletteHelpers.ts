import { expect, type Page } from '@playwright/test';
import { origin, context, worker } from './paletteFixture';

export async function openStorageOverlay(page: Page) {
  await page.bringToFront();
  const id = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, page.url());
  await worker.evaluate(async tabId => {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, { source: 'justonehop', type: 'toggle' });
  }, id);
  const surface = page.frameLocator('.justonehop-frame');
  await expect(surface.locator('.result.command')).toHaveCount(9);
  return surface;
}

// A separate Chrome window stays focused while source-window tabs change.
export async function recentPopup(source: Page, direction = 1) {
  await source.bringToFront();
  const target = await worker.evaluate(async url => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
    await chrome.tabs.update(tab.id!, { active: true });
    return { id: tab.id!, windowId: tab.windowId };
  }, source.url());
  const created = context.waitForEvent('page');
  const own = await worker.evaluate(async ({ target, direction }) => chrome.windows.create({
    url: `switcher.html?tab=${target.id}&window=${target.windowId}&direction=${direction}`,
    type: 'popup', focused: true, width: 500, height: 500,
  }), { target, direction });
  const page = await created;
  await expect(page.getByRole('option').first()).toBeVisible();
  const browser = await context.newCDPSession(page);
  const read = async (expression: string) => (await browser.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  const key = (type: string, key: string, code: string, windowsVirtualKeyCode: number, modifiers = 0) => browser.send('Input.dispatchKeyEvent', { type: type as 'keyDown' | 'keyUp', key, code, windowsVirtualKeyCode, modifiers });
  const active = () => worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0]?.id, target.windowId);
  await expect.poll(active).toBe(target.id);
  return { target, own: own!, page, read, key, selected: () => read("document.querySelector('[aria-selected=true]')?.id"), closed: async () => page.isClosed(), active };
}

export async function bridgeFixture() {
  const a = await context.newPage(); await a.goto(`${origin}/Bridge-A`);
  const b = await context.newPage(); await b.goto(`${origin}/Bridge-B`);
  await a.bringToFront();
  const ids = await worker.evaluate(async url => {
    const tabs = await chrome.tabs.query({});
    const source = tabs.find(tab => tab.url === url)!;
    return { source: source.id!, window: source.windowId, previous: tabs.find(tab => tab.url?.endsWith('/Bridge-B'))!.id! };
  }, a.url());
  const open = () => worker.evaluate(async () => { const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands; await Promise.all(callbacks.map(callback => callback('switch-recent'))); });
  const active = () => worker.evaluate(async id => (await chrome.tabs.query({ windowId: id, active: true }))[0]?.id, ids.window);
  const windows = () => worker.evaluate(async () => (await chrome.tabs.query({ url: chrome.runtime.getURL('switcher.html') + '*' })).length);
  return { a, b, ids, open, active, windows };
}

export async function openNativePalette() {
  const sourcePageCreated = context.waitForEvent('page', page => page.url() === 'chrome://version/');
  const source = await worker.evaluate(async () => {
    const tab = await chrome.tabs.create({ url: 'chrome://version/', active: true });
    return { tabId: tab.id!, windowId: tab.windowId };
  });
  const sourcePage = await sourcePageCreated;
  // A newly created native tab can regain focus when it finishes loading.
  // Establish the source before opening a panel that dismisses on focus loss.
  await sourcePage.waitForLoadState('load');
  await sourcePage.bringToFront();
  await worker.evaluate(id => chrome.windows.update(id, { focused: true }), source.windowId);
  await expect.poll(async () => {
    const browserFocused = await worker.evaluate(async ({ tabId, windowId }) => {
      const [tab, focused] = await Promise.all([chrome.tabs.get(tabId), chrome.windows.getLastFocused()]);
      return tab.status === 'complete' && tab.active && focused.id === windowId && focused.focused;
    }, source);
    return browserFocused && await sourcePage.evaluate(() => document.hasFocus());
  }).toBe(true);
  // Capture even a panel that closes during launch, so readiness fails on that
  // page instead of reporting that it was never created.
  const [palette] = await Promise.all([
    context.waitForEvent('page', { predicate: page => page.url().includes('popup.html#window='), timeout: 5000 }),
    worker.evaluate(async () => {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    }),
  ]);
  await expect(palette.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' })).toBeFocused();
  return { source, palette };
}
