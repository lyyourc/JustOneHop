import { test as base, expect, type Locator, type Page } from '@playwright/test';
import type { UsageRecord } from '../src/usage';
import { test, defaults, origin, context, ui, worker, popupUrl, setUI } from './support/paletteFixture';
import { openStorageOverlay, openNativePalette } from './support/paletteHelpers';
import { registerPaletteFixture } from './support/paletteFixture';

registerPaletteFixture();

async function dragResultText(page: Page, row: Locator) {
  const title = row.locator('.entry-title');
  await title.scrollIntoViewIfNeeded();
  const box = await title.boundingBox();
  expect(box!.width).toBeGreaterThan(35);
  // Send trusted pointer events directly: Playwright's drag interception can stall inside the overlay iframe.
  const pointer = await page.context().newCDPSession(page);
  const x = box!.x + 3, end = box!.x + Math.min(box!.width - 3, 85), y = box!.y + box!.height / 2;
  try {
    await pointer.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await pointer.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 12; step++) await pointer.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: x + (end - x) * step / 12, y, button: 'left', buttons: 1,
    });
    await pointer.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end, y, button: 'left', buttons: 0, clickCount: 1 });
  } finally { await pointer.detach(); }
  // A gesture alone is insufficient: prove Chrome actually selected row text.
  expect(await title.evaluate(node => {
    const root = node.getRootNode() as Node & { getSelection?: () => Selection | null };
    const selection = root.getSelection?.() ?? node.ownerDocument.getSelection();
    return selection && !selection.isCollapsed && selection.containsNode(node, true) ? selection.toString() : '';
  })).not.toBe('');
}

test.describe(() => {
test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
test('URL actions: English exact copies preserve context and retry without navigation or learning', { tag: '@clipboard' }, async () => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const urls = {
      tab: `${origin}/Urlcopy-tab?mode=tab&value=a%2Bb#tab-fragment`,
      bookmark: `${origin}/Urlcopy-bookmark?mode=bookmark&value=a%2Bb#bookmark-fragment`,
      history: `${origin}/Urlcopy-history?mode=history&value=a%2Bb#history-fragment`,
    };
    const baseline: UsageRecord[] = [{ query: 'unrelated', target: 'command:newTab', weight: 2, lastUsed: Date.now() }];
    const tabId = await worker.evaluate(async ({ urls, baseline }) => {
      await chrome.storage.local.set({ searchUsage: baseline });
      const tab = await chrome.tabs.create({ url: urls.tab, active: false });
      await chrome.bookmarks.create({ title: 'Urlcopy bookmark', url: urls.bookmark });
      await chrome.history.addUrl({ url: urls.history });
      return tab.id!;
    }, { urls, baseline });
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).status, tabId)).toBe('complete');
    await ui.bringToFront(); await ui.reload();
    const tabs = () => worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url, active: tab.active })));
    const beforeTabs = await tabs();
    const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    const actions = ui.getByRole('combobox', { name: 'Search actions' });
    const copy = ui.locator('.action-row').filter({ hasText: 'Copy URL' });
    async function copySelected(input: Locator, row: Locator, url: string, mouse: boolean, fail = false) {
      const query = await input.inputValue();
      await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
      if (mouse) await row.click({ button: 'right' });
      else { await expect(row).toHaveAttribute('aria-selected', 'true'); await input.press('Meta+k'); }
      await expect(actions).toBeFocused();
      await actions.fill('复制 URL');
      await expect(copy).toHaveCount(1);
      if (fail) {
        await ui.evaluate(() => {
          const exec = document.execCommand.bind(document), write = navigator.clipboard.writeText.bind(navigator.clipboard);
          document.execCommand = () => false;
          navigator.clipboard.writeText = async () => {
            document.execCommand = exec; navigator.clipboard.writeText = write;
            throw new Error('Clipboard fixture unavailable');
          };
        });
        await copy.click();
        await expect(ui.getByRole('alert')).toBeVisible();
        await expect(copy).toBeVisible();
        expect(await tabs()).toEqual(beforeTabs);
        expect(await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual(baseline);
      }
      if (mouse && !fail) await copy.click();
      else await actions.press('Enter');
      await expect(ui.locator('.action-menu')).toHaveCount(0);
      await expect(ui.getByText('URL copied', { exact: true })).toBeVisible();
      expect(await ui.evaluate(() => navigator.clipboard.readText())).toBe(url);
      await expect(input).toBeFocused(); await expect(input).toHaveValue(query);
      expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
      await expect(row).toHaveAttribute('aria-selected', 'true');
      await expect(ui.getByRole('alert')).toHaveCount(0);
      expect(await tabs()).toEqual(beforeTabs);
      expect(await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual(baseline);
    }
    for (const kind of ['tab', 'bookmark', 'history'] as const) {
      await search.fill(`Urlcopy ${kind}`);
      const row = ui.locator(`#justonehop-results .result.${kind}`);
      await expect(row).toHaveCount(1);
      if (kind === 'bookmark') {
        await dragResultText(ui, row);
        expect(await tabs()).toEqual(beforeTabs);
        await search.focus();
      }
      await copySelected(search, row, urls[kind], kind === 'bookmark', kind === 'bookmark');
    }
    await ui.locator('#justonehop-search-all-history').click();
    const fullSearch = ui.getByRole('combobox', { name: 'Search browsing history', exact: true });
    const history = ui.locator('.history-view .result.history');
    await expect(history).toHaveCount(1);
    await copySelected(fullSearch, history, urls.history, false, true);
    await fullSearch.press('Escape');
    // Use a real source page: an ordinary bookmark click navigates that tab.
    const source = await context.newPage(); await source.goto(`${origin}/Urlcopy-source`);
    const sourceId = await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0].id!, source.url());
    const surface = await openStorageOverlay(source);
    const sourceSearch = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await sourceSearch.fill('Urlcopy bookmark');
    await expect(surface.locator('.result.bookmark')).toHaveCount(1);
    await expect(surface.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
    const beforeNavigation = await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => tab.id));
    // The input's old selection must not suppress an ordinary row click.
    await sourceSearch.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
    await surface.locator('.result.bookmark .entry-title').click();
    await expect(source).toHaveURL(urls.bookmark);
    expect((await worker.evaluate(id => chrome.tabs.get(id), sourceId)).url).toBe(urls.bookmark);
    expect(await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => tab.id))).toEqual(beforeNavigation);
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual(expect.arrayContaining([
      ...baseline, expect.objectContaining({ query: 'urlcopy bookmark', weight: 1 }),
    ]));
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'zh-CN', pageAccess: true, shadow: 'open' } });
  test('URL actions: Chinese narrow overlay keeps Current plain and text drags separate from clicks', { tag: '@clipboard' }, async () => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await context.newPage();
    const sourceUrl = `${origin}/Urlcopy-source?mode=current#source-fragment`;
    const historyUrl = `${origin}/Urlcopy-archive?mode=history&value=a%2Bb#history-fragment`;
    await page.goto(sourceUrl);
    await worker.evaluate(url => chrome.history.addUrl({ url }), historyUrl);
    const surface = await openStorageOverlay(page);
    const root = surface.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
    const actions = surface.getByRole('combobox', { name: '搜索操作' });
    const tabs = () => worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url, active: tab.active })));
    const beforeTabs = await tabs();
    const usage = await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage);
    await root.fill('Urlcopy');
    const current = surface.locator('.result.tab').filter({ has: surface.locator('.current-badge') });
    await expect(current).toHaveCount(1);
    await expect(surface.locator('#justonehop-results .result.history time')).toHaveCount(1);
    const badge = current.locator('.current-badge');
    await expect(badge).toHaveText('当前');
    for (const width of [750, 390]) {
      await page.setViewportSize({ width, height: 600 });
      const typography = await badge.evaluate(node => {
        const style = getComputedStyle(node);
        const kind = node.parentElement!.querySelector('.kind-label:not(.current-badge)')!;
        const time = node.closest('.palette')!.querySelector('.result.history time')!;
        return { size: style.fontSize, weight: style.fontWeight, color: style.color,
          timeSize: getComputedStyle(time).fontSize, timeWeight: getComputedStyle(time).fontWeight, timeColor: getComputedStyle(time).color,
          background: style.backgroundColor, border: style.borderTopWidth, radius: style.borderRadius,
          padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
          afterKind: node.getBoundingClientRect().left >= kind.getBoundingClientRect().right };
      });
      expect(typography).toMatchObject({ size: width > 520 ? '11px' : '10px', weight: '400',
        background: 'rgba(0, 0, 0, 0)', border: '0px', radius: '0px', padding: ['0px', '0px', '0px', '0px'], afterKind: true });
      expect(typography.size).toBe(typography.timeSize);
      expect(typography.weight).toBe(typography.timeWeight);
      expect(typography.color).toBe(typography.timeColor);
    }
    async function copyMouse(input: Locator, row: Locator, url: string) {
      const query = await input.inputValue();
      await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
      await row.click({ button: 'right' });
      await expect(actions).toBeFocused(); await actions.fill('copy URL');
      const copy = surface.locator('.action-row').filter({ hasText: '复制 URL' });
      await expect(copy).toHaveCount(1); await copy.click();
      await expect(surface.locator('.action-menu')).toHaveCount(0);
      await expect(surface.getByText('已复制 URL', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
      await expect(input).toBeFocused(); await expect(input).toHaveValue(query);
      expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
      await expect(row).toHaveAttribute('aria-selected', 'true');
      expect(await tabs()).toEqual(beforeTabs);
      expect(await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual(usage);
    }
    await copyMouse(root, current, sourceUrl);
    const mainHistory = surface.locator('#justonehop-results .result.history');
    await expect(mainHistory).toHaveCount(1);
    await dragResultText(page, mainHistory);
    expect(await tabs()).toEqual(beforeTabs);
    await root.focus();
    await surface.locator('#justonehop-search-all-history').click();
    const fullSearch = surface.getByRole('combobox', { name: '搜索浏览历史', exact: true });
    const history = surface.locator('.history-view .result.history').filter({ hasText: 'Urlcopy-archive' });
    await expect(history).toHaveCount(1);
    await dragResultText(page, history);
    expect(await tabs()).toEqual(beforeTabs);
    await fullSearch.focus();
    await copyMouse(fullSearch, history, historyUrl);
    expect(await surface.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await expect(surface.locator('.palette-footer .primary-action')).toBeInViewport();
    await surface.locator('.palette').screenshot({ path: test.info().outputPath('url-copy-history-chinese-narrow.png') });
    // A selection left in the search input is unrelated to a fresh click on text.
    await fullSearch.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
    await history.locator('.entry-title').click();
    await expect(page).toHaveURL(historyUrl);
    await expect(page.locator('.justonehop-frame')).toHaveCount(0);
  });
});

// Keep these expectations independent of the production Chrome Pages registry.
const chromePageCases = [
  { action: 'openExtensions', en: 'Extensions', zh: '扩展管理', url: 'chrome://extensions/', root: 'extensions-manager', aliases: ['extension', 'extensions', '扩展', '插件'], input: 'keyboard' },
  { action: 'openPasswords', en: 'Password Manager', zh: '密码管理器', url: 'chrome://password-manager/passwords', root: 'password-manager-app', aliases: ['password', 'passwords', '密码'], input: 'keyboard' },
  { action: 'openDownloads', en: 'Downloads', zh: '下载内容', url: 'chrome://downloads/', root: 'downloads-manager', aliases: ['download', 'downloads', '下载'], input: 'mouse' },
  { action: 'openHistory', en: 'History', zh: '历史记录', url: 'chrome://history/', root: 'history-app', aliases: ['history', '历史'], input: 'mouse' },
  { action: 'openBookmarks', en: 'Bookmark Manager', zh: '书签管理器', url: 'chrome://bookmarks/', root: 'bookmarks-app', aliases: ['bookmark manager', '书签管理'], input: 'footer' },
  { action: 'openChromeSettings', en: 'Chrome Settings', zh: 'Chrome 设置', url: 'chrome://settings/', root: 'settings-ui', aliases: ['chrome settings', '浏览器设置'], input: 'footer' },
  { action: 'openExtensionShortcuts', en: 'Extension Shortcuts', zh: '扩展快捷键', url: 'chrome://extensions/shortcuts', root: 'extensions-keyboard-shortcuts', aliases: ['extension shortcuts', '扩展快捷键'], input: 'menu' },
] as const;

async function expectChromePageLoaded(page: Page, target: { url: string; root: string }) {
  await expect(page).toHaveURL(target.url);
  // A committed URL alone also passes for a failed/blank navigation. Inspect
  // Chrome's actual WebUI, including the shortcuts subview inside Extensions.
  await expect(page.locator(target.root)).toBeVisible();
  await expect.poll(() => page.title()).not.toBe('');
  await expect(page.locator('#main-frame-error')).toHaveCount(0);
}

for (const target of chromePageCases.slice(0, 4)) test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test(`Chrome Pages: ${target.en} loads the native page and reuses its exact tab via ${target.input}`, async () => {
    const owner = await ui.evaluate(async () => (await chrome.tabs.getCurrent())!.windowId);
    const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await expect(search).toBeFocused();
    await ui.keyboard.type(target.aliases[0]);
    const row = ui.locator(`[id="justonehop-command:${target.action}"]`);
    if (target.action === 'openHistory') {
      await expect(ui.locator('#justonehop-search-all-history')).toHaveAttribute('aria-selected', 'true');
      await expect(row).toHaveAttribute('aria-selected', 'false');
    } else await expect(row).toHaveAttribute('aria-selected', 'true');
    await expect(row.locator('.entry-title')).toHaveText(`Chrome Pages: ${target.en}`);
    const created = context.waitForEvent('page');
    if (target.input === 'mouse') await row.click();
    else if (target.input === 'footer') await ui.locator('.palette-footer .primary-action').click();
    else {
      if (target.input === 'menu') {
        await ui.keyboard.press('Meta+k');
        await expect(ui.getByRole('combobox', { name: 'Search actions' })).toBeFocused();
        await expect(ui.locator('.action-row')).toHaveCount(1);
      }
      await ui.keyboard.press('Enter').catch(error => { if (!ui.isClosed()) throw error; });
    }
    const destination = await created;
    await expectChromePageLoaded(destination, target);
    await expect.poll(() => ui.isClosed()).toBe(true);
    const first = await worker.evaluate(async ({ windowId, url }) => (await chrome.tabs.query({ windowId })).filter(tab => tab.url === url), { windowId: owner, url: target.url });
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ active: true, windowId: owner });
    const beforeReuse = await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId })).map(tab => tab.id!).sort((a, b) => a - b), owner);

    const reopened = context.waitForEvent('page');
    await worker.evaluate(({ windowId, url }) => chrome.tabs.create({ windowId, url, active: true }), { windowId: owner, url: popupUrl });
    setUI(await reopened);
    await expect(ui.getByRole('combobox')).toBeFocused();
    await ui.getByRole('combobox').fill(target.action === 'openHistory' ? 'Chrome Pages: History' : target.aliases[0]);
    await expect(ui.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
    await expect(ui.locator('#justonehop-results [role="option"]').first()).toHaveAttribute('id', `justonehop-command:${target.action}`);
    await expect(ui.locator(`[id="justonehop-command:${target.action}"]`)).toHaveAttribute('aria-selected', 'true');
    await ui.locator('.palette-footer .primary-action').click();
    await expect.poll(() => ui.isClosed()).toBe(true);
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).active, first[0].id!)).toBe(true);
    expect(await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId })).map(tab => tab.id!).sort((a, b) => a - b), owner)).toEqual(beforeReuse);
    await expectChromePageLoaded(destination, target);
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('Chrome Pages: footer and menu destinations load real WebUI and reuse exact tabs', async () => {
    for (const target of chromePageCases.slice(4)) await test.step(`${target.en}: open via ${target.input}, then reuse`, async () => {
      const owner = await ui.evaluate(async () => (await chrome.tabs.getCurrent())!.windowId);
      const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
      await expect(search).toBeFocused();
      await expect(search).toHaveValue('');
      await ui.keyboard.type(target.aliases[0]);
      const row = ui.locator(`[id="justonehop-command:${target.action}"]`);
      if (target.action === 'openHistory') {
        await expect(ui.locator('#justonehop-search-all-history')).toHaveAttribute('aria-selected', 'true');
        await expect(row).toHaveAttribute('aria-selected', 'false');
      } else await expect(row).toHaveAttribute('aria-selected', 'true');
      await expect(row.locator('.entry-title')).toHaveText(`Chrome Pages: ${target.en}`);
      if (target.action === 'openBookmarks') {
        await ui.getByRole('button', { name: 'Open action menu' }).click();
        await expect(ui.getByRole('combobox', { name: 'Search actions' })).toBeFocused();
        await expect(ui.locator('.action-row')).toHaveCount(1);
      }
      const created = context.waitForEvent('page');
      if (target.input === 'mouse') await row.click();
      else if (target.input === 'footer') await ui.locator('.palette-footer .primary-action').click();
      else {
        if (target.input === 'menu') {
          await ui.keyboard.press('Meta+k');
          await expect(ui.getByRole('combobox', { name: 'Search actions' })).toBeFocused();
          await expect(ui.locator('.action-row')).toHaveCount(1);
        }
        await ui.keyboard.press('Enter').catch(error => { if (!ui.isClosed()) throw error; });
      }
      const destination = await created;
      await expectChromePageLoaded(destination, target);
      await expect.poll(() => ui.isClosed()).toBe(true);
      const first = await worker.evaluate(async ({ windowId, url }) => (await chrome.tabs.query({ windowId })).filter(tab => tab.url === url), { windowId: owner, url: target.url });
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({ active: true, windowId: owner });
      const beforeReuse = await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId })).map(tab => tab.id!).sort((a, b) => a - b), owner);

      const reopened = context.waitForEvent('page');
      await worker.evaluate(({ windowId, url }) => chrome.tabs.create({ windowId, url, active: true }), { windowId: owner, url: popupUrl });
      setUI(await reopened);
      await expect(ui.getByRole('combobox')).toBeFocused();
      await ui.getByRole('combobox').fill(target.action === 'openHistory' ? 'Chrome Pages: History' : target.aliases[0]);
      await expect(ui.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
      await expect(ui.locator('#justonehop-results [role="option"]').first()).toHaveAttribute('id', `justonehop-command:${target.action}`);
      await expect(ui.locator(`[id="justonehop-command:${target.action}"]`)).toHaveAttribute('aria-selected', 'true');
      await ui.locator('.palette-footer .primary-action').click();
      await expect.poll(() => ui.isClosed()).toBe(true);
      await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).active, first[0].id!)).toBe(true);
      expect(await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId })).map(tab => tab.id!).sort((a, b) => a - b), owner)).toEqual(beforeReuse);
      await expectChromePageLoaded(destination, target);
      // Keep the owner window alive while removing this step's destination.
      setUI(await context.newPage()); await ui.goto(popupUrl);
      await destination.close();
    });
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('Chrome Pages: Settings Change in Chrome reuses the existing extension shortcuts tab', async () => {
    const search = ui.getByRole('combobox');
    const tabIds = await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => tab.id!).sort((a, b) => a - b));
    for (const query of ['settings', '设置', 'shortcut', '快捷键']) {
      await search.fill(query);
      await expect(ui.locator('#justonehop-results [role="option"]').first()).toHaveAttribute('id',
        query === 'settings' || query === '设置' ? 'justonehop-command:settings' : 'justonehop-command:settings:keyboard');
      await search.press('Enter');
      await expect(ui.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
      await ui.keyboard.press('Escape');
      await expect(search).toBeFocused();
      await expect(search).toHaveValue(query);
    }
    expect(await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => tab.id!).sort((a, b) => a - b))).toEqual(tabIds);
    await search.fill('');
    const owner = await ui.evaluate(async () => (await chrome.tabs.getCurrent())!.windowId);
    const created = context.waitForEvent('page');
    const shortcuts = await worker.evaluate(windowId => chrome.tabs.create({ windowId, url: 'chrome://extensions/shortcuts', active: false }), owner);
    const destination = await created;
    await expectChromePageLoaded(destination, { url: 'chrome://extensions/shortcuts', root: 'extensions-keyboard-shortcuts' });
    const selfId = await ui.evaluate(async () => (await chrome.tabs.getCurrent())!.id!);
    const before = await worker.evaluate(async ({ windowId, selfId }) => (await chrome.tabs.query({ windowId })).map(tab => tab.id!).filter(id => id !== selfId).sort((a, b) => a - b), { windowId: owner, selfId });
    const settings = ui.locator('.palette-footer .footer-navigation.settings-button');
    await expect(settings).toHaveAccessibleName('Settings');
    await settings.click();
    await expect(ui.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
    await ui.getByRole('button', { name: 'Change in Chrome', exact: true }).click();
    await expect.poll(() => ui.isClosed()).toBe(true);
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).active, shortcuts.id!)).toBe(true);
    expect(await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId })).map(tab => tab.id!).sort((a, b) => a - b), owner)).toEqual(before);
    await expectChromePageLoaded(destination, { url: 'chrome://extensions/shortcuts', root: 'extensions-keyboard-shortcuts' });
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, commands: true } });
  test('Address navigation: closed-shadow overlay accepts native new-tab shortcut', async () => {
    const page = await context.newPage(); await page.goto(`${origin}/Address-closed-source`);
    await page.getByRole('textbox', { name: 'Page input' }).click();
    const source = await worker.evaluate(async url => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
      return { id: tab.id!, windowId: tab.windowId };
    }, page.url());
    await expect(page.locator('#justonehop-command-palette')).toBeAttached();
    expect(await page.locator('#justonehop-command-palette').evaluate(node => node.shadowRoot)).toBeNull();
    const session = await context.newCDPSession(page);
    const ax = async () => {
      const { frameTree } = await session.send('Page.getFrameTree');
      const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
      return (await session.send('Accessibility.getFullAXTree', { frameId })).nodes;
    };
    await expect.poll(async () => (await ax()).some(node => node.role?.value === 'combobox' && node.properties?.some(property => property.name === 'focused' && property.value.value === true))).toBe(true);
    const target = `${origin}/Address-closed-target?Q=A%2Bb#Part`;
    await page.keyboard.type(target);
    await expect.poll(async () => (await ax()).some(node => node.role?.value === 'option' && node.name?.value.includes('Go to URL') && node.properties?.some(property => property.name === 'selected' && property.value.value === true))).toBe(true);
    const shortcut = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta+Enter' : 'Alt+Enter');
    await page.keyboard.press(shortcut);
    await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
    await expect.poll(async () => worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0]?.url, source.windowId)).toBe(target);
    expect(await worker.evaluate(async id => (await chrome.tabs.get(id)).url, source.id)).toBe(`${origin}/Address-closed-source`);
    await session.detach();
  });

  test('Chrome Pages: closed-shadow overlay Enter opens native Downloads and dismisses the palette', async () => {
    const page = await context.newPage();
    await page.goto(`${origin}/Chrome-Pages-overlay`);
    await page.getByRole('textbox', { name: 'Page input' }).click();
    const source = await worker.evaluate(async url => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
      return { tabId: tab.id!, windowId: tab.windowId };
    }, page.url());
    await worker.evaluate(async () => {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    });
    const session = await context.newCDPSession(page);
    const ax = async () => {
      const { frameTree } = await session.send('Page.getFrameTree');
      const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
      return (await session.send('Accessibility.getFullAXTree', { frameId })).nodes;
    };
    await expect(page.locator('#justonehop-command-palette')).toBeAttached();
    expect(await page.locator('#justonehop-command-palette').evaluate(node => node.shadowRoot)).toBeNull();
    await expect.poll(async () => (await ax()).some(node => node.role?.value === 'combobox' && node.properties?.some(property => property.name === 'focused' && property.value.value === true))).toBe(true);
    await page.keyboard.type('downloads');
    await expect.poll(async () => (await ax()).some(node => node.role?.value === 'option' && node.name?.value.includes('Chrome Pages: Downloads'))).toBe(true);
    const created = context.waitForEvent('page');
    await page.keyboard.press('Enter');
    await expectChromePageLoaded(await created, { url: 'chrome://downloads/', root: 'downloads-manager' });
    await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
    const tabs = await worker.evaluate(async windowId => chrome.tabs.query({ windowId }), source.windowId);
    expect(tabs.filter(tab => tab.url === 'chrome://downloads/')).toHaveLength(1);
    expect(tabs.find(tab => tab.url === 'chrome://downloads/')).toMatchObject({ active: true, windowId: source.windowId });
    expect(tabs.find(tab => tab.id === source.tabId)).toMatchObject({ url: `${origin}/Chrome-Pages-overlay` });
    await session.detach();
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test('Saved pages use current tab by default and new tab through shortcut footer and menu', async () => {
    const page = await context.newPage(); await page.goto(`${origin}/Saved-source`);
    const source = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!, page.url());
    const shortcut = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta+Enter' : 'Alt+Enter');
    for (const kind of ['bookmark', 'history', 'allHistory'] as const) {
      const term = `SavedDestination${kind}`;
      const url = `${origin}/${term}?q=one#two`;
      await worker.evaluate(async ({ kind, term, url }) => {
        if (kind === 'bookmark') await chrome.bookmarks.create({ title: term, url });
        else await chrome.history.addUrl({ url });
      }, { kind, term, url });
      for (const method of ['enter', 'click', 'shortcut', 'footer', 'menu'] as const) {
        await worker.evaluate(id => chrome.tabs.update(id, { pinned: false, active: true }), source.id!);
        await page.goto(`${origin}/Saved-source`);
        if (method === 'menu') await worker.evaluate(id => chrome.tabs.update(id, { pinned: true }), source.id!);
        const surface = await openStorageOverlay(page);
        let input = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
        await input.fill(term);
        if (kind === 'allHistory') {
          await surface.locator('#justonehop-search-all-history').click();
          input = surface.getByRole('combobox', { name: 'Search browsing history', exact: true });
        }
        const row = surface.locator(`.result.${kind === 'bookmark' ? 'bookmark' : 'history'}`).filter({ hasText: term });
        await expect(row).toHaveCount(1);
        await expect(row).toHaveAttribute('aria-selected', 'true');
        const before = await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId })).map(tab => tab.id), source.windowId);
        for (const init of [{ key: 'Enter', isComposing: true }, { key: 'Enter', repeat: true }, { key: 'Enter', metaKey: true, shiftKey: true }]) await input.dispatchEvent('keydown', init);
        if (method === 'enter') await input.press('Enter');
        else if (method === 'click') await row.locator('.entry-title').click();
        else if (method === 'shortcut') await input.press(shortcut);
        else if (method === 'footer') {
          await page.setViewportSize({ width: 390, height: 640 });
          await surface.getByRole('button', { name: 'Open in New Tab', exact: true }).click();
        } else {
          await expect(surface.getByRole('button', { name: 'Open in Current Tab', exact: true })).toBeDisabled();
          await input.press('Enter');
          expect((await worker.evaluate(id => chrome.tabs.get(id), source.id!)).url).toBe(`${origin}/Saved-source`);
          const bounds = (await row.boundingBox())!;
          await page.mouse.click(bounds.x + 30, bounds.y + bounds.height / 2, { button: 'right' });
          const actions = surface.getByRole('combobox', { name: 'Search actions' });
          await actions.fill('新标签页'); await actions.press('Enter');
        }
        await expect.poll(() => worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0]?.url, source.windowId)).toBe(url);
        const active = await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0], source.windowId);
        const after = await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId })).map(tab => tab.id), source.windowId);
        if (method === 'enter' || method === 'click') {
          expect(active.id).toBe(source.id); expect(after).toEqual(before);
        } else {
          expect(active.id).not.toBe(source.id); expect(after.length).toBe(before.length + 1);
          expect((await worker.evaluate(id => chrome.tabs.get(id), source.id!)).url).toBe(`${origin}/Saved-source`);
          await worker.evaluate(id => chrome.tabs.remove(id), active.id!);
        }
        await page.setViewportSize({ width: 1100, height: 760 });
      }
    }
  });

  test('Google search: local priority and mouse keyboard menu navigation preserve search terms', async () => {
    // Chrome API-created tabs can navigate before Playwright installs routing.
    // Capture the requested destination and use a local page to verify tab effects.
    await worker.evaluate(base => {
      const state = globalThis as unknown as { __googleRequests: string[] };
      state.__googleRequests = [];
      const redirect = (url: string | undefined) => {
        if (!url?.startsWith('https://www.google.com/search?')) return url;
        state.__googleRequests.push(url);
        return `${base}/Google-destination${new URL(url).search}`;
      };
      const update = chrome.tabs.update.bind(chrome.tabs), create = chrome.tabs.create.bind(chrome.tabs);
      chrome.tabs.update = (async (id: number, props: chrome.tabs.UpdateProperties) => update(id, { ...props, ...(props.url ? { url: redirect(props.url) } : {}) })) as typeof chrome.tabs.update;
      chrome.tabs.create = (async (props: chrome.tabs.CreateProperties) => create({ ...props, ...(props.url ? { url: redirect(props.url) } : {}) })) as typeof chrome.tabs.create;
    }, origin);
    const requests = () => worker.evaluate(() => (globalThis as unknown as { __googleRequests: string[] }).__googleRequests);
    const page = await context.newPage(); await page.goto(`${origin}/Google-source`);
    const source = await worker.evaluate(async url => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
      await chrome.bookmarks.create({ title: 'LocalSearchMatch', url: 'https://example.test/local-result' });
      return { id: tab.id!, windowId: tab.windowId };
    }, page.url());
    let surface = await openStorageOverlay(page);
    let input = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    const rows = () => surface.locator('#justonehop-results .result');
    await expect(rows().filter({ hasText: 'Search Google for' })).toHaveCount(0);
    await input.fill('LocalSearchMatch');
    await expect(rows().first()).toHaveClass(/bookmark/);
    await expect(rows().last()).toContainText('Search Google for “LocalSearchMatch”');
    await input.fill('example.test/new-path');
    await expect(rows().first()).toContainText('Go to URL');
    await expect(rows().last()).toContainText('Search Google for');
    expect(await requests()).toEqual([]);
    await input.press('Escape');
    const shortcut = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta+Enter' : 'Alt+Enter');
    for (const method of ['click', 'enter', 'shortcut', 'footer', 'menu'] as const) {
      await page.goto(`${origin}/Google-source`);
      if (method === 'menu') await worker.evaluate(id => chrome.tabs.update(id, { pinned: true }), source.id);
      surface = await openStorageOverlay(page);
      input = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
      const terms = `UnmatchedSearch ${method} 中文 C++ & #part`;
      const prefix = method === 'shortcut' ? '谷歌搜索 ' : method === 'menu' ? 'google ' : '';
      await input.fill(prefix + terms);
      const row = rows().first();
      await expect(row).toContainText(`Search Google for “${terms}”`);
      await expect(row).toHaveAttribute('aria-selected', 'true');
      const before = (await requests()).length;
      for (const init of [{ key: 'Enter', isComposing: true }, { key: 'Enter', keyCode: 229 }, { key: 'Enter', repeat: true }, { key: 'Enter', metaKey: true, shiftKey: true }]) {
        await input.dispatchEvent('keydown', init);
      }
      expect((await requests()).length).toBe(before);
      if (method === 'click') await row.click();
      else if (method === 'enter') await input.press('Enter');
      else if (method === 'shortcut') await input.press(shortcut);
      else if (method === 'footer') {
        await page.setViewportSize({ width: 390, height: 640 });
        const button = surface.getByRole('button', { name: 'Open in New Tab', exact: true });
        const bounds = await button.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
        await button.click();
      } else {
        await expect(surface.getByRole('button', { name: 'Open in Current Tab', exact: true })).toBeDisabled();
        // Only the primary action is disabled; a real right click must still open Actions.
        const bounds = (await row.boundingBox())!;
        await page.mouse.click(bounds.x + 30, bounds.y + bounds.height / 2, { button: 'right' });
        let menuInput = surface.getByRole('combobox', { name: 'Search actions' });
        await menuInput.press('Escape');
        await expect(input).toHaveValue(prefix + terms); await expect(input).toBeFocused();
        await input.press('Enter');
        expect((await requests()).length).toBe(before);
        await page.mouse.click(bounds.x + 30, bounds.y + bounds.height / 2, { button: 'right' });
        menuInput = surface.getByRole('combobox', { name: 'Search actions' });
        await menuInput.fill('新标签页');
        await expect(surface.locator('.action-row')).toHaveCount(1);
        await menuInput.press('Enter');
      }
      await expect(page.locator('.justonehop-frame')).toHaveCount(0);
      await expect.poll(async () => (await requests()).length).toBe(before + 1);
      const destination = new URL((await requests()).at(-1)!);
      expect(destination.origin + destination.pathname).toBe('https://www.google.com/search');
      expect([...destination.searchParams]).toEqual([['q', terms]]);
      expect(destination.hash).toBe('');
      await expect.poll(async () => worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0]?.url, source.windowId)).toBe(`${origin}/Google-destination${destination.search}`);
      const active = await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0], source.windowId);
      if (method === 'click' || method === 'enter') expect(active.id).toBe(source.id);
      else {
        expect(active.id).not.toBe(source.id);
        expect((await worker.evaluate(id => chrome.tabs.get(id), source.id)).url).toBe(`${origin}/Google-source`);
        await worker.evaluate(id => chrome.tabs.remove(id), active.id!);
      }
      await page.setViewportSize({ width: 1100, height: 760 });
    }
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage ?? [])).toEqual(
      expect.arrayContaining(['click', 'enter', 'shortcut', 'footer'].map(method => expect.objectContaining({
        query: `${method === 'shortcut' ? '谷歌搜索 ' : ''}UnmatchedSearch ${method} 中文 C++ & #part`.toLowerCase(), target: 'query:navigation',
      }))),
    );
  });

  test('Address navigation: exact existing results suppress the URL candidate but distinct destinations keep it', async () => {
    const page = await context.newPage(); await page.goto(`${origin}/Address-dedup-source`);
    const urls = { tab: `${origin}/Address-dedup-tab`, bookmark: `${origin}/Address-dedup-bookmark`, history: `${origin}/Address-dedup-history` };
    await worker.evaluate(async urls => {
      await chrome.tabs.create({ url: urls.tab, active: false });
      await chrome.bookmarks.create({ title: 'Saved address', url: urls.bookmark });
      await chrome.history.addUrl({ url: urls.history });
    }, urls);
    const surface = await openStorageOverlay(page);
    const input = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    const address = surface.locator('#justonehop-results .result').filter({ hasText: 'Go to URL' });
    for (const kind of ['tab', 'bookmark', 'history'] as const) {
      await input.fill(urls[kind]);
      await expect(surface.locator(`#justonehop-results .result.${kind}`)).toHaveCount(1);
      await expect(surface.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
      await expect(address).toHaveCount(0);
    }
    for (const suffix of ['/different', '?q=1', '#part']) {
      const target = `${urls.tab}${suffix}`;
      await input.fill(target);
      await expect(address).toHaveCount(1);
      await expect(address).toContainText(target);
    }
    await input.fill(`${origin}/Address-dedup-unseen`);
    await expect(address).toHaveCount(1);
    await expect(address).toHaveAttribute('aria-selected', 'true');
    await input.fill(urls.tab);
    await expect(surface.locator('#justonehop-results .result.tab')).toHaveAttribute('aria-selected', 'true');
    await expect(address).toHaveCount(0);
    await input.press('Enter');
    await expect(page.locator('.justonehop-frame')).toHaveCount(0);
    await expect.poll(async () => worker.evaluate(async url => (await chrome.tabs.query({ active: true })).some(tab => tab.url === url), urls.tab)).toBe(true);
    await expect(page).toHaveURL(`${origin}/Address-dedup-source`);
  });

  test('Address navigation: overlay mouse keyboard and menu open the selected address in the intended tab', async () => {
    const page = await context.newPage(); await page.goto(`${origin}/Address-source`);
    const source = await worker.evaluate(async url => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
      return { id: tab.id!, windowId: tab.windowId };
    }, page.url());
    const initialCount = await worker.evaluate(async () => (await chrome.tabs.query({})).length);
    const shortcut = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta+Enter' : 'Alt+Enter');
    for (const method of ['click', 'enter', 'shortcut', 'footer', 'menu'] as const) {
      const surface = await openStorageOverlay(page);
      const input = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
      const target = `${origin}/Address-${method}?Q=A%2Bb#Part`;
      await input.fill(target.replace('http://', ''));
      const row = surface.locator('#justonehop-results .result').first();
      await expect(row).toHaveText(/Go to URL/);
      await expect(row).toContainText(target);
      await expect(row).toHaveAttribute('aria-selected', 'true');
      for (const init of [{ key: 'Enter', isComposing: true }, { key: 'Enter', keyCode: 229 }, { key: 'Enter', repeat: true, metaKey: true }, { key: 'Enter', metaKey: true, shiftKey: true }]) {
        await input.dispatchEvent('keydown', init);
      }
      expect(await worker.evaluate(async id => (await chrome.tabs.get(id)).url, source.id)).toBe(page.url());
      expect(await worker.evaluate(async () => (await chrome.tabs.query({})).length)).toBe(initialCount);
      if (method === 'click') await row.click();
      else if (method === 'enter') await input.press('Enter');
      else if (method === 'shortcut') await input.press(shortcut);
      else if (method === 'footer') {
        await page.setViewportSize({ width: 390, height: 640 });
        const button = surface.getByRole('button', { name: 'Open in New Tab', exact: true });
        await expect(button).toBeVisible();
        const bounds = await button.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
        await button.click();
      } else {
        await row.click({ button: 'right' });
        const menuInput = surface.getByRole('combobox', { name: 'Search actions' });
        await menuInput.fill('新标签页');
        await expect(surface.locator('.action-row')).toHaveCount(1);
        await menuInput.press('Enter');
      }
      await expect(page.locator('.justonehop-frame')).toHaveCount(0);
      if (method === 'click' || method === 'enter') {
        await expect(page).toHaveURL(target);
        expect(await worker.evaluate(async () => (await chrome.tabs.query({})).length)).toBe(initialCount);
      } else {
        await expect.poll(async () => worker.evaluate(async ({ windowId, target }) => {
          const tab = (await chrome.tabs.query({ windowId, active: true }))[0];
          return tab?.url === target ? tab.id : undefined;
        }, { windowId: source.windowId, target })).not.toBeUndefined();
        const created = await worker.evaluate(async ({ windowId, target }) => (await chrome.tabs.query({ windowId })).find(tab => tab.url === target)!, { windowId: source.windowId, target });
        expect(created.id).not.toBe(source.id);
        expect(await worker.evaluate(async () => (await chrome.tabs.query({})).length)).toBe(initialCount + 1);
        expect(await worker.evaluate(async id => (await chrome.tabs.get(id)).url, source.id)).toBe(`${origin}/Address-enter?Q=A%2Bb#Part`);
        await worker.evaluate(id => chrome.tabs.remove(id), created.id!);
      }
      await page.setViewportSize({ width: 1100, height: 760 });
    }
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage ?? [])).toEqual(
      expect.arrayContaining(['click', 'enter', 'shortcut', 'footer'].map(method => expect.objectContaining({
        query: `${origin}/Address-${method}?Q=A%2Bb#Part`.replace('http://', '').toLowerCase(), target: 'query:navigation',
      }))),
    );
  });
});

test.describe('headed', { tag: '@headed' }, () => {
test.use({ environment: { ...defaults, locale: 'en-US', commands: true, headed: true } });
test('Google search: native panel opens current and new tabs in its source window', async () => {
    await context.route('https://www.google.com/search?**', route => route.fulfill({ contentType: 'text/html', body: '<title>Search destination</title>' }));
    for (const newTab of [false, true]) {
      const { source, palette } = await openNativePalette();
      const input = palette.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
      const terms = `NativeSearch ${newTab} 中文 & C++`;
      await input.fill(`google ${terms}`);
      await expect(palette.locator('#justonehop-results .result').first()).toContainText(`Search Google for “${terms}”`);
      const shortcut = newTab ? await palette.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta+Enter' : 'Alt+Enter') : 'Enter';
      await input.press(shortcut).catch(error => { if (!palette.isClosed()) throw error; });
      await expect.poll(() => palette.isClosed()).toBe(true);
      await expect.poll(async () => worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0]?.url, source.windowId)).toMatch(/^https:\/\/www.google.com\/search\?/);
      const active = await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0], source.windowId);
      expect(new URL(active.url!).searchParams.get('q')).toBe(terms);
      expect(active.id === source.tabId).toBe(!newTab);
      if (newTab) expect((await worker.evaluate(id => chrome.tabs.get(id), source.tabId)).url).toBe('chrome://version/');
    }
  });
});

test.describe('headed', { tag: '@headed' }, () => {
test.use({ environment: { ...defaults, locale: 'en-US', commands: true, headed: true } });
test('Address navigation: native panel navigates its source and opens new tabs in the source window', async () => {
    for (const newTab of [false, true]) {
      const { source, palette } = await openNativePalette();
      const input = palette.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
      const target = `${origin}/Address-native-${newTab ? 'new' : 'current'}?Q=A%2Bb#Part`;
      const before = await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId })).map(tab => tab.id), source.windowId);
      await input.fill(target);
      await expect(palette.locator('#justonehop-results .result').first()).toHaveAttribute('aria-selected', 'true');
      const shortcut = newTab ? await palette.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta+Enter' : 'Alt+Enter') : 'Enter';
      await input.press(shortcut).catch(error => { if (!palette.isClosed()) throw error; });
      await expect.poll(() => palette.isClosed()).toBe(true);
      await expect.poll(async () => worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0]?.url, source.windowId)).toBe(target);
      const tabs = await worker.evaluate(windowId => chrome.tabs.query({ windowId }), source.windowId);
      expect(tabs).toHaveLength(before.length + Number(newTab));
      expect(tabs.find(tab => tab.id === source.tabId)?.url).toBe(newTab ? 'chrome://version/' : target);
      expect(tabs.find(tab => tab.url === target)?.id === source.tabId).toBe(!newTab);
    }
  });
});

for (const mode of ['create', 'reuse'] as const) test.describe('headed', { tag: '@headed' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true, headed: true } });
  test(`Chrome Pages: native standalone popup ${mode}s only in its source window and preserves other routes`, async () => {
    const owner = await ui.evaluate(async () => (await chrome.tabs.getCurrent())!.windowId);
    // Finish all setup before launching the popup: a newly focused window after
    // launch would correctly dismiss it and invalidate the interaction under test.
    const seeded = await worker.evaluate(async ({ windowId, reuse }) => {
      const sibling = await chrome.tabs.create({ windowId, url: 'chrome://extensions/shortcuts', active: false });
      const exact = reuse ? await chrome.tabs.create({ windowId, url: 'chrome://extensions/', active: false, pinned: true }) : undefined;
      const other = await chrome.windows.create({ url: 'chrome://extensions/', focused: false });
      await chrome.windows.update(windowId, { focused: true });
      return { siblingId: sibling.id!, exactId: exact?.id, otherWindowId: other!.id!, otherTabId: other!.tabs![0].id! };
    }, { windowId: owner, reuse: mode === 'reuse' });
    for (const id of [seeded.siblingId, seeded.otherTabId, ...(seeded.exactId === undefined ? [] : [seeded.exactId])]) {
      // Native WebUI tabs may defer loading in the background. Finish fixture
      // navigation in the foreground before establishing the panel's source.
      await worker.evaluate(async tabId => {
        await chrome.tabs.update(tabId, { active: true });
        const tab = await chrome.tabs.get(tabId);
        await chrome.windows.update(tab.windowId, { focused: true });
      }, id);
      await expect.poll(() => worker.evaluate(async tabId => (await chrome.tabs.get(tabId)).status, id)).toBe('complete');
    }
    // A completed WebUI navigation can still display a different client route.
    // Establish the sibling route before testing exact-URL creation or reuse.
    const siblingPage = context.pages().find(page => page.url() === 'chrome://extensions/shortcuts');
    expect(siblingPage, 'The fixture must retain the shortcuts route before opening the panel').toBeDefined();
    await expectChromePageLoaded(siblingPage!, { url: 'chrome://extensions/shortcuts', root: 'extensions-keyboard-shortcuts' });
    await worker.evaluate(windowId => chrome.windows.update(windowId, { focused: true }), owner);
    const { source, palette } = await openNativePalette();
    expect(source.windowId).toBe(owner);
    const popupWindow = await palette.evaluate(() => chrome.windows.getCurrent());
    expect(popupWindow.type).toBe('popup');
    expect(popupWindow.id).not.toBe(owner);
    const before = await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId })).map(tab => tab.id!).sort((a, b) => a - b), owner);
    const search = palette.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await search.fill('extensions');
    await expect(palette.locator('#justonehop-results [role="option"]').first()).toHaveAttribute('id', 'justonehop-command:openExtensions');
    expect(await worker.evaluate(id => chrome.tabs.get(id), seeded.siblingId)).toMatchObject({ windowId: owner, url: 'chrome://extensions/shortcuts', status: 'complete' });
    await search.press('Enter').catch(error => { if (!palette.isClosed()) throw error; });
    await expect.poll(() => palette.isClosed()).toBe(true);
    await expect.poll(() => worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0]?.url, owner)).toBe('chrome://extensions/');
    const after = await worker.evaluate(async windowId => chrome.tabs.query({ windowId }), owner);
    const matches = after.filter(tab => tab.url === 'chrome://extensions/');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ windowId: owner, active: true });
    if (mode === 'reuse') {
      expect(matches[0]).toMatchObject({ id: seeded.exactId, pinned: true });
      expect(after.map(tab => tab.id!).sort((a, b) => a - b)).toEqual(before);
    } else {
      expect(before).not.toContain(matches[0].id);
      expect(after.map(tab => tab.id!).sort((a, b) => a - b)).toEqual([...before, matches[0].id!].sort((a, b) => a - b));
    }
    expect(await worker.evaluate(id => chrome.tabs.get(id), source.tabId)).toMatchObject({ windowId: owner, url: 'chrome://version/' });
    expect(await worker.evaluate(id => chrome.tabs.get(id), seeded.siblingId)).toMatchObject({ windowId: owner, url: 'chrome://extensions/shortcuts' });
    expect(await worker.evaluate(id => chrome.tabs.get(id), seeded.otherTabId)).toMatchObject({ windowId: seeded.otherWindowId, url: 'chrome://extensions/', active: true });
    expect(await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId })).map(tab => tab.id), seeded.otherWindowId)).toEqual([seeded.otherTabId]);
    // Both windows have this URL. Inspect both WebUIs so a loaded page in the
    // other window cannot mask a failed navigation in the source window.
    await expect.poll(() => context.pages().filter(page => page.url() === 'chrome://extensions/').length).toBe(2);
    for (const page of context.pages().filter(page => page.url() === 'chrome://extensions/')) {
      await expectChromePageLoaded(page, { url: 'chrome://extensions/', root: 'extensions-manager' });
    }
  });
});
