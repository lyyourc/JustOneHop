import { test, expect, snapshotTab } from './support/paletteUI';

test.use({ viewport: { width: 1100, height: 760 }, reducedMotion: 'reduce' });

test('unified bilingual search, pinyin ranking, action menu, Esc and search fallback', async ({ palette }) => {
  const { ui } = palette;
  await palette.open({ snapshot: { tabs: [
    { ...snapshotTab(2, 'roadmap'), title: '产品路线图', pinned: true },
    { ...snapshotTab(3, 'literal'), title: 'CPLXT' },
  ] } });
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });

  await test.step('unified bilingual search, action menu, Esc and search fallback', async () => {
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('');
    await input.fill('close right');
    await expect(ui.getByRole('option').first()).toContainText('关闭右侧');
    await input.fill('刷新');
    await expect(ui.getByRole('option').first()).toContainText('刷新');
    await input.press('Meta+k');
    await expect(ui.getByRole('combobox', { name: '搜索操作' })).toBeFocused();
    await ui.keyboard.press('Escape');
    await expect(input).toHaveValue('刷新');
    await expect(input).toBeFocused();
    await input.fill('');
    await input.press('ArrowUp');
    await expect(ui.locator('.result').last()).toHaveAttribute('aria-selected', 'true');
    await input.press('ArrowDown');
    await expect(ui.locator('.result').first()).toHaveAttribute('aria-selected', 'true');
    await input.press('Backspace');
    await expect(input).toHaveValue('');
    await expect(ui.getByText('快捷访问', { exact: true })).toHaveCount(0);
    await expect(ui.locator('.navigation-hint .navigation-key').first().locator('kbd')).toHaveText(['Ctrl+P']);
    await expect(ui.locator('.mode-button')).toHaveCount(0);
    await input.fill('zzzz-no-such-result');
    await expect(ui.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
    await expect(ui.locator('.result.tab, .result.bookmark, .result.history, [id^="justonehop-command:"]')).toHaveCount(0);
    await expect(ui.getByRole('option')).toHaveCount(2);
    await expect(ui.getByRole('option').first()).toHaveAttribute('id', 'justonehop-google:https://www.google.com/search?q=zzzz-no-such-result');
    await expect(ui.locator('#justonehop-search-all-history')).toBeVisible();
    await expect(ui.getByRole('button', { name: '打开操作菜单' })).toBeEnabled();
  });

  await test.step('pinyin search keeps literal hits first and highlights Chinese through keyboard and mouse navigation', async () => {
    await input.fill('');
    await input.pressSequentially('cplxt');
    await expect(ui.getByRole('option').first()).toContainText('CPLXT');
    const chinese = ui.locator('[id="justonehop-tab:2"]');
    await expect(chinese.locator('.entry-title mark')).toHaveText('产品路线图');
    await input.press('ArrowDown');
    await expect(chinese).toHaveAttribute('aria-selected', 'true');
    await chinese.click({ button: 'right' });
    await expect(ui.getByRole('combobox', { name: '搜索操作' })).toBeFocused();
    await ui.keyboard.press('Escape');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('cplxt');
    await input.fill('chanpin luxian');
    await expect(ui.getByRole('option').first()).toContainText('产品路线图');
    await expect(chinese.locator('.entry-title mark')).toHaveText('产品路线');
  });
});

test('Palette startup renders a recoverable error when background messages fail', async ({ palette }) => {
  const { ui } = palette;
  const errors: string[] = [];
  ui.on('pageerror', error => errors.push(error.message));
  ui.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await palette.open({ locale: 'en-US', startupFailure: true });
  await expect(ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' })).toBeVisible();
  await expect(ui.getByRole('alert')).toContainText('The extension disconnected');
  await ui.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(ui.getByRole('alert')).toContainText('The extension disconnected');
  expect(errors).toEqual([]);
});
