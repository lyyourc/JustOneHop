import { test as base, expect } from '@playwright/test';
import { pressNativeEnter } from './support/nativeInput';
import { resolve } from 'node:path';
import type { UsageRecord } from '../src/usage';
import { test, defaults, origin, context, ui, worker, popupUrl, setUI } from './support/paletteFixture';
import { openStorageOverlay } from './support/paletteHelpers';
import { registerPaletteFixture } from './support/paletteFixture';

registerPaletteFixture();

test.describe(() => {
test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
test('History learning: c2c-web selection survives history-to-tab transition and forgets across views', async () => {
    const targetUrl = `${origin}/gitlab/c2c-web`;
    const otherUrl = `${origin}/other/c2c-web`;
    for (const url of [targetUrl, otherUrl]) {
      const visit = await context.newPage(); await visit.goto(url); await visit.close();
    }
    await ui.bringToFront();
    const input = () => ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await input().fill('c2c-web');
    await expect(ui.locator('.result.history')).toHaveCount(2);
    const target = ui.locator('.result.history').filter({ hasText: 'gitlab/c2c-web' });
    await input().press('Home');
    await input().press('Meta+ArrowUp');
    for (let step = 0; step < 2 && await target.getAttribute('aria-selected') !== 'true'; step++) await input().press('ArrowDown');
    await expect(target).toHaveAttribute('aria-selected', 'true');
    const opened = context.waitForEvent('page');
    await ui.getByRole('button', { name: 'Open in New Tab', exact: true }).click();
    const openedPage = await opened;
    await expect(openedPage).toHaveURL(targetUrl);
    await expect.poll(() => ui.isClosed()).toBe(true);
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage?.[0])).toMatchObject({ query: 'c2c-web', target: `tab:${targetUrl}`, weight: 1 });
    setUI(await context.newPage()); await ui.goto(popupUrl);
    await input().fill('c2c-web');
    const tab = ui.locator('.result.tab').filter({ hasText: 'gitlab/c2c-web' });
    await expect(tab.locator('button.ranking-forget')).toBeVisible();
    await expect(tab.locator('button.ranking-forget')).toHaveAccessibleName('Forget Preference for This Query');
    await expect(ui.locator('.ranking-badge')).toHaveCount(0);
    await expect(ui.locator('.result.history').filter({ hasText: 'gitlab/c2c-web' })).toHaveCount(0);
    await openedPage.close();
    await worker.evaluate(async url => chrome.history.addUrl({ url }), otherUrl);
    await input().fill(''); await input().fill('c2c-web');
    await expect(ui.locator('.result.history').filter({ hasText: 'gitlab/c2c-web' })).toHaveCount(1);
    await expect(ui.locator('.result.history').first()).toContainText('gitlab/c2c-web');
    await expect(ui.locator('.result.history').first().locator('button.ranking-forget')).toHaveAttribute('data-promoted', 'true');
    await ui.locator('#justonehop-search-all-history').click();
    const fullSearch = ui.getByRole('combobox', { name: 'Search browsing history', exact: true });
    await expect(fullSearch).toHaveValue('c2c-web');
    const fullTarget = ui.locator('.history-view .result.history').filter({ hasText: 'gitlab/c2c-web' });
    const forget = fullTarget.locator('button.ranking-forget');
    await expect(forget).toHaveAttribute('data-promoted', 'true');
    await expect(forget).toHaveAccessibleName('Forget Preference for This Query');
    await expect(forget).toHaveAttribute('tabindex', '0');
    await expect(ui.getByRole('tooltip')).toHaveCount(0);
    await fullSearch.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
    const beforeTabs = await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url })));
    // Actions no longer duplicates the inline explanation or forget action.
    await fullSearch.press('Meta+k');
    await expect(ui.getByRole('dialog')).toBeVisible();
    await expect(ui.locator('.action-description')).toHaveCount(0);
    await expect(ui.getByRole('dialog').getByRole('option', { name: 'Forget Preference for This Query', exact: false })).toHaveCount(0);
    await ui.getByRole('combobox', { name: 'Search actions' }).press('Shift+Backspace');
    await ui.keyboard.press('Escape');
    await expect(forget).toBeVisible();
    // Tab reaches the selected row's icon; Space forgets without opening history.
    for (let step = 0; step < 8 && !await forget.evaluate(node => node.matches(':focus')); step++) await ui.keyboard.press('Tab');
    await expect(forget).toBeFocused();
    const tooltip = ui.getByRole('tooltip');
    await expect(tooltip).toHaveClass(/ranking-tooltip/);
    await expect(tooltip).toHaveText('Forget Preference for This QueryShift+BackspaceMoved up by your preferences.');
    await ui.locator('.history-view').screenshot({ path: test.info().outputPath('history-learned-tooltip.png') });
    const historyRows = ui.locator('.history-view .result.history');
    const learnedOrder = await historyRows.evaluateAll(nodes => nodes.map(node => node.id));
    const historyScroll = await ui.locator('#justonehop-history-results').evaluate(node => node.scrollTop);
    await expect(fullTarget).toHaveAttribute('aria-selected', 'true');
    await ui.keyboard.press('Space');
    await expect(ui.getByRole('dialog')).toHaveCount(0);
    await expect(fullSearch).toBeFocused();
    await expect(fullSearch).toHaveValue('c2c-web');
    expect(await fullSearch.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
    await expect(fullTarget).toHaveAttribute('aria-selected', 'true');
    expect(await historyRows.evaluateAll(nodes => nodes.map(node => node.id))).toEqual(learnedOrder);
    expect(await ui.locator('#justonehop-history-results').evaluate(node => node.scrollTop)).toBe(historyScroll);
    await expect(ui.locator('button.ranking-forget')).toHaveCount(0);
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual([]);
    await fullSearch.fill('other/c2c-web');
    await expect(historyRows).toHaveCount(1);
    await fullSearch.fill('c2c-web');
    await expect(historyRows.first()).toContainText('other/c2c-web');
    // The full-history list also owns Shift+Backspace, with the same IME/repeat guards.
    await worker.evaluate(async url => chrome.storage.local.set({ searchUsage: [{ query: 'c2c-web', target: `tab:${url}`, weight: 1, lastUsed: Date.now() }] }), targetUrl);
    await expect(forget).toBeVisible();
    await expect(historyRows.first()).toContainText('gitlab/c2c-web');
    await fullSearch.press('Meta+ArrowUp');
    await expect(fullTarget).toHaveAttribute('aria-selected', 'true');
    await fullSearch.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
    const shortcutOrder = await historyRows.evaluateAll(nodes => nodes.map(node => node.id));
    const shortcutScroll = await ui.locator('#justonehop-history-results').evaluate(node => node.scrollTop);
    for (const guard of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { metaKey: true }]) {
      await fullSearch.dispatchEvent('keydown', { key: 'Backspace', shiftKey: true, ...guard });
    }
    expect(await worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage: UsageRecord[] }>('searchUsage')).searchUsage)).toEqual([
      expect.objectContaining({ query: 'c2c-web', target: `tab:${targetUrl}` }),
    ]);
    await fullSearch.press('Shift+Backspace');
    await expect(forget).toHaveCount(0);
    await expect(fullSearch).toBeFocused();
    await expect(fullSearch).toHaveValue('c2c-web');
    expect(await fullSearch.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
    await expect(fullTarget).toHaveAttribute('aria-selected', 'true');
    expect(await historyRows.evaluateAll(nodes => nodes.map(node => node.id))).toEqual(shortcutOrder);
    expect(await ui.locator('#justonehop-history-results').evaluate(node => node.scrollTop)).toBe(shortcutScroll);
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual([]);
    await fullSearch.press('Escape');
    await expect(input()).toBeFocused();
    // The root view did not perform the forget and receives the storage update normally.
    await expect(ui.locator('.result.history').first()).toContainText('other/c2c-web');
    await worker.evaluate(async url => chrome.storage.local.set({ searchUsage: [{ query: 'c2c-web', target: `tab:${url}`, weight: 1, lastUsed: Date.now() }] }), targetUrl);
    await expect(ui.locator('.result.history').first()).toContainText('gitlab/c2c-web');
    await input().press('Meta+ArrowUp');
    await expect(ui.locator('.result.history').first()).toHaveAttribute('aria-selected', 'true');
    await input().evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
    const rootOrder = await ui.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id));
    const rootScroll = await ui.locator('#justonehop-results').evaluate(node => node.scrollTop);
    await input().press('Shift+Backspace');
    await expect(ui.locator('button.ranking-forget')).toHaveCount(0);
    expect(await ui.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(rootOrder);
    await expect(ui.locator('.result.history').first()).toHaveAttribute('aria-selected', 'true');
    expect(await ui.locator('#justonehop-results').evaluate(node => node.scrollTop)).toBe(rootScroll);
    await expect(input()).toBeFocused();
    await expect(input()).toHaveValue('c2c-web');
    expect(await input().evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual([]);
    expect(await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url })))).toEqual(beforeTabs);
    expect(ui.isClosed()).toBe(false);
    await ui.close();
    setUI(await context.newPage()); await ui.goto(popupUrl);
    await input().fill('c2c-web');
    await expect(ui.locator('.result.history').first()).toContainText('other/c2c-web');
    await expect(ui.locator('button.ranking-forget')).toHaveCount(0);
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English learned ranking follows successful selections, survives reopening tabs, and resets across palettes', async () => {
  const target = await context.newPage();
  await target.goto(`${origin}/EchoTech-IAM`);
  await ui.evaluate(async base => {
    const bookmark = await chrome.bookmarks.create({ title: 'Team IAM Handbook', url: `${base}/Handbook` });
    await chrome.storage.local.set({ searchUsage: [{ query: 'iam', target: `bookmark:${bookmark.id}`, weight: 0.5, lastUsed: Date.now() }] });
  }, origin);
  const reopen = async () => {
    setUI(await context.newPage()); await ui.goto(popupUrl);
    const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await expect(input).toBeFocused();
    await input.fill('iam');
    return input;
  };
  const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await ui.bringToFront(); await input.fill('iam');
  await expect(ui.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
  await expect(ui.locator('.result').first()).toContainText('IAM Handbook');
  await input.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  await expect(ui.locator('.result[aria-selected="true"]')).toContainText('IAM Handbook');
  await input.press('ArrowDown');
  await expect(ui.locator('.result[aria-selected="true"]')).toContainText('EchoTech IAM');
  await input.press('Enter');
  await expect.poll(() => ui.isClosed()).toBe(true);
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage?.[0]?.query)).toBe('iam');
  setUI(await context.newPage()); await ui.goto(popupUrl);
  const again = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await expect(again).toHaveValue('');
  await expect(ui.locator('.query-completion')).toHaveText('iam');
  await ui.getByRole('button', { name: 'Continue Search', exact: true }).click();
  await expect(again).toHaveValue('iam');
  await again.fill(''); await again.fill('i');
  await expect(ui.locator('.query-completion')).toHaveText('iam');
  await again.press('Tab'); await expect(again).toHaveValue('iam');
  await expect(ui.locator('.result').first()).toContainText('EchoTech IAM');
  await again.press('Enter');
  await expect.poll(() => ui.isClosed()).toBe(true);
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage?.[0]?.weight)).toBeGreaterThan(1.99);
  // A recreated tab receives a different browser ID. Preference follows its URL.
  await target.close();
  const restored = await context.newPage(); await restored.goto(`${origin}/EchoTech-IAM`);
  await reopen();
  await expect(ui.locator('.result').first()).toContainText('EchoTech IAM');
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('learned-ranking.png') });
  await ui.reload();
  await ui.getByRole('combobox').fill(' IAM ');
  await expect(ui.locator('.result').first()).toContainText('EchoTech IAM');
  const observer = await context.newPage(); await observer.goto(popupUrl);
  await observer.getByRole('combobox').fill('iam');
  await expect(observer.locator('.result').first()).toContainText('EchoTech IAM');
  await ui.getByRole('button', { name: 'Settings', exact: true }).click();
  await ui.getByRole('button', { name: 'Reset Ranking', exact: true }).click();
  await expect(ui.getByRole('status')).toContainText('Default ordering restored');
  await expect(observer.locator('.result').first()).toContainText('EchoTech IAM');
  expect(await worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage)).toBeUndefined();
  await observer.getByRole('combobox').fill(''); await observer.getByRole('combobox').fill('i');
  await expect(observer.locator('.query-completion')).toHaveCount(0);
  await ui.getByRole('button', { name: 'Reset Ranking', exact: true }).scrollIntoViewIfNeeded();
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('ranking-settings.png') });
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English canceled and failed selections do not train, while opening settings does', async () => {
  const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await input.fill('new tab');
  await input.press('ArrowDown'); // Highlighting alone is not a selection.
  // window.close() can destroy the target between Escape keydown and keyup.
  await ui.keyboard.press('Escape').catch(error => { if (!ui.isClosed()) throw error; });
  await expect.poll(() => ui.isClosed()).toBe(true);
  expect(await worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage)).toBeUndefined();
  setUI(await context.newPage()); await ui.goto(popupUrl);
  const response = await ui.evaluate(async () => {
    const self = (await chrome.tabs.getCurrent())!;
    return chrome.runtime.sendMessage({ source: 'justonehop', type: 'execute', payload: { action: 'switch', windowId: self.windowId, tabId: 999999, query: 'iam' } });
  });
  expect(response.ok).toBe(false);
  expect(await worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage)).toBeUndefined();
  await ui.getByRole('combobox').fill('language');
  await ui.getByRole('combobox').press('Enter');
  await expect(ui.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage?.[0]?.target)).toBe('command:settings:language');
  expect(await worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage?.[0]?.query)).toBe('language');
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, pageAccess: true } });
  test('overlay learning survives reloading the page that owns the palette', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Usage-fixture`);
  await page.bringToFront();
  const tabId = await worker.evaluate(async base => (await chrome.tabs.query({})).find(tab => tab.url === `${base}/Usage-fixture`)!.id!, origin);
  await worker.evaluate(async id => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(id, { source: 'justonehop', type: 'toggle' });
  }, tabId);
  const cdp = await context.newCDPSession(page);
  const ax = async () => {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
    return (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes;
  };
  await expect.poll(async () => (await ax()).some(node => node.role?.value === 'combobox')).toBe(true);
  await page.keyboard.type('reload');
  await expect.poll(async () => (await ax()).find(node => node.role?.value === 'combobox')?.value?.value).toBe('reload');
  await expect.poll(async () => (await ax()).some(node => node.role?.value === 'option' && node.properties?.some(property => property.name === 'selected' && property.value.value === true) && /刷新|Reload/.test(String(node.name?.value)))).toBe(true);
  await Promise.all([page.waitForEvent('load'), pressNativeEnter(cdp, page)]);
  await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage?.[0]?.target)).toBe('command:reload');
  expect(await worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage?.[0]?.query)).toBe('reload');
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', shadow: 'open', pageAccess: true } });
  test('Ranking tab learning shows a saved preference after a zed overlay tab switch', async () => {
    const source = await context.newPage(); await source.goto(`${origin}/zed-source`);
    const targetPage = await context.newPage(); await targetPage.goto(`${origin}/zed`);
    const ids = await worker.evaluate(async ({ sourceUrl, targetUrl }) => {
      const tabs = await chrome.tabs.query({});
      return { source: tabs.find(tab => tab.url === sourceUrl)!.id!, target: tabs.find(tab => tab.url === targetUrl)!.id! };
    }, { sourceUrl: source.url(), targetUrl: targetPage.url() });
    // Load the destination's content script before learning, then reuse it after the switch.
    await worker.evaluate(async tabId => {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tabId, { source: 'justonehop', type: 'toggle' });
    }, ids.target);
    const reopened = targetPage.frameLocator('.justonehop-frame');
    await reopened.getByRole('combobox').fill('zed');
    await expect(reopened.locator('.result.tab')).toHaveCount(2);
    await expect(reopened.locator('button.ranking-forget')).toHaveCount(0);
    await reopened.getByRole('combobox').press('Escape');
    await expect(targetPage.locator('#justonehop-command-palette')).not.toBeAttached();
    await source.bringToFront();
    await worker.evaluate(async tabId => {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tabId, { source: 'justonehop', type: 'toggle' });
    }, ids.source);
    const sourceSurface = source.frameLocator('.justonehop-frame');
    await sourceSurface.getByRole('combobox').fill('zed');
    const targetId = `justonehop-tab:${ids.target}`;
    const target = sourceSurface.locator(`[id="${targetId}"]`);
    // Exact-title match is already first, so saving must show an icon without claiming promotion.
    await expect(sourceSurface.locator('.result.tab').first()).toHaveAttribute('id', targetId);
    await expect(target.locator('button.ranking-forget')).toHaveCount(0);
    await target.click();
    await expect(source.locator('#justonehop-command-palette')).not.toBeAttached();
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).active, ids.target)).toBe(true);
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage)).toEqual([
      expect.objectContaining({ query: 'zed', target: `tab:${targetPage.url()}`, weight: 1 }),
    ]);
    await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { source: 'justonehop', type: 'toggle' }), ids.target);
    await reopened.getByRole('combobox').fill('zed');
    await expect(reopened.locator('.result.tab').first()).toHaveAttribute('id', targetId);
    const icon = reopened.locator(`[id="${targetId}"] button.ranking-forget`);
    await expect(icon).toBeVisible();
    await expect(icon).toHaveAccessibleName('Forget Preference for This Query');
    await expect(icon).toHaveAttribute('data-promoted', 'false');
    await icon.hover();
    await expect(reopened.getByRole('tooltip')).toHaveText('Forget Preference for This QueryShift+BackspacePreference saved; position unchanged.');
  });
});

for (const language of ['Chinese', 'English']) test.describe(() => {
  test.use({ environment: { ...defaults, locale: language === 'English' ? 'en-US' : 'zh-CN', shadow: 'open', pageAccess: true } });
  test(`${language} ranking visibility and forget preserve query scope across palettes`, async () => {
    const chinese = language === 'Chinese';
    const fixture = await worker.evaluate(async base => {
      const a = await chrome.bookmarks.create({ title: 'Rankfixture Alpha', url: `${base}/rank-a` });
      const b = await chrome.bookmarks.create({ title: 'Rankfixture Beta', url: `${base}/rank-b` });
      return { a: a.id, b: b.id };
    }, origin);
    await ui.getByRole('combobox').fill('rankfixture');
    await expect(ui.locator('.result.bookmark')).toHaveCount(2);
    await expect(ui.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
    const baseline = await ui.locator('.result.bookmark').evaluateAll(nodes => nodes.map(node => node.id));
    expect(baseline).toHaveLength(2);
    const chosenId = baseline[1];
    const bookmarkId = chosenId.replace('justonehop-bookmark:', '');
    const target = `bookmark:${bookmarkId}`;
    const otherTarget = `bookmark:${bookmarkId === fixture.a ? fixture.b : fixture.a}`;
    const preserved = [
      { query: 'another query', target, weight: 2, lastUsed: Date.now() },
      { query: 'unrelated', target: otherTarget, weight: 3, lastUsed: Date.now() },
    ];
    await worker.evaluate(async records => chrome.storage.local.set({ searchUsage: records }), preserved);
    const search = ui.getByRole('combobox');
    await search.press('Meta+ArrowUp');
    await search.press('ArrowDown');
    await expect(ui.locator(`[id="${chosenId}"]`)).toHaveAttribute('aria-selected', 'true');
    const opened = context.waitForEvent('page');
    await ui.getByRole('button', { name: chinese ? '在新标签页打开' : 'Open in New Tab', exact: true }).click();
    const openedPage = await opened;
    await expect(openedPage).toHaveURL(`${origin}/${bookmarkId === fixture.a ? 'rank-a' : 'rank-b'}`);
    await expect.poll(() => ui.isClosed()).toBe(true);
    await expect.poll(() => worker.evaluate(async target => ((await chrome.storage.local.get('searchUsage')).searchUsage as UsageRecord[])
      .some(record => record.target === target && record.query === 'rankfixture'), target)).toBe(true);

    setUI(await context.newPage()); await ui.goto(popupUrl);
    await ui.getByRole('combobox').fill('rankfixture');
    await expect(ui.locator('.result.bookmark').first()).toHaveAttribute('id', chosenId);
    await expect(ui.locator(`[id="${chosenId}"] button.ranking-forget`)).toHaveAttribute('data-promoted', 'true');
    await expect(ui.locator('.ranking-badge')).toHaveCount(0);
    const page = await context.newPage(); await page.goto(`${origin}/Ranking-source`);
    await page.setViewportSize({ width: 390, height: 620 });
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, page.url());
    await worker.evaluate(async tabId => {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tabId, { source: 'justonehop', type: 'toggle' });
    }, tabId);
    const surface = page.frameLocator('.justonehop-frame');
    const searchInput = surface.locator('.search-bar input');
    await searchInput.fill('rankfixture');
    await expect(surface.locator('.result.bookmark').first()).toHaveAttribute('id', chosenId);
    const chosen = surface.locator(`[id="${chosenId}"]`);
    const forget = chosen.locator('button.ranking-forget');
    const forgetLabel = chinese ? '忘记此搜索词的偏好' : 'Forget Preference for This Query';
    const promotedHint = chinese ? '按使用习惯前移。' : 'Moved up by your preferences.';
    const recordedHint = chinese ? '已记住偏好，位置未变。' : 'Preference saved; position unchanged.';
    await expect(forget).toHaveAccessibleName(forgetLabel);
    await expect(forget).toHaveAttribute('data-promoted', 'true');
    await expect(forget).toHaveAttribute('tabindex', '0');
    await expect(surface.getByRole('tooltip')).toHaveCount(0);
    await searchInput.press('ArrowDown');
    await expect(forget).toHaveAttribute('tabindex', '-1');
    await expect(surface.locator('button.ranking-forget[tabindex="0"]')).toHaveCount(0);
    await searchInput.press('ArrowUp');
    await expect(forget).toHaveAttribute('tabindex', '0');
    await searchInput.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 5));
    const beforeTabs = await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url })));
    const learned = await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage);
    // Neither shortcut guards nor a deeper Actions layer may forget or execute the row.
    for (const guard of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      await searchInput.dispatchEvent('keydown', { key: 'Backspace', code: 'Backspace', shiftKey: true, ...guard });
    }
    expect(await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual(learned);
    await expect(searchInput).toHaveValue('rankfixture');
    if (chinese) await chosen.click({ button: 'right' });
    else await searchInput.press('Meta+k');
    await expect(surface.getByRole('dialog')).toBeVisible();
    await expect(surface.locator('.action-description')).toHaveCount(0);
    await expect(surface.getByRole('dialog').getByRole('option', { name: forgetLabel, exact: false })).toHaveCount(0);
    await surface.getByRole('combobox', { name: chinese ? '搜索操作' : 'Search actions' }).press('Shift+Backspace');
    await page.keyboard.press('Escape');
    await expect(searchInput).toBeFocused();
    expect(await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual(learned);
    if (chinese) await forget.hover();
    else {
      for (let step = 0; step < 8 && !await forget.evaluate(node => node.matches(':focus')); step++) await page.keyboard.press('Tab');
      await expect(forget).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(searchInput).toBeFocused();
      await expect(surface.locator(`[id="${baseline[0]}"]`)).toHaveAttribute('aria-selected', 'true');
      await expect(forget).toHaveAttribute('tabindex', '-1');
      expect(await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual(learned);
      await searchInput.press('ArrowUp');
      await expect(chosen).toHaveAttribute('aria-selected', 'true');
      for (let step = 0; step < 8 && !await forget.evaluate(node => node.matches(':focus')); step++) await page.keyboard.press('Tab');
      await expect(forget).toBeFocused();
      for (const guard of [{ key: 'Enter', isComposing: true }, { key: ' ', keyCode: 229 }, { key: 'Enter', repeat: true }, { key: ' ', altKey: true }]) {
        await forget.dispatchEvent('keydown', guard);
      }
      expect(await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual(learned);
      await expect(forget).toBeFocused();
    }
    const tooltip = surface.getByRole('tooltip');
    await expect(tooltip).toHaveClass(/ranking-tooltip/);
    await expect(tooltip).toHaveText(`${forgetLabel}Shift+Backspace${promotedHint}`);
    await expect(forget).toHaveAttribute('aria-describedby', await tooltip.getAttribute('id') as string);
    const bounds = await tooltip.boundingBox();
    expect(bounds!.width).toBeLessThan(390);
    const frameBounds = await page.locator('.justonehop-frame').boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(frameBounds!.x);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(frameBounds!.x + frameBounds!.width);
    await surface.locator('.palette').screenshot({ path: test.info().outputPath(`ranking-${language}-tooltip.png`) });
    const currentOrder = await surface.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id));
    const currentScroll = await surface.locator('#justonehop-results').evaluate(node => node.scrollTop);
    await expect(chosen).toHaveAttribute('aria-selected', 'true');
    if (chinese) await forget.click();
    else await page.keyboard.press('Enter');
    await expect(surface.getByRole('dialog')).toHaveCount(0);
    await expect(searchInput).toBeFocused();
    await expect(searchInput).toHaveValue('rankfixture');
    expect(await searchInput.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 5]);
    await expect(surface.locator(`[id="${chosenId}"]`)).toHaveAttribute('aria-selected', 'true');
    expect(await surface.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(currentOrder);
    expect(await surface.locator('#justonehop-results').evaluate(node => node.scrollTop)).toBe(currentScroll);
    // Only the view performing forget holds its order; the other palette syncs normally.
    await expect.poll(() => ui.locator('.result.bookmark').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(baseline);
    await expect(surface.locator('button.ranking-forget')).toHaveCount(0);
    await expect(ui.locator('button.ranking-forget')).toHaveCount(0);
    await expect(surface.getByRole('tooltip')).toHaveCount(0);
    expect(await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url })))).toEqual(beforeTabs);
    await expect(page.locator('#justonehop-command-palette')).toBeAttached();
    expect(await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual(expect.arrayContaining(preserved));
    expect(await worker.evaluate(async () => ((await chrome.storage.local.get('searchUsage')).searchUsage as UsageRecord[]).length)).toBe(preserved.length);

    await surface.locator('.settings-button').click();
    await expect(surface.locator('.settings-page')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(searchInput).toBeFocused();
    await expect(searchInput).toHaveValue('rankfixture');
    expect(await searchInput.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 5]);
    expect(await surface.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(currentOrder);
    await expect(surface.locator(`[id="${chosenId}"]`)).toHaveAttribute('aria-selected', 'true');
    await expect(surface.locator(`[id="${chosenId}"]`)).toBeInViewport();

    await searchInput.fill('rankfixture no match');
    await expect(surface.locator('.result.bookmark')).toHaveCount(0);
    await searchInput.fill('rankfixture');
    await expect.poll(() => surface.locator('.result.bookmark').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(baseline);
    await expect(surface.locator('button.ranking-forget')).toHaveCount(0);
    // An already-first result has a record without claiming a boost.
    const firstTarget = baseline[0].replace('justonehop-', '');
    await worker.evaluate(async ({ records, target }) => chrome.storage.local.set({ searchUsage: [
      { query: 'rankfixture', target, weight: 1, lastUsed: Date.now() }, ...records,
    ] }), { records: preserved, target: firstTarget });
    const remembered = surface.locator(`[id="${baseline[0]}"] button.ranking-forget`);
    await expect(remembered).toHaveAttribute('data-promoted', 'false');
    await expect(remembered).toHaveAttribute('tabindex', '0');
    await expect(surface.locator('.ranking-badge')).toHaveCount(0);
    await remembered.hover();
    await expect(surface.getByRole('tooltip')).toHaveText(`${forgetLabel}Shift+Backspace${recordedHint}`);
    await searchInput.hover();
    await expect(surface.getByRole('tooltip')).toHaveCount(0);
    await expect(searchInput).toBeFocused();
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('Ranking forget preserves current order selection and scroll beyond the result limit until query changes', async () => {
    const records = await worker.evaluate(async base => {
      const bookmarks = [];
      for (let index = 0; index < 120; index++) bookmarks.push(await chrome.bookmarks.create({ title: `Longrank ${String(index).padStart(3, '0')}`, url: `${base}/longrank/${index}` }));
      return bookmarks.map(bookmark => bookmark.id);
    }, origin);
    await ui.getByRole('combobox').fill('longrank');
    await expect(ui.locator('.result.bookmark')).toHaveCount(98);
    await expect(ui.locator('#justonehop-search-all-history')).toHaveCount(1);
    await expect(ui.locator('[id^="justonehop-google:"]')).toHaveCount(1);
    const baseline = await ui.locator('.result.bookmark').evaluateAll(nodes => nodes.map(node => node.id));
    const inside = baseline[30].replace('justonehop-bookmark:', '');
    const outside = records.find(id => !baseline.includes(`justonehop-bookmark:${id}`))!;
    const beforeTabs = await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url })));
    const input = ui.getByRole('combobox');
    for (const id of [inside, outside]) {
      await worker.evaluate(async id => chrome.storage.local.set({ searchUsage: [{ query: 'longrank', target: `bookmark:${id}`, weight: 5, lastUsed: Date.now() }] }), id);
      const row = ui.locator(`[id="justonehop-bookmark:${id}"]`);
      await expect(ui.locator('.result.bookmark').first()).toHaveAttribute('id', `justonehop-bookmark:${id}`);
      await expect(row.locator('button.ranking-forget')).toHaveAttribute('data-promoted', 'true');
      await input.press('Meta+ArrowUp');
      await expect(row).toHaveAttribute('aria-selected', 'true');
      await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 5));
      const list = ui.locator('#justonehop-results');
      if (id === outside) {
        // Keep the selected promoted row offscreen to catch focus restoration scrolling it back.
        await list.evaluate(node => { node.scrollTop = 240; });
        await expect.poll(() => list.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
      }
      const currentOrder = await list.locator('.result').evaluateAll(nodes => nodes.map(node => node.id));
      const currentScroll = await list.evaluate(node => node.scrollTop);
      if (id === inside) await row.locator('button.ranking-forget').click();
      else await input.press('Shift+Backspace');
      await expect(ui.getByRole('dialog')).toHaveCount(0);
      await expect(input).toBeFocused();
      await expect(input).toHaveValue('longrank');
      expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 5]);
      await expect(ui.locator('button.ranking-forget')).toHaveCount(0);
      await expect(ui.locator('.result.bookmark')).toHaveCount(98);
      await expect(ui.locator('#justonehop-search-all-history')).toHaveCount(1);
      await expect(ui.locator('[id^="justonehop-google:"]')).toHaveCount(1);
      expect(await list.locator('.result').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(currentOrder);
      await expect(row).toHaveAttribute('aria-selected', 'true');
      expect(await list.evaluate(node => node.scrollTop)).toBe(currentScroll);
      await expect(ui.locator('.palette-footer .primary-action')).toBeEnabled();
      await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual([]);
      expect(await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url })))).toEqual(beforeTabs);
      await input.fill('longrank no match');
      await expect(ui.locator('.result.bookmark')).toHaveCount(0);
      await input.fill('longrank');
      await expect.poll(() => ui.locator('.result.bookmark').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(baseline);
      await expect(ui.locator('button.ranking-forget')).toHaveCount(0);
      if (id === outside) await expect(row).toHaveCount(0);
    }
  });
  test('Ranking home forget handles storage failure and settings identities stay separate', async () => {
    await ui.getByRole('combobox').fill('language');
    await expect(ui.locator('[id="justonehop-command:settings:language"]')).toHaveAttribute('aria-selected', 'true');
    await ui.getByRole('combobox').press('Enter');
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage?.[0]?.target)).toBe('command:settings:language');
    await ui.keyboard.press('Escape');
    await ui.getByRole('combobox').fill('theme');
    await expect(ui.locator('[id="justonehop-command:settings:theme"]')).toHaveAttribute('aria-selected', 'true');
    await ui.getByRole('combobox').press('Enter');
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage?.[0]?.target)).toBe('command:settings:theme');
    await ui.keyboard.press('Escape');
    await ui.getByRole('combobox').fill('');
    await expect(ui.locator('.result.command').first()).toHaveAttribute('id', 'justonehop-command:settings');
    const defaultOrder = await ui.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id));
    await worker.evaluate(async () => {
      const records = (await chrome.storage.local.get<{ searchUsage: UsageRecord[] }>('searchUsage')).searchUsage;
      await chrome.storage.local.set({ searchUsage: [...records,
        { query: '', target: 'command:pin', weight: 1, lastUsed: Date.now() },
        { query: 'pin', target: 'command:pin', weight: 1, lastUsed: Date.now() },
      ] });
      const original = chrome.storage.local.set.bind(chrome.storage.local);
      chrome.storage.local.set = async value => {
        if ('searchUsage' in value) { chrome.storage.local.set = original; throw new Error('test write failure'); }
        return original(value);
      };
    });
    // Home scores are captured when this palette mounts, including externally seeded weights.
    await ui.reload();
    await expect(ui.locator('.result.command').first()).toHaveAttribute('id', 'justonehop-command:pin');
    const pin = ui.locator('[id="justonehop-command:pin"]');
    const forget = pin.locator('button.ranking-forget');
    await expect(forget).toHaveAccessibleName('Forget This Command’s Preferences');
    await expect(forget).toHaveAttribute('data-promoted', 'true');
    await expect(ui.getByRole('tooltip')).toHaveCount(0);
    const beforeTabs = await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url, pinned: tab.pinned })));
    // Home is one mixed list: Cmd+arrows select its endpoints.
    await ui.getByRole('combobox').press('Meta+ArrowDown');
    await expect(ui.locator('#justonehop-results .result').last()).toHaveAttribute('aria-selected', 'true');
    await ui.getByRole('combobox').press('Meta+ArrowUp');
    await expect(pin).toHaveAttribute('aria-selected', 'true');
    await forget.hover();
    await expect(ui.getByRole('tooltip')).toHaveText('Forget This Command’s PreferencesShift+BackspaceMoved up by your preferences.');
    const currentOrder = await ui.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id));
    const currentScroll = await ui.locator('#justonehop-results').evaluate(node => node.scrollTop);
    const learned = await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage);
    await forget.click();
    await expect(ui.getByRole('alert')).toContainText('Could not forget');
    await expect(ui.getByRole('dialog')).toHaveCount(0);
    await expect(pin).toHaveAttribute('aria-selected', 'true');
    await expect(forget).toBeVisible();
    await expect(forget).toBeEnabled();
    await expect(forget).toHaveAttribute('tabindex', '0');
    await expect(ui.locator('#justonehop-results')).toBeVisible();
    expect(await ui.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(currentOrder);
    expect(await ui.locator('#justonehop-results').evaluate(node => node.scrollTop)).toBe(currentScroll);
    expect(await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual(learned);
    // Retry through the same icon using keyboard activation after mouse failure.
    await ui.getByRole('combobox').focus();
    await ui.getByRole('combobox').hover();
    for (let step = 0; step < 8 && !await forget.evaluate(node => node.matches(':focus')); step++) await ui.keyboard.press('Tab');
    await expect(forget).toBeFocused();
    await ui.keyboard.press('Enter');
    await expect(forget).toHaveCount(0);
    await expect(ui.getByRole('alert')).toHaveCount(0);
    await expect(ui.getByRole('dialog')).toHaveCount(0);
    expect(await ui.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(currentOrder);
    await expect(pin).toHaveAttribute('aria-selected', 'true');
    expect(await ui.locator('#justonehop-results').evaluate(node => node.scrollTop)).toBe(currentScroll);
    await expect(ui.getByRole('combobox')).toBeFocused();
    await expect(ui.getByRole('combobox')).toHaveValue('');
    expect(await ui.getByRole('combobox').evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([0, 0]);
    const remaining = await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage as UsageRecord[]);
    expect(remaining.map(record => record.target).sort()).toEqual(['command:settings:language', 'command:settings:theme']);
    expect(await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url, pinned: tab.pinned })))).toEqual(beforeTabs);
    expect(ui.isClosed()).toBe(false);
    await ui.getByRole('combobox').fill('pin');
    await expect(pin).toBeVisible();
    await ui.getByRole('combobox').fill('');
    await expect.poll(() => ui.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(currentOrder);
    await expect(forget).toHaveCount(0);
    await ui.reload();
    await expect.poll(() => ui.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(defaultOrder);
    await pin.click({ button: 'right' });
    await expect(ui.getByRole('dialog')).toBeVisible();
    await expect(ui.locator('.action-description')).toHaveCount(0);
    await expect(ui.getByRole('option', { name: 'Forget This Command’s Preferences', exact: false })).toHaveCount(0);
    await ui.keyboard.press('Escape');
    const newTab = ui.locator('[id="justonehop-command:newTab"]');
    // The toolbar popup normally has a fixed 750px body; resize this layout fixture explicitly.
    await ui.evaluate(() => { document.body.style.width = '100%'; });
    for (const width of [750, 390]) {
      await ui.setViewportSize({ width, height: 600 });
      await ui.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const before = await newTab.locator('.key-chord > kbd').boundingBox();
      await worker.evaluate(async () => chrome.storage.local.set({ searchUsage: [
        { query: '', target: 'command:newTab', weight: 1, lastUsed: Date.now() },
      ] }));
      const icon = newTab.locator('button.ranking-forget');
      await expect(icon).toBeVisible();
      const iconBox = await icon.boundingBox();
      const keyBox = await newTab.locator('.key-chord > kbd').boundingBox();
      expect(iconBox!.x + iconBox!.width).toBeLessThanOrEqual(keyBox!.x);
      expect(keyBox!.x + keyBox!.width).toBeCloseTo(before!.x + before!.width, 0);
      await icon.click();
      await expect(icon).toHaveCount(0);
      await expect(ui.getByRole('combobox')).toBeFocused();
    }
  });
});

test.describe(() => {
  const language: string = 'English';
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test(`${language} home recommendations mix learned pages and commands with frozen order until reopen`, async () => {
    const chinese = language === 'Chinese';
    const page = await context.newPage(); await page.goto(`${origin}/Home-source`);
    const seed = await worker.evaluate(async base => {
      const source = (await chrome.tabs.query({})).find(tab => tab.url === `${base}/Home-source`)!;
      const learned = await chrome.tabs.create({ url: `${base}/Home-learned`, active: false });
      const duplicate = await chrome.tabs.create({ url: learned.url || `${base}/Home-learned`, active: false });
      const cold = await chrome.tabs.create({ url: `${base}/Home-cold`, active: false });
      const sameSource = await chrome.tabs.create({ url: source.url, active: false });
      const bookmark = await chrome.bookmarks.create({ title: 'Home learned bookmark', url: `${base}/Home-learned` });
      const duplicateBookmark = await chrome.bookmarks.create({ title: 'Home duplicate bookmark', url: `${base}/Home-learned` });
      const saved = await chrome.bookmarks.create({ title: 'Home saved page', url: `${base}/Home-saved` });
      const another = await chrome.bookmarks.create({ title: 'Home another page', url: `${base}/Home-another` });
      const current = await chrome.bookmarks.create({ title: 'Home source bookmark', url: source.url });
      return { source: source.id!, learned: learned.id!, duplicate: duplicate.id!, cold: cold.id!, sameSource: sameSource.id!,
        bookmark: bookmark.id, duplicateBookmark: duplicateBookmark.id, saved: saved.id, another: another.id, current: current.id };
    }, origin);
    for (const id of [seed.learned, seed.duplicate, seed.cold, seed.sameSource]) {
      await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).status, id)).toBe('complete');
    }
    const surface = await openStorageOverlay(page);
    const input = surface.getByRole('combobox', { name: chinese ? '搜索命令、标签页、书签和历史' : 'Search commands, tabs, bookmarks, and history' });
    const ids = () => surface.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id));
    const defaults = ['settings', 'help', 'tabSwitcher', 'searchAllHistory', 'newTab', 'reload', 'pin', 'localStorage', 'cookies']
      .map(action => action === 'searchAllHistory' ? 'justonehop-search-all-history' : `justonehop-command:${action}`);
    await expect.poll(ids).toEqual(defaults);
    await expect(surface.locator('.suggested-label')).toHaveCount(0);
    await expect(surface.locator('#justonehop-results')).toHaveAccessibleName(chinese ? '推荐' : 'Suggested');
    await expect(surface.locator('.section-start')).toHaveCount(0);
    await worker.evaluate(async ({ seed, base }) => {
      const lastUsed = Date.now();
      await chrome.storage.local.set({ searchUsage: [
        { query: 'home learned', target: `tab:${base}/Home-learned`, weight: 4, lastUsed },
        { query: 'bookmark', target: `bookmark:${seed.bookmark}`, weight: 4, lastUsed },
        { query: 'other query', target: `bookmark:${seed.duplicateBookmark}`, weight: 4, lastUsed },
        { query: 'reload', target: 'command:reload', weight: 10, lastUsed },
        { query: 'saved', target: `bookmark:${seed.saved}`, weight: 5, lastUsed },
        { query: 'another', target: `bookmark:${seed.another}`, weight: 3, lastUsed },
        { query: 'source', target: `tab:${base}/Home-source`, weight: 100, lastUsed },
        { query: 'source', target: `bookmark:${seed.current}`, weight: 100, lastUsed },
        ...['mute', 'restore', 'sessionStorage'].map(action => ({ query: action, target: `command:${action}`, weight: 100, lastUsed })),
      ] });
    }, { seed, base: origin });
    for (const [action, queries] of [
      ['mute', ['mute', '静音']], ['restore', ['restore', '恢复关闭的标签页']],
      ['sessionStorage', ['session storage', '会话存储']], ['tabSwitcher', ['tab switcher', '标签切换器']],
    ] as const) for (const query of queries) {
      await input.fill(query);
      await expect(surface.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
      await expect(surface.locator(`[id="justonehop-command:${action}"]`)).toBeVisible();
    }
    // Successful search and home actions learn without reordering this mounted homepage.
    await input.fill('settings');
    await expect(surface.locator('[id="justonehop-command:settings"]')).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
    await expect(surface.getByRole('region', { name: chinese ? '设置' : 'Settings', exact: true })).toBeVisible();
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage: UsageRecord[] }>('searchUsage'))
      .searchUsage.find(record => record.query === 'settings' && record.target === 'command:settings')?.weight)).toBe(1);
    await page.keyboard.press('Escape'); await input.fill('');
    await expect.poll(ids).toEqual(defaults);
    await surface.locator('[id="justonehop-command:settings"]').click();
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage: UsageRecord[] }>('searchUsage'))
      .searchUsage.find(record => record.query === '' && record.target === 'command:settings')?.weight)).toBe(1);
    await page.keyboard.press('Escape');
    await input.fill('Home cold');
    await expect(surface.locator(`[id="justonehop-tab:${seed.cold}"]`)).toHaveAttribute('aria-selected', 'true');
    await input.press('Meta+k');
    const actions = surface.getByRole('combobox', { name: chinese ? '搜索操作' : 'Search actions' });
    await actions.fill('mute'); await actions.press('Enter');
    await expect(surface.getByRole('dialog')).toHaveCount(0);
    await expect(input).toHaveValue('Home cold'); await expect(input).toBeFocused();
    expect(await worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage: UsageRecord[] }>('searchUsage'))
      .searchUsage.some(record => record.query === 'home cold'))).toBe(false);
    await input.fill(''); await expect.poll(ids).toEqual(defaults);
    await page.keyboard.press('Escape');
    await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
    await worker.evaluate(id => chrome.tabs.sendMessage(id, { source: 'justonehop', type: 'toggle' }), seed.source);
    await expect(surface.locator('#justonehop-results .result')).toHaveCount(10);
    const learnedOrder = await ids();
    expect(learnedOrder.slice(0, 4)).toEqual([`justonehop-tab:${seed.learned}`, 'justonehop-command:reload', `justonehop-bookmark:${seed.saved}`, `justonehop-bookmark:${seed.another}`]);
    expect(learnedOrder).toContain('justonehop-command:settings');
    for (const id of [seed.source, seed.sameSource, seed.duplicate, seed.cold]) expect(learnedOrder).not.toContain(`justonehop-tab:${id}`);
    for (const id of [seed.current, seed.bookmark, seed.duplicateBookmark]) expect(learnedOrder).not.toContain(`justonehop-bookmark:${id}`);
    for (const action of ['mute', 'restore', 'sessionStorage']) expect(learnedOrder).not.toContain(`justonehop-command:${action}`);
    await surface.locator('.palette').screenshot({ path: test.info().outputPath(`home-suggested-${language.toLowerCase()}.png`) });
    const forget = surface.locator(`[id="justonehop-tab:${seed.learned}"] button.ranking-forget`);
    await expect(forget).toHaveAccessibleName(chinese ? '忘记此页面的偏好' : 'Forget This Page’s Preferences');
    await forget.click();
    await expect(forget).toHaveCount(0);
    await expect.poll(ids).toEqual(learnedOrder);
    const remaining = await worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage: UsageRecord[] }>('searchUsage')).searchUsage);
    for (const target of [`tab:${origin}/Home-learned`, `bookmark:${seed.bookmark}`, `bookmark:${seed.duplicateBookmark}`]) {
      expect(remaining.some(record => record.target === target)).toBe(false);
    }
    expect(await worker.evaluate(async id => (await chrome.tabs.get(id)).url, seed.learned)).toBe(`${origin}/Home-learned`);
    expect(await worker.evaluate(async id => (await chrome.bookmarks.get(id))[0].url, seed.bookmark)).toBe(`${origin}/Home-learned`);
    await input.fill('help');
    await expect(surface.locator('[id="justonehop-command:help"]')).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
    await expect(surface.locator('.help-view')).toBeVisible();
    await page.keyboard.press('Escape'); await input.fill('');
    await expect.poll(ids).toEqual(learnedOrder);
    // Reset Ranking is the explicit exception to the mounted home snapshot.
    await surface.getByRole('button', { name: chinese ? '设置' : 'Settings', exact: true }).click();
    await surface.getByRole('button', { name: chinese ? '重置搜索排序' : 'Reset Ranking', exact: true }).click();
    await expect(surface.getByRole('status')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect.poll(ids).toEqual(defaults);
    await expect(surface.locator('button.ranking-forget')).toHaveCount(0);
    // A real successful selection makes a previously cold page eligible on the next open.
    await input.fill('Home cold');
    await surface.locator(`[id="justonehop-tab:${seed.cold}"]`).click();
    await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage: UsageRecord[] }>('searchUsage'))
      .searchUsage.find(record => record.target.endsWith('/Home-cold'))?.query)).toBe('home cold');
    await page.bringToFront();
    await worker.evaluate(id => chrome.tabs.sendMessage(id, { source: 'justonehop', type: 'toggle' }), seed.source);
    await expect.poll(ids).toEqual([`justonehop-tab:${seed.cold}`, ...defaults].slice(0, 10));
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English performance switching acknowledges before slow usage persistence completes', async () => {
  const target = await context.newPage(); await target.goto(`${origin}/Switch-speed-fixture`);
  await ui.bringToFront();
  await ui.locator('.search-bar input').fill('Switch speed fixture');
  await expect(ui.locator('.result.tab')).toHaveCount(1);
  await expect(ui.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
  await ui.locator('.search-bar input').press('Meta+ArrowUp');
  await expect(ui.locator('.result.tab')).toHaveAttribute('aria-selected', 'true');
  await worker.evaluate(() => {
    const original = chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set = (async items => {
      if ('searchUsage' in items) await new Promise<void>(resolve => {
        (globalThis as unknown as { __releaseUsage: () => void }).__releaseUsage = resolve;
      });
      return original(items);
    }) as typeof chrome.storage.local.set;
  });
  const closing = ui.waitForEvent('close', { timeout: 3000 });
  const start = performance.now();
  await ui.locator('.search-bar input').press('Enter');
  await closing;
  const elapsed = Math.round(performance.now() - start);
  // Keep persistence blocked until after dismissal. This checks the dependency,
  // rather than asserting a fragile wall-clock threshold on a busy machine.
  await expect.poll(() => worker.evaluate(() => typeof (globalThis as unknown as { __releaseUsage?: () => void }).__releaseUsage)).toBe('function');
  expect(await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toBeUndefined();
  console.log(JSON.stringify({ performance: 'switch', closeMs: elapsed, persistenceStillBlocked: true }));
  await worker.evaluate(() => (globalThis as unknown as { __releaseUsage: () => void }).__releaseUsage());
  await expect.poll(() => worker.evaluate(async () => ((await chrome.storage.local.get('searchUsage')).searchUsage as { query: string }[] | undefined)?.some(record => record.query === 'switch speed fixture'))).toBe(true);
});
});
