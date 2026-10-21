import { test as base, expect } from '@playwright/test';
import { test, defaults, origin, context, ui, worker } from './support/paletteFixture';
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

for (const variant of ['English', 'fallback', 'Taiwan']) {
  test.describe(() => {
    test.use({ environment: { ...defaults, locale: variant === 'English' ? 'en-US' : variant === 'fallback' ? 'fr-FR' : 'zh-TW' } });
    test(`${variant} locale resolves manifest, commands, actions, counts and errors`, async () => {
    const chinese = variant === 'Taiwan';
    const input = ui.getByRole('combobox', { name: chinese ? '搜索命令、标签页、书签和历史' : 'Search commands, tabs, bookmarks, and history' });
    await expect(input).toBeFocused();
    expect(await ui.evaluate(() => chrome.runtime.getManifest().name)).toBe(chinese ? '小范围瞬移' : 'JustOneHop');
    await expect(ui.locator('.navigation-label')).toHaveText(chinese ? ['上一个', '下一个'] : ['Previous', 'Next']);
    if (!chinese) expect(await ui.locator('.justonehop-app').innerText()).not.toMatch(/[\p{Script=Han}]/u);
    await input.fill('刷新');
    await expect(ui.locator('.result')).toHaveCount(3);
    await expect(ui.locator('[id="justonehop-command:reload"]')).toContainText(chinese ? '刷新当前标签页' : 'Reload Current Tab');
    await expect(ui.locator('#justonehop-search-all-history .entry-title')).toHaveText(chinese ? '搜索全部历史' : 'Search All History');
    await expect(ui.locator('[id^="justonehop-google:"] .entry-title')).toHaveText(chinese ? '在 Google 搜索『刷新』' : 'Search Google for “刷新”');
    await expect(ui.locator('.result-status')).toContainText(chinese ? '3 个结果' : '3 results');
    await input.press('Meta+k');
    const actions = ui.getByRole('combobox', { name: chinese ? '搜索操作' : 'Search actions' });
    await expect(actions).toBeFocused();
    await actions.fill('not-a-real-action');
    await expect(ui.locator('.action-empty')).toHaveText(chinese ? '没有匹配的操作' : 'No matching actions');
    await actions.press('Escape');
    await input.fill('restore');
    await input.press('Meta+ArrowUp');
    await expect(ui.locator('[id="justonehop-command:restore"]')).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
    await expect(ui.getByRole('alert')).toContainText(chinese ? '没有可以恢复的标签页。' : 'No recently closed tabs to restore.');
    if (variant === 'English') await test.step('Language override localizes errors and system mode follows Chrome', async () => {
      const settings = ui.locator('.palette-footer .footer-navigation.settings-button');
      await expect(settings).toHaveAccessibleName('Settings');
      await settings.click();
      await ui.getByRole('combobox', { name: 'Language', exact: true }).click();
      await ui.getByRole('option', { name: '简体中文', exact: true }).click();
      await ui.keyboard.press('Escape');
      const translated = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
      await translated.fill('restore');
      await expect(ui.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
      await translated.press('Meta+ArrowUp');
      await expect(ui.locator('[id="justonehop-command:restore"]')).toHaveAttribute('aria-selected', 'true');
      await translated.press('Enter');
      await expect(ui.getByRole('alert')).toContainText('没有可以恢复的标签页。');
      await translated.press('Meta+,');
      await ui.getByRole('combobox', { name: '语言', exact: true }).click();
      await ui.getByRole('option', { name: '跟随系统', exact: true }).click();
      await expect(ui.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
      await expect(ui.getByText('System language: English (Chrome interface)')).toBeVisible();
      await ui.keyboard.press('Escape');
      await expect(input).toBeFocused();
    });
    await input.fill('close right');
    await expect(ui.locator('.footer-status')).toHaveText(chinese ? '将关闭 0 个标签页' : 'Will close 0 tabs');
    await ui.setViewportSize({ width: 390, height: 400 });
    // Use the same responsive palette surface as an overlay for layout assertions.
    await ui.locator('.justonehop-app').evaluate(node => { node.classList.replace('popup', 'overlay'); document.body.style.width = '390px'; });
    const footer = await ui.locator('.footer').boundingBox();
    const button = await ui.getByRole('button', { name: chinese ? '打开操作菜单' : 'Open action menu' }).boundingBox();
    expect(button!.x + button!.width).toBeLessThanOrEqual(footer!.x + footer!.width);
    await ui.locator('.palette').screenshot({ path: test.info().outputPath(`i18n-${variant.toLowerCase()}.png`) });
  });
  });
}

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
  test('English command highlighting and exact intent preserve text and Enter execution', async () => {
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
    await ui.evaluate(async base => { await chrome.bookmarks.create({ title: 'New Tab', url: base }); }, origin);
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
  });
});
});

for (const language of ['Chinese', 'English']) test.describe(() => {
  test.use({ environment: { ...defaults, locale: language === 'English' ? 'en-US' : 'zh-CN' } });
  test(`${language} short queries reject noise while command typos and exact aliases still work`, async () => {
  const chinese = language === 'Chinese';
  const page = await context.newPage();
  await page.goto(`${origin}/EchoTech-IAM`);
  const noise = await context.newPage();
  await noise.goto(`${origin}/Example-Domain`);
  await ui.evaluate(async base => {
    await chrome.bookmarks.create({ title: 'WebSequenceDiagrams', url: `${base}/Programming` });
    await chrome.bookmarks.create({ title: 'IAM Handbook', url: `${base}/Handbook` });
  }, origin);
  await ui.bringToFront();
  const input = ui.getByRole('combobox', { name: chinese ? '搜索命令、标签页、书签和历史' : 'Search commands, tabs, bookmarks, and history' });
  await input.fill('iam');
  await expect(ui.locator('.result')).toHaveCount(4);
  await expect(ui.locator('.result.tab .entry-title')).toHaveText('EchoTech IAM');
  await expect(ui.locator('.result.bookmark .entry-title')).toHaveText('IAM Handbook');
  await expect(ui.locator('[id^="justonehop-command:"]')).toHaveCount(0);
  await expect(ui.locator('#justonehop-search-all-history')).toHaveCount(1);
  await expect(ui.locator('[id^="justonehop-google:"]')).toHaveCount(1);
  await expect(ui.locator('.result.tab .entry-title mark, .result.bookmark .entry-title mark')).toHaveText(['IAM', 'IAM']);
  await ui.locator('.palette').screenshot({ path: test.info().outputPath(`strict-search-${language.toLowerCase()}.png`) });
  await input.fill('iam nonexistent');
  await expect(ui.locator('.result')).toHaveCount(2);
  await expect(ui.locator('.result.tab, .result.bookmark, .result.history, [id^="justonehop-command:"]')).toHaveCount(0);
  await expect(ui.locator('.result').first()).toHaveAttribute('id', 'justonehop-google:https://www.google.com/search?q=iam+nonexistent');
  await expect(ui.locator('#justonehop-search-all-history')).toHaveCount(1);
  await input.fill('xinjiam');
  await expect(ui.locator('[id^="justonehop-command:"]')).toHaveCount(0);
  await input.fill('xinjian');
  await expect(ui.locator('.result').first()).toHaveAttribute('id', 'justonehop-command:newTab');
  await input.fill('reloda');
  await expect(ui.locator('.result').first()).toHaveAttribute('id', 'justonehop-command:reload');
  if (chinese) {
    await expect(ui.locator('.result').first().locator('.entry-subtitle')).toHaveText('reload');
    await expect(ui.locator('.result').first().locator('.entry-subtitle mark').first()).toBeVisible();
  }
  await input.fill('cl');
  await expect(ui.locator('.result.danger')).toHaveCount(0);
  await input.pressSequentially('o');
  await expect(ui.locator('.result').first()).toHaveAttribute('id', 'justonehop-command:close');
  await expect(ui.locator('.result.danger')).toHaveCount(3);
  await expect(ui.locator('.result').first().locator('mark').first()).toHaveText(chinese ? 'clo' : 'Clo');
  for (const [query, action] of [['tab clo', 'close'], ['clo oth', 'closeOthers'], ['tab clo ri', 'closeRight'], ['guan', 'close'], ['关闭', 'close'], ['reload ext', 'reloadExtension']]) {
    await input.fill(query);
    await expect(ui.locator('.result').first()).toHaveAttribute('id', `justonehop-command:${action}`);
  }
  await input.fill('EchoTech IAM');
  await expect(ui.locator('.result[aria-selected="true"] .entry-title')).toHaveText('EchoTech IAM');
  await input.press('Meta+k');
  const action = ui.getByRole('combobox', { name: chinese ? '搜索操作' : 'Search actions' });
  await action.fill('iam');
  await expect(ui.locator('.action-row')).toHaveCount(1);
  await expect(ui.locator('.action-row').first()).toContainText(chinese ? '切换' : 'Switch');
  await expect(ui.locator('.action-row.danger')).toHaveCount(0);
  await action.fill('reloda');
  await expect(ui.locator('.action-row').first()).toContainText(chinese ? '刷新' : 'Reload');
  if (chinese) await expect(ui.locator('.action-row').first().locator('.action-alias mark').first()).toBeVisible();
  await action.fill('tab clo');
  await expect(ui.locator('.action-row').first()).toContainText(chinese ? '关闭标签页' : 'Close Tab');
  if (chinese) await expect(ui.locator('.action-row').first().locator('.action-alias mark')).toHaveText(['clo', 'tab']);
  await action.press('Escape');
  await expect(input).toHaveValue('EchoTech IAM');
  await expect(input).toBeFocused();
  await ui.locator('.result.tab').click({ button: 'right' });
  await expect(action).toBeFocused();
  await action.fill('clo');
  await action.press('Meta+ArrowUp');
  await expect(ui.locator('.action-row[aria-selected="true"]')).toHaveAttribute('id', 'justonehop-actions-action:close');
  const actionOrder = await ui.locator('.action-row').evaluateAll(nodes => nodes.map(node => node.id));
  expect(new Set(actionOrder)).toEqual(new Set(['justonehop-actions-action:close', 'justonehop-actions-action:closeOthers', 'justonehop-actions-action:closeRight']));
  await action.press('Control+n');
  await expect(ui.locator('.action-row[aria-selected="true"]')).toHaveAttribute('id', actionOrder[1]);
  await action.press('Control+p');
  await expect(ui.locator('.action-row[aria-selected="true"]')).toHaveAttribute('id', 'justonehop-actions-action:close');
  if (chinese) await ui.locator('.action-row[aria-selected="true"]').click();
  else await action.press('Enter');
  await expect.poll(() => page.isClosed()).toBe(true);
  await expect(input).toHaveValue('EchoTech IAM');
  await expect(input).toBeFocused();
  await expect(ui.locator('.result.tab')).toHaveCount(0);
  await expect(ui.locator('#justonehop-search-all-history')).toHaveCount(1);
  await expect(ui.locator('[id^="justonehop-google:"]')).toHaveCount(1);
  expect(noise.isClosed()).toBe(false);
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

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English pinned hostname result outranks bookmark prefixes and switches without opening a duplicate', async () => {
  const target = await context.newPage(); await target.goto(`${origin}/Service-Console`);
  const targetId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, target.url());
  await worker.evaluate(async ({ id, base }) => {
    await chrome.tabs.update(id, { pinned: true });
    for (const name of ['api', 'dev', 'prod']) await chrome.bookmarks.create({ title: `127 ${name}`, url: `${base}/${name}` });
  }, { id: targetId, base: origin });
  await ui.bringToFront(); await ui.reload();
  const input = ui.getByRole('combobox');
  await input.fill('127');
  await expect(ui.getByRole('option').first()).toContainText('Service Console');
  await input.fill('127 api');
  await expect(ui.getByRole('option').first()).toContainText('127 api');
  await input.fill('127');
  await expect(ui.getByRole('option').first()).toContainText('Service Console');
  await input.press('Enter');
  await expect.poll(() => ui.isClosed()).toBe(true);
  await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).active, targetId)).toBe(true);
  expect(await worker.evaluate(async url => (await chrome.tabs.query({})).filter(tab => tab.url === url).length, target.url())).toBe(1);
});
});
