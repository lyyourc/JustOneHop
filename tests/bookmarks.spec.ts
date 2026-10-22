import { test as base, expect } from '@playwright/test';
import { test, defaults, origin, context, ui, worker } from './support/paletteFixture';
import { openStorageOverlay, openNativePalette } from './support/paletteHelpers';
import { registerPaletteFixture } from './support/paletteFixture';

registerPaletteFixture();

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true } });
  test('bookmark tab closed-shadow keyboard preserves source URL and search caret', async () => {
    const page = await context.newPage();
    const url = `${origin}/Bookmark-keyboard-source?mode=full&value=a%2Bb#saved-fragment`;
    await page.goto(url);
    const source = await worker.evaluate(async url => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
      await chrome.bookmarks.create({ title: tab.title!, url });
      return tab;
    }, url);
    await page.bringToFront();
    await worker.evaluate(async tabId => {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tabId, { source: 'justonehop', type: 'toggle' });
    }, source.id!);
    await expect(page.locator('#justonehop-command-palette')).toBeAttached();
    expect(await page.locator('#justonehop-command-palette').evaluate(node => node.shadowRoot)).toBeNull();
    const cdp = await context.newCDPSession(page);
    const ax = async () => {
      const { frameTree } = await cdp.send('Page.getFrameTree');
      const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
      return (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes;
    };
    const combo = async () => (await ax()).find(node => node.role?.value === 'combobox' && node.name?.value === 'Search commands, tabs, bookmarks, and history');
    const focused = async () => (await combo())?.properties?.some(property => property.name === 'focused' && property.value.value === true);
    const bookmarks = () => worker.evaluate(url => chrome.bookmarks.search({ url }), url);
    // Read the real closed-root input through AX; every user interaction remains keyboard input.
    const caret = async () => {
      const node = await combo();
      const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: node!.backendDOMNodeId });
      try {
        const { result } = await cdp.send('Runtime.callFunctionOn', {
          objectId: object.objectId, returnByValue: true,
          functionDeclaration: 'function() { return [this.selectionStart, this.selectionEnd]; }',
        });
        return result.value;
      } finally { if (object.objectId) await cdp.send('Runtime.releaseObject', { objectId: object.objectId }); }
    };
    await expect.poll(focused).toBe(true);
    for (const [query, adding] of [['book', false], ['book', true], ['book', false], ['收藏标签页', true], ['收藏标签页', false]] as const) {
      await page.keyboard.press('Meta+a');
      await page.keyboard.insertText(query);
      const title = adding ? 'Bookmark Tab' : 'Unbookmark Tab';
      await expect.poll(async () => (await ax()).some(node => node.role?.value === 'option' && node.name?.value?.includes(title)
        && node.properties?.some(property => property.name === 'selected' && property.value.value === true))).toBe(true);
      await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Shift+ArrowLeft');
      const selection = [query.length - 3, query.length - 2];
      expect(await caret()).toEqual(selection);
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await bookmarks()).length).toBe(adding ? 1 : 0);
      if (adding) {
        const [saved] = await bookmarks();
        expect(saved).toMatchObject({ title: source.title, url });
        const [folder] = await worker.evaluate(id => chrome.bookmarks.get(id), saved.parentId!);
        expect(folder.title).toMatch(/^Other bookmarks$/i);
      }
      await expect.poll(async () => (await ax()).some(node => node.name?.value === (adding ? 'Bookmark added' : 'Bookmarks removed: 1'))).toBe(true);
      await expect.poll(async () => (await ax()).some(node => node.role?.value === 'alertdialog')).toBe(false);
      await expect.poll(focused).toBe(true);
      expect((await combo())?.value?.value).toBe(query);
      expect(await caret()).toEqual(selection);
      expect((await ax()).some(node => node.role?.value === 'option' && node.name?.value?.includes(`Tab: ${title}`))).toBe(false);
      if (adding) {
        const removal = async () => (await ax()).find(node => node.role?.value === 'option' && node.name?.value?.includes('Unbookmark Tab'));
        await expect.poll(async () => !!(await removal())).toBe(true);
        expect((await removal())?.properties?.some(property => property.name === 'selected' && property.value.value === true)).toBe(false);
        // Keeping the bookmark query reveals the reverse action without inheriting its selection.
        await page.keyboard.press('Enter');
        await expect.poll(focused).toBe(true);
        expect(await bookmarks()).toHaveLength(1);
        expect((await combo())?.value?.value).toBe(query);
        await page.keyboard.press('ArrowDown');
        await expect.poll(async () => (await removal())?.properties?.some(property => property.name === 'selected' && property.value.value === true)).toBe(true);
      }
      await expect(page.locator('#justonehop-command-palette')).toBeAttached();
      expect(await worker.evaluate(id => chrome.tabs.get(id), source.id!)).toMatchObject({ active: true, url });
      await page.keyboard.insertText('X');
      await expect.poll(async () => (await combo())?.value?.value).toBe(`${query.slice(0, selection[0])}X${query.slice(selection[1])}`);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
    await cdp.detach();
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test('bookmark tab menus confirm exact duplicate sets and retry changed scope', async () => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 500, height: 760 });
    await page.goto(`${origin}/Bookmark-menu-source`);
    const url = `${origin}/Bookmark-menu-target?mode=full&value=a%2Bb#saved-fragment`;
    const seed = await worker.evaluate(async ({ sourceUrl, url }) => {
      const source = (await chrome.tabs.query({})).find(tab => tab.url === sourceUrl)!;
      const target = await chrome.tabs.create({ windowId: source.windowId, url, active: false });
      const groupId = await chrome.tabs.group({ tabIds: [target.id!] });
      await chrome.tabGroups.update(groupId, { title: 'Bookmark collection', color: 'blue' });
      const folder = await chrome.bookmarks.create({ parentId: '2', title: 'Duplicate folder' });
      const otherUrl = await chrome.bookmarks.create({ parentId: folder.id, title: 'Different fragment', url: url.replace('#saved-fragment', '#keep-fragment') });
      return { source: source.id!, target: target.id!, folder: folder.id, otherUrl: otherUrl.id };
    }, { sourceUrl: page.url(), url });
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).status, seed.target)).toBe('complete');
    const surface = await openStorageOverlay(page);
    const root = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    const actions = surface.getByRole('combobox', { name: 'Search actions' });
    const bookmarks = () => worker.evaluate(url => chrome.bookmarks.search({ url }), url);
    const ids = async () => (await bookmarks()).map(bookmark => bookmark.id).sort();
    await root.fill('Bookmark menu');
    await root.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
    const target = surface.locator(`[id="justonehop-tab:${seed.target}"]`);
    await target.click({ button: 'right' });
    await expect(surface.locator('.action-heading')).toContainText('Bookmark menu target');
    await actions.fill('bookmark tab');
    await surface.locator('.action-row').filter({ hasText: 'Bookmark Tab' }).click();
    await expect.poll(async () => (await bookmarks()).length).toBe(1);
    expect((await bookmarks())[0]).toMatchObject({ title: 'Bookmark menu target', url, parentId: '2' });
    expect(await worker.evaluate(url => chrome.bookmarks.search({ url }), page.url())).toEqual([]);
    await expect(surface.locator('.palette-footer')).toContainText('Bookmark added');
    await expect(root).toBeFocused(); await expect(root).toHaveValue('Bookmark menu');
    expect(await root.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
    await expect(target).toHaveAttribute('aria-selected', 'true');
    await worker.evaluate(({ parentId, url }) => chrome.bookmarks.create({ parentId, title: 'Second copy', url }), { parentId: seed.folder, url });
    const originalIds = await ids();
    expect(originalIds).toHaveLength(2);
    await root.fill('Bookmark collection');
    await surface.getByRole('option').filter({ hasText: 'Tab Group: Bookmark collection' }).click();
    const group = surface.getByRole('combobox', { name: 'Search tabs in this group…' });
    await group.fill('target');
    await group.press('ArrowLeft'); await group.press('Shift+ArrowLeft');
    const groupCaret = [4, 5];
    const member = surface.locator(`[id="group-tab:${seed.target}"]`);
    const confirmation = surface.getByRole('alertdialog', { name: 'Remove bookmarks?' });
    const cancel = confirmation.getByRole('button', { name: 'Cancel', exact: true });
    async function confirmMenu(count: number, mouse = false) {
      if (mouse) await member.click({ button: 'right' });
      else await group.press('Meta+k');
      await actions.fill('unbookmark tab');
      await actions.press('Enter');
      await expect(confirmation).toBeVisible();
      await expect(confirmation).toContainText(`Remove all ${count} bookmarks for this URL from the folders below?`);
      await expect(confirmation).toContainText(/Other bookmarks/i);
      await expect(confirmation).toContainText('Duplicate folder');
      await expect(confirmation.getByRole('button', { name: `Remove ${count} bookmarks`, exact: true })).toBeInViewport();
      await expect(cancel).toBeFocused();
      if (count === 2 && mouse) await surface.locator('.palette').screenshot({ path: test.info().outputPath('bookmark-confirmation.png') });
    }
    async function returnToGroup() {
      await expect(confirmation).toHaveCount(0);
      await expect(actions).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(group).toBeFocused(); await expect(group).toHaveValue('target');
      expect(await group.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual(groupCaret);
      await expect(member).toHaveAttribute('aria-selected', 'true');
    }
    await confirmMenu(2, true);
    await cancel.click();
    expect(await ids()).toEqual(originalIds);
    await returnToGroup();
    await confirmMenu(2);
    await page.keyboard.press('Escape');
    expect(await ids()).toEqual(originalIds);
    await returnToGroup();
    await confirmMenu(2, true);
    const added = await worker.evaluate(({ parentId, url }) => chrome.bookmarks.create({ parentId, title: 'Added after confirmation', url }), { parentId: seed.folder, url });
    const changedIds = [...originalIds, added.id].sort();
    await confirmation.getByRole('button', { name: 'Remove 2 bookmarks', exact: true }).click();
    await expect(surface.getByRole('alert')).toContainText('The page or its bookmarks changed. Check the updated list and try again.');
    expect(await ids()).toEqual(changedIds);
    await expect(confirmation).toHaveCount(0);
    await expect(actions).toBeFocused();
    await returnToGroup();
    await confirmMenu(3);
    // Cancel is the default; Tab explicitly chooses the destructive confirmation.
    await page.keyboard.press('Tab');
    await expect(confirmation.getByRole('button', { name: 'Remove 3 bookmarks', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(ids).toEqual([]);
    await expect(confirmation).toHaveCount(0);
    await expect(surface.locator('.action-menu')).toHaveCount(0);
    await expect(surface.locator('.palette-footer')).toContainText('Bookmarks removed: 3');
    await expect(group).toBeFocused(); await expect(group).toHaveValue('target');
    expect(await group.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual(groupCaret);
    await expect(member).toHaveAttribute('aria-selected', 'true');
    expect(await worker.evaluate(async id => (await chrome.bookmarks.get(id))[0].url, seed.otherUrl)).toBe(url.replace('#saved-fragment', '#keep-fragment'));
    expect(await worker.evaluate(id => chrome.tabs.get(id), seed.source)).toMatchObject({ active: true, url: page.url() });
    await page.keyboard.insertText('X');
    await expect(group).toHaveValue('targXt');
    await page.keyboard.press('Escape');
    await expect(root).toHaveValue('Bookmark collection');
    await expect(root).toBeFocused();
  });
});

test.describe(() => {
  const locale = 'en-US';
  test.use({ environment: { ...defaults, locale } });
  test(`bookmark result item ${locale} removes only the selected ID through mouse and keyboard menus`, async () => {
    const english = locale === 'en-US';
    const url = `${origin}/Bookmark-item-unopened?value=a%2Bb#saved-fragment`;
    const seed = await worker.evaluate(async ({ origin, url }) => {
      const first = await chrome.bookmarks.create({ title: 'Bookmark item Alpha', url });
      const second = await chrome.bookmarks.create({ title: 'Bookmark item Beta', url });
      const neighbor = await chrome.bookmarks.create({ title: 'Bookmark item Neighbor', url: `${origin}/Bookmark-item-neighbor` });
      return { first, second, neighbor };
    }, { origin, url });
    const input = ui.getByRole('combobox', { name: english ? 'Search commands, tabs, bookmarks, and history' : '搜索命令、标签页、书签和历史' });
    const actions = ui.getByRole('combobox', { name: english ? 'Search actions' : '搜索操作' });
    const rows = ui.locator('#justonehop-results .result.bookmark');
    const tabs = () => worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url })));
    const beforeTabs = await tabs();
    expect(beforeTabs.some(tab => tab.url === url)).toBe(false);
    await input.fill('Bookmark item');
    await expect(rows).toHaveCount(3);
    await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 7));
    const label = english ? 'Unbookmark' : '取消收藏';
    for (const [index, bookmark] of [seed.first, seed.second].entries()) {
      const row = ui.locator(`[id="justonehop-bookmark:${bookmark.id}"]`);
      const remove = ui.locator(`[id="justonehop-actions-bookmark:${bookmark.id}:removeBookmark"]`);
      const order = await rows.evaluateAll(nodes => nodes.map(node => node.id));
      const at = order.indexOf(`justonehop-bookmark:${bookmark.id}`);
      const next = order[at + 1] ?? order[at - 1];
      if (index === 0) {
        // Right-click and footer Actions must expose the same item-specific action.
        await row.click({ button: 'right' });
        await expect(remove.locator(':scope > span')).toHaveText(label);
        await ui.getByRole('button', { name: english ? 'Back' : '返回', exact: true }).click();
        await expect(input).toBeFocused();
        await expect(row).toHaveAttribute('aria-selected', 'true');
        await ui.getByRole('button', { name: english ? 'Open action menu' : '打开操作菜单' }).click();
        await expect(remove.locator(':scope > span')).toHaveText(label);
        await expect(ui.locator('[id="justonehop-actions-action:unbookmarkTab"]')).toHaveCount(0);
        await remove.click();
      } else {
        // Select the remaining duplicate using only the keyboard, then Cmd+K/Enter.
        await input.press('Meta+ArrowUp');
        const remaining = await rows.evaluateAll(nodes => nodes.map(node => node.id));
        for (let step = 0; step < remaining.indexOf(`justonehop-bookmark:${bookmark.id}`); step++) await input.press('ArrowDown');
        await expect(row).toHaveAttribute('aria-selected', 'true');
        await input.press('Meta+k');
        await expect(actions).toBeFocused();
        await ui.keyboard.type(english ? '取消收藏' : 'unbookmark');
        await expect(remove.locator(':scope > span')).toContainText(label);
        await expect(remove).toHaveAttribute('aria-selected', 'true');
        await ui.keyboard.press('Enter');
      }
      await expect.poll(() => worker.evaluate(async url => (await chrome.bookmarks.search({ url })).map(item => item.id), url))
        .toEqual(index === 0 ? [seed.second.id] : []);
      await expect(ui.getByRole('alertdialog')).toHaveCount(0);
      await expect(ui.locator('.action-menu')).toHaveCount(0);
      await expect(ui.locator('.palette-footer')).toContainText(english ? 'Bookmarks removed: 1' : '已移除 1 个书签');
      await expect(row).toHaveCount(0);
      await expect(rows).toHaveCount(2 - index);
      await expect(ui.locator('#justonehop-results [aria-selected="true"]')).toHaveAttribute('id', next);
      await expect(input).toHaveValue('Bookmark item'); await expect(input).toBeFocused();
      expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 7]);
      expect(await tabs()).toEqual(beforeTabs);
      expect(await worker.evaluate(async id => (await chrome.bookmarks.get(id))[0], seed.neighbor.id)).toMatchObject({ id: seed.neighbor.id, title: seed.neighbor.title, url: seed.neighbor.url });
    }
    await ui.keyboard.type('X');
    await expect(input).toHaveValue('BoXk item');
  });
});

test.describe('headed', { tag: '@headed' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true, headed: true } });
  test('bookmark Enter navigates the source tab from a native panel', async () => {
    await worker.evaluate(async base => { await chrome.bookmarks.create({ title: 'BookmarkAcceptance', url: `${base}/Bookmarked` }); }, origin);
    const { source, palette } = await openNativePalette();
    const input = palette.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await input.fill('BookmarkAcceptance');
    await expect(palette.locator('#justonehop-results [aria-selected="true"]')).toHaveClass(/bookmark/);
    await input.press('Enter').catch(error => { if (!palette.isClosed()) throw error; });
    await expect.poll(() => worker.evaluate(id => chrome.tabs.get(id).then(tab => tab.url), source.tabId)).toBe(`${origin}/Bookmarked`);
    await expect.poll(() => palette.isClosed()).toBe(true);
  });
});

test.describe(() => {
  const language: string = 'English';
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test(`${language} bookmark search shows shortcut and menu dispatch preserves bookmark state`, async () => {
    const page = await context.newPage(); await page.goto(`${origin}/Bookmark-shortcut-source`);
    await page.bringToFront();
    await worker.evaluate(async url => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
      await chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id!, { source: 'justonehop', type: 'toggle' });
    }, page.url());
    const surface = page.frameLocator('.justonehop-frame');
    const input = surface.locator('.search-bar input');
    await input.fill(language === 'English' ? 'bookmark tab' : '收藏标签页');
    const add = surface.locator('[id="justonehop-command:bookmarkTab"]');
    await expect(add.locator('.entry-shortcut kbd')).toHaveText('⌘D');
    await expect(add.locator('.entry-shortcut')).toHaveAttribute('aria-label', 'Command + D');
    await add.click({ button: 'right' });
    await expect(surface.locator('.action-row .entry-shortcut kbd')).toHaveText('⌘D');
    await page.keyboard.press('Meta+d');
    const bookmarks = () => worker.evaluate(url => chrome.bookmarks.search({ url }), page.url());
    await expect.poll(async () => (await bookmarks()).length).toBe(1);
    const remove = surface.locator('[id="justonehop-command:unbookmarkTab"]');
    await expect(remove).toBeVisible();
    await expect(remove.locator('.entry-shortcut')).toHaveCount(0);
    for (const query of ['add bookmark', 'save bookmark', '添加书签']) {
      await input.fill(query);
      const remembered = surface.locator('#justonehop-results [aria-disabled="true"]');
      await expect(remembered).toContainText(language === 'English' ? 'Already Bookmarked' : '已收藏');
      await expect(surface.locator('.primary-action')).toBeDisabled();
      await expect(surface.locator('.actions-button')).toBeDisabled();
      await input.press('Enter');
      const bounds = (await remembered.boundingBox())!;
      await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      expect((await bookmarks()).length).toBe(1);
    }
    await input.fill('book');
    await expect(remove).not.toHaveAttribute('aria-disabled', 'true');
    await remove.click();
    await expect.poll(async () => (await bookmarks()).length).toBe(0);
    await expect(add.locator('.entry-shortcut kbd')).toHaveText('⌘D');
    await expect(surface.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
    await input.press('Meta+ArrowUp');
    await expect(add).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
    await expect.poll(async () => (await bookmarks()).length).toBe(1);
    await expect(remove).toBeVisible();
    await expect(remove.locator('.entry-shortcut')).toHaveCount(0);
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English performance repeated openings reuse bookmarks and observe bookmark edits', async () => {
  await worker.evaluate(() => {
    const scope = globalThis as unknown as { __bookmarkReads: number };
    scope.__bookmarkReads = 0;
    const original = chrome.bookmarks.getTree.bind(chrome.bookmarks);
    chrome.bookmarks.getTree = (async () => { scope.__bookmarkReads++; return original(); }) as typeof chrome.bookmarks.getTree;
  });
  const timings: number[] = [];
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    await ui.reload();
    await expect(ui.locator('.result.command')).toHaveCount(9);
    timings.push(Math.round(performance.now() - start));
  }
  const reads = await worker.evaluate(() => (globalThis as unknown as { __bookmarkReads: number }).__bookmarkReads);
  console.log(JSON.stringify({ performance: 'reopen', readyMs: timings, bookmarkReads: reads }));
  expect(reads).toBeLessThanOrEqual(1);
  const bookmark = await worker.evaluate(url => chrome.bookmarks.create({ title: 'Performance saved bookmark', url }), `${origin}/perf-bookmark`);
  await ui.locator('.search-bar input').fill('Performance saved bookmark');
  await expect(ui.locator('.result.bookmark')).toHaveCount(1);
  await worker.evaluate(id => chrome.bookmarks.update(id, { title: 'Renamed performance bookmark' }), bookmark.id);
  await ui.locator('.search-bar input').fill('Renamed performance bookmark');
  await expect(ui.locator('.result.bookmark')).toHaveCount(1);
  await worker.evaluate(id => chrome.bookmarks.remove(id), bookmark.id);
  await expect(ui.locator('.result.bookmark')).toHaveCount(0);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English performance palette launch storage overlay opens and searches a large bookmark library', async () => {
  await worker.evaluate(async () => {
    const original = chrome.bookmarks.getTree.bind(chrome.bookmarks);
    chrome.bookmarks.getTree = (async () => [...await original(), ...Array.from({ length: 5000 }, (_, i) => ({
      id: `fixture-${i}`, title: `Reference ${i} developer documentation`, url: `https://docs.example.test/${i}`,
    }))]) as typeof chrome.bookmarks.getTree;
    await chrome.bookmarks.create({ title: 'Invalidate performance cache', url: 'https://example.test/' });
  });
  const page = await context.newPage(); await page.goto(`${origin}/Performance-launch`);
  const launch = () => worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  const surface = page.frameLocator('.justonehop-frame');
  const start = performance.now(); await launch();
  await expect(surface.locator('.result.command')).toHaveCount(9);
  const coldMs = Math.round(performance.now() - start);
  const input = surface.locator('.search-bar input');
  const searchMs: number[] = [];
  for (const query of ['ref', 'refer', 'reference', 'reference 42', 'new tab', 'iam']) {
    const start = performance.now(); await input.fill(query);
    if (query === 'iam') {
      await expect(surface.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
      await expect(surface.locator('.result.tab, .result.bookmark, .result.history, [id^="justonehop-command:"]')).toHaveCount(0);
      await expect(surface.locator('.result')).toHaveCount(2);
      await expect(surface.locator('.result').first()).toHaveAttribute('id', 'justonehop-google:https://www.google.com/search?q=iam');
      await expect(surface.locator('#justonehop-search-all-history')).toHaveCount(1);
    }
    else if (query === 'new tab') await expect(surface.locator('.result').first()).toHaveAttribute('id', 'justonehop-command:newTab');
    else await expect(surface.locator('.result.bookmark').first().locator('.entry-title mark').first()).toHaveText(query.split(' ')[0], { ignoreCase: true });
    searchMs.push(Math.round(performance.now() - start));
  }
  await page.keyboard.press('Escape'); await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
  const warm = performance.now(); await launch();
  await expect(surface.locator('.result.command')).toHaveCount(9);
  const warmMs = Math.round(performance.now() - warm);
  console.log(JSON.stringify({ performance: 'large-library', bookmarks: 5000, coldMs, warmMs, searchMs }));
  // Broad bounds catch a blocked UI; detailed timings remain observational.
  expect(coldMs).toBeLessThan(1000); expect(warmMs).toBeLessThan(500);
  expect(Math.max(...searchMs)).toBeLessThan(500);
});
});
