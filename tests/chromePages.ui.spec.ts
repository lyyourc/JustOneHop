import { test, expect } from './support/paletteUI';

// UI expectations are independent of the native destinations integration table.
const targets = [
  { action: 'openExtensions', en: 'Extensions', zh: '扩展管理' },
  { action: 'openPasswords', en: 'Password Manager', zh: '密码管理器' },
  { action: 'openDownloads', en: 'Downloads', zh: '下载内容' },
  { action: 'openHistory', en: 'History', zh: '历史记录' },
  { action: 'openBookmarks', en: 'Bookmark Manager', zh: '书签管理器' },
  { action: 'openChromeSettings', en: 'Chrome Settings', zh: 'Chrome 设置' },
  { action: 'openExtensionShortcuts', en: 'Extension Shortcuts', zh: '扩展快捷键' },
];

for (const locale of ['en-US', 'zh-CN'] as const) {
test(`Chrome Pages: ${locale === 'en-US' ? 'English' : 'Chinese'} UI labels aliases and mixed right-click Escape footer flow with provided replies`, async ({ palette }) => {
  const en = locale === 'en-US';
  const prefix = en ? 'Chrome Pages' : 'Chrome 内置页面';
  const bookmarkName = en ? 'Bookmark Manager' : '书签管理器';
  await palette.open({ locale, reply: request => request.type === 'execute' && request.payload.action === 'openBookmarks'
    ? { ok: false, error: 'UI dispatch recorded; native navigation is covered by extension E2E' } : undefined });
  const { ui } = palette;
  const search = ui.getByRole('combobox', { name: en ? 'Search commands, tabs, bookmarks, and history' : '搜索命令、标签页、书签和历史' });
  const first = ui.locator('#justonehop-results [role="option"]').first();
  for (const target of targets) await expect(ui.locator(`[id="justonehop-command:${target.action}"]`)).toHaveCount(0);
  await search.fill(prefix);
  for (const target of targets) {
    const row = ui.locator(`[id="justonehop-command:${target.action}"]`);
    await expect(row.locator('.entry-title')).toHaveText(`${prefix}: ${en ? target.en : target.zh}`);
    await expect(row.locator('.entry-shortcut')).toHaveCount(0);
  }
  await search.fill(en ? '插件' : 'extensions');
  await expect(first).toHaveAttribute('id', 'justonehop-command:openExtensions');
  await expect(first.locator('.entry-title')).toHaveText(`${prefix}: ${en ? 'Extensions' : '扩展管理'}`);
  await search.fill(en ? 'history' : '历史');
  await expect(first).toHaveAttribute('id', 'justonehop-search-all-history');
  await expect(ui.locator('[id="justonehop-command:openHistory"] .entry-title')).toHaveText(`${prefix}: ${en ? 'History' : '历史记录'}`);
  await search.fill(en ? 'Chrome Pages: History' : 'Chrome 内置页面：历史记录');
  await expect(first).toHaveAttribute('id', 'justonehop-command:openHistory');
  await expect(first.locator('.entry-title')).toHaveText(`${prefix}: ${en ? 'History' : '历史记录'}`);
  await search.fill(en ? 'Chrome Pages: downloads' : 'Chrome 内置页面：下载');
  await expect(first).toHaveAttribute('id', 'justonehop-command:openDownloads');
  await expect(first.locator('mark')).not.toHaveCount(0);
  for (const [query, expectedId] of [[en ? 'settings' : '设置', 'justonehop-command:settings'], [en ? 'shortcut' : '快捷键', 'justonehop-command:settings:keyboard']] as const) {
    await search.fill(query);
    await expect(first).toHaveAttribute('id', expectedId);
    await search.press('Enter');
    await expect(ui.getByRole('region', { name: en ? 'Settings' : '设置', exact: true })).toBeVisible();
    await ui.keyboard.press('Escape');
    await expect(search).toBeFocused(); await expect(search).toHaveValue(query);
  }
  expect((await palette.executions()).every(item => item.action === 'settings')).toBe(true);
  await search.fill(prefix);
  await search.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
  const bookmarks = ui.locator('[id="justonehop-command:openBookmarks"]');
  await expect(bookmarks).toHaveAttribute('aria-selected', 'false');
  await bookmarks.click({ button: 'right' });
  const actions = ui.getByRole('combobox', { name: en ? 'Search actions' : '搜索操作' });
  await expect(actions).toBeFocused(); await expect(ui.locator('.action-heading')).toContainText(bookmarkName);
  await actions.fill(en ? '书签管理' : 'bookmark manager');
  await expect(ui.locator('.action-row')).toHaveCount(1);
  await expect(ui.locator('.palette-footer .primary-action')).toContainText(bookmarkName);
  await ui.keyboard.press('Escape');
  await expect(search).toBeFocused(); await expect(search).toHaveValue(prefix);
  expect(await search.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
  await expect(bookmarks).toHaveAttribute('aria-selected', 'true');
  await search.press('Control+n'); await expect(bookmarks).toHaveAttribute('aria-selected', 'false');
  await search.press('Control+p'); await expect(bookmarks).toHaveAttribute('aria-selected', 'true');
  await ui.getByRole('button', { name: en ? 'Open action menu' : '打开操作菜单' }).click();
  await expect(actions).toBeFocused(); await expect(ui.locator('.action-row')).toHaveCount(1);
  await ui.locator('.palette-footer .primary-action').click();
  await expect.poll(async () => (await palette.executions()).filter(item => item.action === 'openBookmarks')).toHaveLength(1);
});
}
