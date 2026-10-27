import { expect } from '@playwright/test';
import type { UsageRecord } from '../src/usage';
import { test, defaults, origin, context, ui, worker, popupUrl, setUI } from './support/paletteFixture';
import { registerPaletteFixture } from './support/paletteFixture';

registerPaletteFixture();

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test('History search remains available after same-document navigation', async () => {
    const savedUrl = `${origin}/Agent-Knowledge-Index`;
    const visited = await context.newPage();
    await visited.goto(savedUrl);
    await expect.poll(() => worker.evaluate(async url => (await chrome.history.search({ text: 'index', startTime: 0 }))
      .some(item => item.url === url && item.title === 'Agent Knowledge Index'), savedUrl)).toBe(true);
    await visited.close();
    const source = await context.newPage();
    await source.goto(`${origin}/wiki/original`);
    const tabId = await worker.evaluate(async url => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
      await chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ['content.js'] });
      return tab.id!;
    }, source.url());
    await source.evaluate(() => history.pushState({}, '', '/wiki/another-document'));
    await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { source: 'justonehop', type: 'toggle' }), tabId);
    const surface = source.frameLocator('.justonehop-frame');
    const input = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await input.fill('index');
    await expect(surface.locator('.result.history')).toHaveCount(1);
    await surface.locator('#justonehop-search-all-history').click();
    await expect(surface.locator('.history-view .result.history')).toHaveCount(1);
    await expect(surface.locator('.history-view .result.history .entry-title')).toHaveText('Agent Knowledge Index');
    await surface.getByRole('combobox', { name: 'Search browsing history', exact: true }).press('Escape');
    await expect(input).toBeFocused();
    await expect(surface.locator('#justonehop-search-all-history')).toHaveAttribute('aria-selected', 'true');
    await input.press('ArrowUp');
    await expect(surface.locator('.result.history')).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
    await expect(source).toHaveURL(savedUrl);
  });

  test('History search: pinyin recall, seventh entry, real visits, and overlay navigation', async () => {
    await test.step('History pinyin recalls a visited Chinese title through main and all-history search', async () => {
      const url = `${origin}/pinyin-history-page`;
      const visited = await context.newPage();
      await visited.route(url, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>产品路线图</title><h1>产品路线图</h1>' }));
      await visited.goto(url);
      await expect.poll(() => worker.evaluate(async url => (await chrome.history.search({ text: '产品路线图', startTime: 0 })).some(item => item.url === url), url)).toBe(true);
      await visited.close();
      await ui.bringToFront();
      const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
      await input.fill('cplxt');
      await expect(ui.locator('.result.history .entry-title')).toHaveText('产品路线图');
      await expect(ui.locator('.result.history .entry-title mark')).toHaveText('产品路线图');
      await ui.locator('#justonehop-search-all-history').click();
      const full = ui.getByRole('combobox', { name: 'Search browsing history', exact: true });
      await full.fill('chanpinluxiantu');
      await expect(ui.locator('.history-view .result.history .entry-title')).toHaveText('产品路线图');
      await full.press('Escape');
      await expect(input).toHaveValue('cplxt');
      await expect(input).toBeFocused();
    });

    await test.step('Seventh entry follows six results and real visits support mouse opening and keyboard return', async () => {
      const query = 'JustOneHopHistoryNative';
      const urls = ['mouse', 'keyboard', 'third', 'fourth', 'fifth', 'sixth', 'seventh'].map(suffix => `${origin}/${query}-${suffix}`);
      const baseline: UsageRecord[] = [{ query: 'unrelated', target: 'command:newTab', weight: 1, lastUsed: Date.now() }];
      await worker.evaluate(async ({ urls, baseline }) => {
        await chrome.storage.local.set({ searchUsage: baseline });
        for (const url of urls) await chrome.history.addUrl({ url });
      }, { urls, baseline });
      // Independently confirm the fixture reached Chrome's actual history database.
      const visits = await worker.evaluate(text => chrome.history.search({ text, startTime: 0 }), query);
      expect(visits.map(visit => visit.url).sort()).toEqual([...urls].sort());
      expect(visits.every(visit => typeof visit.lastVisitTime === 'number')).toBe(true);
      const owner = await ui.evaluate(async () => (await chrome.tabs.getCurrent())!.windowId);
      const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
      const allHistory = ui.locator('#justonehop-search-all-history');
      await search.fill(query);
      await expect(ui.locator('.result.history')).toHaveCount(urls.length);
      const mainTimes = await ui.locator('.result.history time').evaluateAll(nodes => nodes.map(node => ({ id: node.closest('.result')!.id, text: node.textContent, dateTime: node.getAttribute('datetime'), title: node.getAttribute('title') })));
      expect(mainTimes).toHaveLength(urls.length);
      expect(mainTimes.every(time => time.text === 'just now' && time.title?.startsWith('Last visited: '))).toBe(true);
      expect(mainTimes.map(time => Date.parse(time.dateTime!)).sort()).toEqual(visits.map(visit => Math.trunc(visit.lastVisitTime!)).sort());

      await expect(allHistory.locator('.entry-title')).toHaveText('Search All History');
      await expect(ui.locator('#justonehop-results .result').nth(6)).toHaveAttribute('id', 'justonehop-search-all-history');
      await ui.locator('.palette').screenshot({ path: test.info().outputPath('history-main-regular.png') });
      await search.press('Home'); await search.press('Shift+ArrowRight');
      for (let step = 0; step < 6; step++) await search.press('ArrowDown');
      await expect(allHistory).toHaveAttribute('aria-selected', 'true');
      await search.press('Enter');
      const historySearch = ui.getByRole('combobox', { name: 'Search browsing history', exact: true });
      await expect(historySearch).toBeFocused(); await expect(historySearch).toHaveValue(query);
      await expect(ui.locator('.history-view .result.history')).toHaveCount(urls.length);
      expect(await ui.locator('.history-view .result.history time').evaluateAll(nodes => nodes.map(node => ({ id: node.closest('.result')!.id, text: node.textContent, dateTime: node.getAttribute('datetime'), title: node.getAttribute('title') })))).toEqual(mainTimes);
      await expect(ui.locator('.history-view .history-kind')).toHaveCount(0);

      await ui.setViewportSize({ width: 390, height: 600 });
      await expect(historySearch).toBeVisible();
      await expect(ui.locator('.history-view .search-focus.is-back')).toBeVisible();
      expect(await ui.locator('.history-view').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await ui.locator('.history-view').screenshot({ path: test.info().outputPath('history-full-narrow.png') });
      await ui.setViewportSize({ width: 1100, height: 760 });
      await historySearch.press('Escape');
      await expect(search).toBeFocused(); await expect(search).toHaveValue(query);
      await expect(allHistory).toHaveAttribute('aria-selected', 'true');
      expect(await search.evaluate(el => [(el as HTMLInputElement).selectionStart, (el as HTMLInputElement).selectionEnd])).toEqual([0, 1]);
      // Mouse entry and header return preserve the same root context.
      await allHistory.click(); await expect(historySearch).toBeFocused();
      await ui.locator('.history-view .search-focus.is-back').click();
      await expect(search).toBeFocused(); await expect(search).toHaveValue(query);
      // This scenario follows a new tab; the default current-tab path is covered by Saved pages.
      await ui.locator('.result.history').filter({ hasText: `${query}-mouse` }).hover();
      const mouseOpened = context.waitForEvent('page');
      await ui.getByRole('button', { name: 'Open in New Tab', exact: true }).click();
      const mousePage = await mouseOpened;
      await expect(mousePage).toHaveURL(urls[0]);
      await expect(mousePage.getByRole('heading')).toHaveText(`${query} mouse`);
      await expect.poll(() => ui.isClosed()).toBe(true);
      expect(await worker.evaluate(async url => (await chrome.tabs.query({})).filter(tab => tab.url === url).map(tab => tab.windowId), urls[0])).toEqual([owner]);
      await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual(expect.arrayContaining([
        ...baseline, expect.objectContaining({ query: query.toLowerCase(), target: `tab:${urls[0]}`, weight: 1 }),
      ]));

      setUI(await context.newPage()); await ui.goto(popupUrl);
      const root = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
      await root.fill(`${query}-keyboard`);
      await expect(ui.locator('.result.history')).toHaveCount(1);
      await expect(ui.locator('#justonehop-results .result')).toHaveCount(3);
      await expect(ui.locator('#justonehop-results .result').nth(1)).toHaveAttribute('id', 'justonehop-search-all-history');
      await expect(ui.locator('#justonehop-results .result').last()).toHaveAttribute('id', /^justonehop-google:/);
      await root.press('ArrowDown');
      await expect(ui.locator('#justonehop-search-all-history')).toHaveAttribute('aria-selected', 'true');
      await root.press('Enter');
      const fullSearch = ui.getByRole('combobox', { name: 'Search browsing history', exact: true });
      await expect(fullSearch).toBeFocused();
      await expect(ui.locator('.history-view .result.history')).toHaveCount(1);
      const keyboardOpened = context.waitForEvent('page');
      const newTabShortcut = await ui.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta+Enter' : 'Alt+Enter');
      // The action closes the palette between keydown and keyup; verify the destination below.
      await fullSearch.press(newTabShortcut).catch(error => { if (!ui.isClosed()) throw error; });
      const keyboardPage = await keyboardOpened;
      await expect(keyboardPage).toHaveURL(urls[1]);
      await expect(keyboardPage.getByRole('heading')).toHaveText(`${query} keyboard`);
      await expect.poll(() => ui.isClosed()).toBe(true);
      await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual(expect.arrayContaining([
        ...baseline, expect.objectContaining({ query: `${query.toLowerCase()}-keyboard`, target: `tab:${urls[1]}`, weight: 1 }),
      ]));
    });

    await test.step('History overlay: source permissions, action menu and narrow viewport retain navigation', async () => {
      const query = 'JustOneHopOverlayHistory';
      const url = `${origin}/${query}-saved`;
      await worker.evaluate(url => chrome.history.addUrl({ url }), url);
      const page = await context.newPage();
      await page.setViewportSize({ width: 390, height: 600 });
      await page.goto(`${origin}/history-source`);
      const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, page.url());
      await worker.evaluate(async tabId => {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
        await chrome.tabs.sendMessage(tabId, { source: 'justonehop', type: 'toggle' });
      }, tabId);
      const surface = page.frameLocator('.justonehop-frame');
      const input = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
      await input.fill(query);
      await expect(surface.locator('.result.history')).toHaveCount(1);
      await surface.locator('#justonehop-search-all-history').click();
      await expect(surface.locator('.history-view .result.history')).toHaveCount(1);
      await expect(surface.locator('.history-view time')).toHaveText('just now');
      const timestamp = await surface.locator('.history-view time').boundingBox();
      const title = await surface.locator('.history-view .entry-title').boundingBox();
      expect(title!.width).toBeGreaterThan(40);
      expect(title!.x + title!.width).toBeLessThanOrEqual(timestamp!.x);
      const box = await surface.locator('.history-view').boundingBox();
      expect(box!.width).toBeLessThanOrEqual(390);
      await surface.locator('.history-view').screenshot({ path: test.info().outputPath('history-overlay-narrow.png') });
      await surface.locator('.history-view .result.history').click({ button: 'right' });
      await expect(surface.getByRole('combobox', { name: 'Search actions' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(surface.getByRole('combobox', { name: 'Search browsing history' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(input).toBeFocused(); await expect(input).toHaveValue(query);
      await surface.locator('.result.history').click({ button: 'right' });
      await expect(surface.getByRole('combobox', { name: 'Search actions' })).toBeFocused();
      const beforeTabs = await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => tab.id));
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(url);
      expect((await worker.evaluate(id => chrome.tabs.get(id), tabId)).url).toBe(url);
      expect(await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => tab.id))).toEqual(beforeTabs);
      await expect(page.locator('.justonehop-frame')).toHaveCount(0);
    });
  });
});
