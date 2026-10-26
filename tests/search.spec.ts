import { test as base, expect } from '@playwright/test';
import { test, defaults, origin, context, ui, worker, popupUrl } from './support/paletteFixture';
import { registerPaletteFixture } from './support/paletteFixture';

registerPaletteFixture();

test('search isolates windows, merges bookmarks, and target actions mute the selected tab', { tag: '@windows' }, async () => {
  const target = await ui.evaluate(async base => {
    const current = await chrome.tabs.getCurrent();
    const tab = await chrome.tabs.create({ windowId: current!.windowId, url: `${base}/Design-Notes`, active: false });
    await chrome.bookmarks.create({ title: 'Design Reference', url: `${base}/Reference` });
    await chrome.windows.create({ url: `${base}/OtherWindowUnique`, focused: false });
    return tab.id!;
  }, origin);
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
  await input.fill('OtherWindowUnique');
  await expect(ui.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
  await expect(ui.locator('.result.tab')).toHaveCount(0);
  await input.fill('Design');
  await expect(ui.locator('.result.tab')).toHaveCount(1);
  await expect(ui.locator('.result.bookmark')).toHaveCount(1);
  await expect(ui.locator('.result.bookmark')).toContainText('Design Reference');
  await input.fill('Design Notes');
  await expect(ui.locator('.result.tab')).toHaveCount(1);
  await expect(ui.locator('.result.bookmark')).toHaveCount(0);
  await input.press('Meta+ArrowUp');
  await expect(ui.locator('.result.tab')).toHaveAttribute('id', `justonehop-tab:${target}`);
  await expect(ui.locator('.result.tab')).toHaveAttribute('aria-selected', 'true');
  await input.press('Meta+k');
  const action = ui.getByRole('combobox', { name: '搜索操作' });
  await action.fill('mute');
  await expect(ui.locator('#justonehop-actions [aria-selected="true"]')).toContainText('静音');
  await action.press('Enter');
  await expect.poll(() => worker.evaluate(id => chrome.tabs.get(id).then(t => t.mutedInfo?.muted), target)).toBe(true);
  await expect(ui.getByRole('dialog')).toHaveCount(0);
  await expect(input).toHaveValue('Design Notes');
  await expect(input).toBeFocused();
});

test('unified results preserve Chinese highlights and action context before Enter switches tabs', async () => {
  const seed = await ui.evaluate(async base => {
    const self = (await chrome.tabs.getCurrent())!;
    const older = await chrome.tabs.create({ url: `${base}/New-Tab-Guide`, active: false });
    const newer = await chrome.tabs.create({ url: `${base}/New-Tab-Notes`, active: false });
    await chrome.bookmarks.create({ title: 'New Tab Handbook', url: `${base}/Handbook` });
    return { self: self.id!, older: older.id!, newer: newer.id! };
  }, origin);
  await expect.poll(() => worker.evaluate(id => chrome.tabs.get(id).then(tab => tab.status), seed.newer)).toBe('complete');
  await worker.evaluate(async ids => {
    await chrome.tabs.update(ids.older, { active: true });
    await chrome.tabs.update(ids.newer, { active: true });
    await chrome.tabs.update(ids.self, { active: true });
  }, seed);
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
  await expect(input).toHaveValue('');
  await expect(ui.locator('.result.tab')).toHaveCount(0);
  await expect(ui.locator('.result.command')).toHaveCount(9);
  await expect(ui.locator('.result.danger')).toHaveCount(0);
  await input.fill('new tab');
  await expect(ui.locator('.result.tab')).toHaveCount(2);
  await expect(ui.locator('.result.bookmark')).toHaveCount(1);
  await expect(ui.locator('[id="justonehop-command:newTab"]')).toContainText('新建标签页');
  await expect(ui.locator('.result').first()).toHaveAttribute('id', 'justonehop-command:newTab');
  await expect(ui.locator('.result').first()).toHaveAttribute('aria-selected', 'true');
  await expect(ui.locator('.kind-label').filter({ hasText: '书签' })).toBeVisible();
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('unified-search.png') });
  await test.step('Chinese titles, translated aliases and URLs highlight in both themes', async () => {
    const command = ui.locator('[id="justonehop-command:newTab"]');
    const tab = ui.locator(`[id="justonehop-tab:${seed.newer}"]`);
    await expect(command.locator('.entry-title')).toHaveText('标签页: 新建标签页');
    await expect(command.locator('.entry-subtitle mark')).toHaveText(['new', 'tab']);
    await expect(tab.locator('.entry-title mark')).toHaveText(['New', 'Tab']);
    for (const theme of ['light', 'dark']) {
      await ui.evaluate(async theme => { await chrome.storage.local.set({ preferences: { language: 'zh', theme } }); }, theme);
      await expect(ui.locator('.justonehop-app')).toHaveAttribute('data-theme', theme);
      await ui.locator('.palette').screenshot({ path: test.info().outputPath(`highlight-${theme}.png`) });
    }
    await input.fill('127.0.0.1');
    await expect(tab.locator('.entry-subtitle mark')).toHaveText('127.0.0.1');
    await input.fill('刷新');
    await expect(ui.locator('[id="justonehop-command:reload"] .entry-title mark')).toHaveText('刷新');
    await input.fill('New Tab Notes');
    await expect(tab).toBeVisible();
    await expect(ui.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
    await input.press('Meta+ArrowUp');
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await input.press('Meta+k');
    const action = ui.getByRole('combobox', { name: '搜索操作' });
    await action.fill('关闭');
    await expect(ui.locator('.action-row.danger mark')).toHaveText(['关闭', '关闭', '关闭']);
    await expect(ui.locator('[id="justonehop-actions-action:mute"] .action-alias')).toHaveText('关闭声音');
    await expect(ui.locator('[id="justonehop-actions-action:mute"] mark')).toHaveText('关闭');
    await action.fill('close right');
    await expect(ui.locator('.action-row').first().locator('.action-alias mark')).toHaveText(['close', 'right']);
    await ui.keyboard.press('Escape');
    await expect(input).toHaveValue('New Tab Notes');
    await input.fill('');
    await expect(ui.locator('.result mark')).toHaveCount(0);
  });
  await input.fill('New Tab Notes');
  await expect(ui.locator('.result.tab')).toHaveCount(1);
  await expect(ui.locator('.result.bookmark')).toHaveCount(0);
  await input.press('Meta+ArrowUp');
  await expect(ui.locator(`[id="justonehop-tab:${seed.newer}"]`)).toHaveAttribute('aria-selected', 'true');
  await input.press('Meta+k');
  await ui.getByRole('combobox', { name: '搜索操作' }).fill('close');
  await expect(ui.locator('.action-row')).toHaveCount(3);
  await ui.keyboard.press('Escape');
  await expect(input).toHaveValue('New Tab Notes');
  await expect(ui.locator(`[id="justonehop-tab:${seed.newer}"]`)).toHaveAttribute('aria-selected', 'true');
  const count = await worker.evaluate(() => chrome.tabs.query({}).then(tabs => tabs.length));
  await input.press('Enter');
  await expect.poll(() => worker.evaluate(id => chrome.tabs.get(id).then(tab => tab.active), seed.newer)).toBe(true);
  expect(await worker.evaluate(() => chrome.tabs.query({}).then(tabs => tabs.length))).toBe(count - 1); // The standalone test popup closes after execution.
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English command highlighting, exact intent, and pinned hostname priority', async () => {
    const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await test.step('Title and fuzzy highlights preserve command text', async () => {
      await input.fill('new tab');
      const newTab = ui.locator('[id="justonehop-command:newTab"]');
      await expect(newTab.locator('.entry-title')).toHaveText('Tab: New Tab');
      await expect(newTab.locator('.entry-title mark')).toHaveText(['Tab', 'New', 'Tab']);
      await expect(newTab.locator('.entry-subtitle')).toHaveCount(0);
      await input.fill('reloda');
      const reload = ui.locator('[id="justonehop-command:reload"]');
      await expect(ui.locator('.result').first()).toHaveAttribute('id', 'justonehop-command:reload');
      await expect(reload).toContainText('Reload Current Tab');
      await expect(reload.locator('mark').first()).toBeVisible();
    });
    await test.step('Exact command outranks identical page titles and Enter opens a tab', async () => {
      const page = await context.newPage();
      await page.goto(`${origin}/New-Tab`);
      const bookmark = await ui.evaluate(async base => chrome.bookmarks.create({ title: 'New Tab', url: base }), origin);
      await ui.bringToFront();
      await input.fill('new tab');
      await expect(ui.locator('.result.tab')).toHaveCount(1);
      await expect(ui.locator('.result.bookmark')).toHaveCount(1);
      await expect(ui.locator('.result').first()).toHaveAttribute('id', 'justonehop-command:newTab');
      await expect(ui.locator('.result').first()).toHaveAttribute('aria-selected', 'true');
      const created = context.waitForEvent('page');
      await input.press('Enter');
      const newTab = await created;
      await expect(newTab).toHaveURL(/^chrome:\/\/(?:newtab|new-tab-page)\/$/);
      await expect.poll(() => worker.evaluate(() => chrome.tabs.query({ active: true }).then(tabs => tabs.some(tab => tab.url === 'chrome://newtab/')))).toBe(true);
      await newTab.close();
      await page.close();
      await worker.evaluate(id => chrome.bookmarks.remove(id), bookmark.id);
    });
    await test.step('Pinned hostname result outranks bookmark prefixes and switches without opening a duplicate', async () => {
      const target = await context.newPage(); await target.goto(`${origin}/Service-Console`);
      const targetId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, target.url());
      await worker.evaluate(async ({ id, base }) => {
        await chrome.tabs.update(id, { pinned: true });
        for (const name of ['api', 'dev', 'prod']) await chrome.bookmarks.create({ title: `127 ${name}`, url: `${base}/${name}` });
      }, { id: targetId, base: origin });
      const nextUi = ui.isClosed() ? await context.newPage() : ui;
      await nextUi.goto(popupUrl);
      const nextInput = nextUi.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
      await nextInput.fill('127');
      await expect(nextUi.getByRole('option').first()).toContainText('Service Console');
      await nextInput.fill('127 api');
      await expect(nextUi.getByRole('option').first()).toContainText('127 api');
      await nextInput.fill('127');
      await expect(nextUi.getByRole('option').first()).toContainText('Service Console');
      await nextInput.press('Enter');
      await expect.poll(() => nextUi.isClosed()).toBe(true);
      await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).active, targetId)).toBe(true);
      expect(await worker.evaluate(async url => (await chrome.tabs.query({})).filter(tab => tab.url === url).length, target.url())).toBe(1);
    });
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English palette launch storage overlay native favicons render cached website icons and fall back on errors', async () => {
  const website = await context.newPage(); await website.goto(`${origin}/Favicon-site`);
  await expect.poll(() => worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.favIconUrl || '', website.url())).toContain('/fixture-icon.png');
  await worker.evaluate(url => chrome.bookmarks.create({ title: 'Favicon bookmark', url }), website.url());
  await ui.bringToFront(); await ui.reload();
  const input = ui.locator('.search-bar input'); await input.fill('Favicon');
  for (const kind of ['tab', 'bookmark']) {
    const row = ui.locator(`.result.${kind}`).first();
    await expect(row.locator('.entry-title')).toHaveText(kind === 'tab' ? 'Favicon site' : 'Favicon bookmark');
    const icon = row.locator('img.entry-favicon.loaded');
    await expect(icon).toBeVisible();
    expect(await icon.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(32);
    expect(await icon.getAttribute('src')).toContain('/_favicon/?pageUrl=');
  }
  await website.bringToFront();
  await worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  const surface = website.frameLocator('.justonehop-frame');
  const search = surface.locator('.search-bar input'); await search.fill('Favicon site');
  const icon = surface.locator('.result.tab img.entry-favicon.loaded').first();
  await expect(icon).toBeVisible();
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('justonehop-favicon-overlay.png') });
  // A real image failure must leave a type icon, never a broken-image glyph.
  await icon.evaluate((img: HTMLImageElement) => { img.src = img.src.replace('/_favicon/', '/missing-icon.png'); });
  await expect(surface.locator('.result.tab img')).toHaveCount(0);
  await expect(surface.locator('.result.tab .entry-icon svg')).toBeVisible();
  await search.fill('close tab'); await expect(surface.locator('.result.command .entry-shortcut').first()).toHaveText('⌘W');
  await search.fill('reload'); await expect(surface.locator('.result.command .entry-shortcut').first()).toHaveText('⌘R');
  await search.fill('settings'); await search.press('Meta+,');
  await expect(surface.locator('.settings-view .palette-footer-title')).toHaveText('Settings');
});
});
