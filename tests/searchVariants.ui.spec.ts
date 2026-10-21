import { test, expect, snapshotTab, fixtureOrigin } from './support/paletteUI';
import type { BookmarkItem } from '../src/types';

for (const locale of ['en-US', 'zh-CN'] as const) {
test(`${locale === 'en-US' ? 'English' : 'Chinese'} categorized candidates UI shows supplied shortcuts and keeps search matching and binding setup`, async ({ palette }) => {
  const en = locale === 'en-US';
  const snapshot = { windowId: 1, currentTabId: 1, bookmarks: [], tabs: [{ ...snapshotTab(1, 'source'), active: true }],
    shortcut: 'Alt+Space', tabSwitcherShortcut: 'Ctrl+Q' };
  await palette.open({ locale, reply: request => request.type === 'snapshot' ? { ok: true, data: snapshot } : undefined });
  const { ui } = palette;
  const search = ui.locator('.search-bar input');
  const switcher = ui.locator('[id="justonehop-command:tabSwitcher"]');
  await expect(switcher.locator('.entry-subtitle')).toHaveText('Switch tabs like in VS Code');
  await expect(switcher.locator('.entry-shortcut kbd')).toHaveText('Ctrl+Q');
  await search.fill('Code'); await expect(switcher).toBeVisible();
  await expect(switcher.locator('.entry-subtitle')).toHaveText('Switch tabs like in VS Code');
  await expect(switcher.locator('.entry-subtitle mark')).toHaveText('Code');
  await expect(switcher.locator('.entry-shortcut kbd')).toHaveText('Ctrl+Q');
  await search.fill('storage:local');
  const first = ui.locator('#justonehop-results [role="option"]').first();
  await expect(first.locator('.entry-title')).toHaveText(en ? 'Storage: View Local Storage' : '存储: 查看 Local Storage');
  await expect(first.locator('mark')).not.toHaveCount(0); await expect(first.locator('.entry-shortcut')).toHaveCount(0);
  await search.fill('new tab'); await expect(first.locator('.entry-title')).toHaveText(en ? 'Tab: New Tab' : '标签页: 新建标签页');
  await expect(first.locator('.entry-shortcut kbd')).toHaveText(['⌘T']);
  await search.fill('restore'); await expect(first.locator('.entry-shortcut kbd')).toHaveText(['⌘⇧T']);
  await search.fill('settings'); await expect(first.locator('.entry-shortcut kbd')).toHaveText(['⌘,']);
  await search.press('Meta+k'); await expect(ui.locator('.action-row .entry-shortcut kbd')).toHaveText(['⌘,']);
  await ui.keyboard.press('Meta+,'); await expect(ui.locator('.settings-view .palette-footer-title')).toHaveText(en ? 'Settings' : '设置');
  await ui.keyboard.press('Escape'); await search.fill('ctrl tab'); await search.press('Meta+ArrowUp');
  await expect(ui.locator('[id="justonehop-command:settings:binding"]')).toHaveAttribute('aria-selected', 'true');
  await search.press('Enter'); const setup = ui.locator('[data-setting=binding] button');
  await expect(setup).toBeFocused(); await setup.press('Enter');
  await expect(ui.locator('.binding-view')).toHaveAccessibleName(en ? 'Set Up Ctrl+Tab' : '配置 Ctrl+Tab');
  await expect(ui.locator('.binding-code-field textarea')).toHaveAttribute('readonly', '');
  await ui.keyboard.press('Escape'); await expect(setup).toBeFocused();
  await ui.keyboard.press('Escape'); await expect(search).toBeFocused();
  for (const theme of ['light', 'dark']) {
    await palette.provideStorage({ preferences: { language: en ? 'en' : 'zh', theme } });
    await search.fill('new tab'); await ui.setViewportSize({ width: 390, height: 516 });
    await ui.evaluate(() => { document.body.style.width = '390px'; });
    await expect(ui.locator('.justonehop-app')).toHaveAttribute('data-theme', theme);
    await expect(ui.locator('[id="justonehop-command:newTab"] .entry-shortcut')).toBeInViewport();
    expect(await ui.locator('.palette').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await ui.locator('.palette').screenshot({ path: test.info().outputPath(`justonehop-categories-${locale}-${theme}.png`) });
  }
  // Supply the unassigned state on a fresh mount without another browser context.
  snapshot.tabSwitcherShortcut = '';
  await ui.reload();
  await expect(search).toHaveValue('');
  await expect(switcher).toBeVisible();
  await expect(switcher.locator('.entry-shortcut')).toHaveCount(0);
  await search.fill('Code');
  await expect(switcher).toBeVisible();
  await expect(switcher.locator('.entry-subtitle mark')).toHaveText('Code');
  await expect(switcher.locator('.entry-shortcut')).toHaveCount(0);
});
}

test('bookmark result item zh-CN UI restores selection after provided removal replies through mouse and keyboard menus', async ({ palette }) => {
  const url = `${fixtureOrigin}/Bookmark-item-unopened?value=a%2Bb#saved-fragment`;
  const first: BookmarkItem = { id: 'alpha', title: 'Bookmark item Alpha', url, folder: '' };
  const second: BookmarkItem = { id: 'beta', title: 'Bookmark item Beta', url, folder: '' };
  const neighbor: BookmarkItem = { id: 'neighbor', title: 'Bookmark item Neighbor', url: `${fixtureOrigin}/neighbor`, folder: '' };
  const snapshot = { bookmarks: [first, second, neighbor] };
  await palette.open({ snapshot, reply: request => request.type === 'execute' && request.payload.action === 'removeBookmark'
    ? { ok: true, data: { message: '已移除 1 个书签' } } : undefined });
  const { ui } = palette;
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
  const actions = ui.getByRole('combobox', { name: '搜索操作' });
  const rows = ui.locator('#justonehop-results .result.bookmark');
  await input.fill('Bookmark item'); await expect(rows).toHaveCount(3);
  await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 7));
  for (const [index, bookmark] of [first, second].entries()) {
    const row = ui.locator(`[id="justonehop-bookmark:${bookmark.id}"]`);
    const remove = ui.locator(`[id="justonehop-actions-bookmark:${bookmark.id}:removeBookmark"]`);
    const order = await rows.evaluateAll(nodes => nodes.map(node => node.id));
    const at = order.indexOf(`justonehop-bookmark:${bookmark.id}`);
    const next = order[at + 1] ?? order[at - 1];
    // The next snapshot is supplied data, not a mock bookmarks implementation.
    snapshot.bookmarks.splice(0, snapshot.bookmarks.length, ...(index === 0 ? [second, neighbor] : [neighbor]));
    if (index === 0) {
      await row.click({ button: 'right' }); await expect(remove.locator(':scope > span')).toHaveText('取消收藏');
      await ui.getByRole('button', { name: '返回', exact: true }).click();
      await expect(input).toBeFocused(); await expect(row).toHaveAttribute('aria-selected', 'true');
      await ui.getByRole('button', { name: '打开操作菜单' }).click();
      await expect(remove.locator(':scope > span')).toHaveText('取消收藏');
      await expect(ui.locator('[id="justonehop-actions-action:unbookmarkTab"]')).toHaveCount(0);
      await remove.click();
    } else {
      await input.press('Meta+ArrowUp');
      const remaining = await rows.evaluateAll(nodes => nodes.map(node => node.id));
      for (let step = 0; step < remaining.indexOf(`justonehop-bookmark:${bookmark.id}`); step++) await input.press('ArrowDown');
      await expect(row).toHaveAttribute('aria-selected', 'true');
      await input.press('Meta+k'); await expect(actions).toBeFocused(); await ui.keyboard.type('unbookmark');
      await expect(remove.locator(':scope > span')).toContainText('取消收藏');
      await expect(remove).toHaveAttribute('aria-selected', 'true'); await ui.keyboard.press('Enter');
    }
    await expect.poll(async () => (await palette.executions()).filter(item => item.action === 'removeBookmark').map(item => item.bookmarkId)).toEqual(index === 0 ? ['alpha'] : ['alpha', 'beta']);
    await expect(ui.getByRole('alertdialog')).toHaveCount(0); await expect(ui.locator('.action-menu')).toHaveCount(0);
    await expect(ui.locator('.palette-footer')).toContainText('已移除 1 个书签');
    await expect(row).toHaveCount(0); await expect(rows).toHaveCount(2 - index);
    await expect(ui.locator('#justonehop-results [aria-selected="true"]')).toHaveAttribute('id', next);
    await expect(input).toHaveValue('Bookmark item'); await expect(input).toBeFocused();
    expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 7]);
  }
  await ui.keyboard.type('X'); await expect(input).toHaveValue('BoXk item');
});

test('Chinese bookmark search UI shows shortcut and disabled state for supplied bookmark snapshots', async ({ palette }) => {
  const bookmarks: BookmarkItem[] = [];
  await palette.open({ overlay: true, snapshot: { bookmarks }, reply: request => request.type === 'execute' && ['bookmarkTab', 'unbookmarkTab'].includes(request.payload.action)
    ? { ok: true, data: undefined } : undefined });
  const { ui } = palette; const surface = ui.frameLocator('.justonehop-frame');
  const input = surface.locator('.search-bar input'); await input.fill('收藏标签页');
  const add = surface.locator('[id="justonehop-command:bookmarkTab"]');
  const saved = { id: 'saved', title: 'Source', url: `${fixtureOrigin}/source`, folder: '' };
  await expect(add.locator('.entry-shortcut kbd')).toHaveText('⌘D');
  await expect(add.locator('.entry-shortcut')).toHaveAttribute('aria-label', 'Command + D');
  await add.click({ button: 'right' }); await expect(surface.locator('.action-row .entry-shortcut kbd')).toHaveText('⌘D');
  bookmarks.push(saved); await ui.keyboard.press('Meta+d');
  const remove = surface.locator('[id="justonehop-command:unbookmarkTab"]');
  await expect(remove).toBeVisible(); await expect(remove.locator('.entry-shortcut')).toHaveCount(0);
  const before = (await palette.executions()).length;
  for (const query of ['add bookmark', 'save bookmark', '添加书签']) {
    await input.fill(query);
    const remembered = surface.locator('#justonehop-results [aria-disabled="true"]');
    await expect(remembered).toContainText('已收藏');
    await expect(surface.locator('.primary-action')).toBeDisabled(); await expect(surface.locator('.actions-button')).toBeDisabled();
    await input.press('Enter'); const bounds = (await remembered.boundingBox())!;
    await ui.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    expect((await palette.executions()).length).toBe(before);
  }
  await input.fill('book'); await expect(remove).not.toHaveAttribute('aria-disabled', 'true');
  bookmarks.splice(0); await remove.click();
  await expect(add.locator('.entry-shortcut kbd')).toHaveText('⌘D');
  await expect(surface.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
  await input.press('Meta+ArrowUp'); await expect(add).toHaveAttribute('aria-selected', 'true');
  bookmarks.push(saved); await input.press('Enter');
  await expect(remove).toBeVisible(); await expect(remove.locator('.entry-shortcut')).toHaveCount(0);
  expect((await palette.executions()).map(item => item.action)).toEqual(['bookmarkTab', 'unbookmarkTab', 'bookmarkTab']);
});

test('Chinese home recommendations UI uses supplied usage events and freezes order until reopen', async ({ palette }) => {
  const learned = snapshotTab(2, 'Home-learned'); const cold = snapshotTab(4, 'Home-cold');
  const bookmarks = [
    { id: 'learned', title: 'Home learned bookmark', url: learned.url, folder: '' },
    { id: 'duplicate', title: 'Home duplicate bookmark', url: learned.url, folder: '' },
    { id: 'saved', title: 'Home saved page', url: `${fixtureOrigin}/Home-saved`, folder: '' },
    { id: 'another', title: 'Home another page', url: `${fixtureOrigin}/Home-another`, folder: '' },
    { id: 'current', title: 'Home source bookmark', url: `${fixtureOrigin}/source`, folder: '' },
  ];
  await palette.open({ overlay: true, snapshot: { tabs: [learned, { ...learned, id: 3 }, cold, snapshotTab(5, 'source')], bookmarks },
    reply: request => ['forget-usage', 'reset-usage', 'cancel-palette-continuation'].includes(request.type)
      || request.type === 'execute' && request.payload.action === 'mute' ? { ok: true, data: undefined } : undefined });
  const { ui } = palette; const surface = ui.frameLocator('.justonehop-frame');
  const input = surface.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
  const ids = () => surface.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id));
  const defaults = ['settings', 'help', 'tabSwitcher', 'searchAllHistory', 'newTab', 'reload', 'pin', 'localStorage', 'cookies']
    .map(action => action === 'searchAllHistory' ? 'justonehop-search-all-history' : `justonehop-command:${action}`);
  await expect.poll(ids).toEqual(defaults); await expect(surface.locator('.suggested-label')).toHaveCount(0);
  await expect(surface.locator('#justonehop-results')).toHaveAccessibleName('推荐'); await expect(surface.locator('.section-start')).toHaveCount(0);
  const usage = [
    { query: 'home learned', target: `tab:${learned.url}`, weight: 4 },
    { query: 'bookmark', target: 'bookmark:learned', weight: 4 }, { query: 'other query', target: 'bookmark:duplicate', weight: 4 },
    { query: 'reload', target: 'command:reload', weight: 10 }, { query: 'saved', target: 'bookmark:saved', weight: 5 },
    { query: 'another', target: 'bookmark:another', weight: 3 }, { query: 'source', target: `tab:${fixtureOrigin}/source`, weight: 100 },
    { query: 'source', target: 'bookmark:current', weight: 100 },
    ...['mute', 'restore', 'sessionStorage'].map(action => ({ query: action, target: `command:${action}`, weight: 100 })),
  ].map(record => ({ ...record, lastUsed: Date.now() }));
  await palette.provideStorage({ searchUsage: usage });
  for (const [action, queries] of [ ['mute', ['mute', '静音']], ['restore', ['restore', '恢复关闭的标签页']],
    ['sessionStorage', ['session storage', '会话存储']], ['tabSwitcher', ['tab switcher', '标签切换器']] ] as const) for (const query of queries) {
    await input.fill(query); await expect(surface.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
    await expect(surface.locator(`[id="justonehop-command:${action}"]`)).toBeVisible();
  }
  await input.fill('settings'); await expect(surface.locator('[id="justonehop-command:settings"]')).toHaveAttribute('aria-selected', 'true');
  await input.press('Enter'); await expect(surface.getByRole('region', { name: '设置', exact: true })).toBeVisible();
  await ui.keyboard.press('Escape'); await input.fill(''); await expect.poll(ids).toEqual(defaults);
  await surface.locator('[id="justonehop-command:settings"]').click(); await ui.keyboard.press('Escape');
  await input.fill('Home cold'); await expect(surface.locator('[id="justonehop-tab:4"]')).toHaveAttribute('aria-selected', 'true');
  await input.press('Meta+k'); const actions = surface.getByRole('combobox', { name: '搜索操作' });
  await actions.fill('mute'); await actions.press('Enter'); await expect(surface.getByRole('dialog')).toHaveCount(0);
  await expect(input).toHaveValue('Home cold'); await expect(input).toBeFocused();
  await input.fill(''); await expect.poll(ids).toEqual(defaults); await ui.keyboard.press('Escape');
  await expect(ui.locator('#justonehop-command-palette')).not.toBeAttached();
  expect(await palette.dispatch({ source: 'justonehop', type: 'toggle' })).toBe(true);
  await expect(surface.locator('#justonehop-results .result')).toHaveCount(10);
  const order = await ids();
  expect(order.slice(0, 4)).toEqual(['justonehop-tab:2', 'justonehop-command:reload', 'justonehop-bookmark:saved', 'justonehop-bookmark:another']);
  expect(order).toContain('justonehop-command:settings');
  for (const id of [1, 3, 4, 5]) expect(order).not.toContain(`justonehop-tab:${id}`);
  for (const id of ['current', 'learned', 'duplicate']) expect(order).not.toContain(`justonehop-bookmark:${id}`);
  for (const action of ['mute', 'restore', 'sessionStorage']) expect(order).not.toContain(`justonehop-command:${action}`);
  const forget = surface.locator('[id="justonehop-tab:2"] button.ranking-forget');
  await expect(forget).toHaveAccessibleName('忘记此页面的偏好'); await forget.click();
  await expect.poll(() => palette.requests.filter(request => request.type === 'forget-usage')).toHaveLength(1);
  await palette.provideStorage({ searchUsage: usage.filter(record => ![`tab:${learned.url}`, 'bookmark:learned', 'bookmark:duplicate'].includes(record.target)) });
  await expect(forget).toHaveCount(0); await expect.poll(ids).toEqual(order);
  await input.fill('help'); await expect(surface.locator('[id="justonehop-command:help"]')).toHaveAttribute('aria-selected', 'true');
  await input.press('Enter'); await expect(surface.locator('.help-view')).toBeVisible();
  await ui.keyboard.press('Escape'); await input.fill(''); await expect.poll(ids).toEqual(order);
  await surface.getByRole('button', { name: '设置', exact: true }).click();
  // Deliver the controlled storage event before the reset completion refreshes home scores.
  await palette.provideStorage({ searchUsage: [] });
  await surface.getByRole('button', { name: '重置搜索排序', exact: true }).click();
  await expect(surface.getByRole('status')).toBeVisible(); await ui.keyboard.press('Escape');
  await expect.poll(ids).toEqual(defaults); await expect(surface.locator('button.ranking-forget')).toHaveCount(0);
});
