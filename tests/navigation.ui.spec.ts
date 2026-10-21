import { test, expect, fixtureOrigin, snapshotTab } from './support/paletteUI';

test.use({ viewport: { width: 1100, height: 760 }, reducedMotion: 'reduce' });

test('IME Enter does not execute and the popup has no horizontal overflow', async ({ palette }) => {
  const { ui } = palette;
  await palette.open();
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true, bubbles: true });
  expect(await palette.executions()).toEqual([]);
  expect(await ui.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(750);
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('palette.png') });
});

test('Raycast navigation pages, jumps to home endpoints and restores caret when actions close', async ({ palette }) => {
  const { ui } = palette;
  await palette.open({ snapshot: {
    tabs: Array.from({ length: 12 }, (_, i) => snapshotTab(i + 2, `Navigation-${i}`)),
    bookmarks: [{ id: 'navigation', title: 'Navigation Bookmark', url: `${fixtureOrigin}/Navigation-Bookmark`, folder: '' }],
  } });
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
  await input.fill('');
  await expect(ui.locator('.section-start')).toHaveCount(0);
  await expect(ui.locator('.suggested-label')).toHaveCount(0);
  await input.press('Meta+ArrowUp');
  await expect(ui.locator('.result').first()).toHaveAttribute('aria-selected', 'true');
  await input.press('Meta+ArrowDown');
  await expect(ui.locator('.result').last()).toHaveAttribute('aria-selected', 'true');
  await input.press('Meta+ArrowUp');
  await expect(ui.locator('#justonehop-results [aria-selected="true"]')).toHaveAttribute('id', await ui.locator('.result').first().getAttribute('id') as string);
  await input.press('PageDown');
  const selectedIndex = await ui.locator('.result').evaluateAll(rows => rows.findIndex(row => row.getAttribute('aria-selected') === 'true'));
  expect(selectedIndex).toBeGreaterThan(1);
  await input.press('PageUp');
  await expect(ui.locator('.result').first()).toHaveAttribute('aria-selected', 'true');
  await input.fill('reload');
  await input.evaluate((element: HTMLInputElement) => element.setSelectionRange(2, 5));
  await input.press('Meta+k');
  const actionInput = ui.getByRole('combobox', { name: '搜索操作' });
  await expect(actionInput).toBeFocused();
  const menu = ui.getByRole('dialog', { name: '操作菜单', exact: true });
  await ui.keyboard.press('Tab');
  await expect(menu.locator('.search-dismiss')).toBeFocused();
  await ui.keyboard.press('Tab');
  await expect(menu.locator('[data-focus-search]')).toBeFocused();
  await ui.keyboard.press('Tab');
  await expect(actionInput).toBeFocused();
  await ui.keyboard.press('Shift+Tab');
  await expect(menu.locator('[data-focus-search]')).toBeFocused();
  await ui.keyboard.press('Meta+k');
  await expect(input).toBeFocused();
  expect(await input.evaluate((element: HTMLInputElement) => [element.selectionStart, element.selectionEnd])).toEqual([2, 5]);
  await expect(input).toHaveValue('reload');
});

test('stationary pointer does not steal keyboard selection; modified Enter does not execute', async ({ palette }) => {
  const { ui } = palette;
  await palette.open();
  const rows = ui.locator('.result');
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
  await rows.nth(1).dispatchEvent('mousemove', { screenX: 100, screenY: 100 });
  await rows.nth(1).dispatchEvent('mousemove', { screenX: 101, screenY: 101 });
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
  await input.press('ArrowDown');
  await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'true');
  await rows.nth(1).dispatchEvent('mousemove', { screenX: 101, screenY: 101 });
  await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'true');
  await input.fill('new');
  await input.press('Meta+Enter');
  expect(await palette.executions()).toEqual([]);
});

test('English wheel back returns from settings in the extension page', async ({ palette }) => {
  const { ui } = palette;
  await palette.open({ locale: 'en-US' });
  const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await search.fill('settings'); await search.press('Enter');
  await expect(ui.getByRole('textbox', { name: 'Search settings' })).toBeFocused();
  const result = await ui.locator('.palette-footer-title').evaluate(node => {
    const swipe = () => new WheelEvent('wheel', { deltaX: -140, bubbles: true, cancelable: true });
    const first = swipe(); node.dispatchEvent(first);
    // Inspect synchronously: a timer-based return must fail this assertion.
    const returned = !!document.querySelector('input[aria-label="Search commands, tabs, bookmarks, and history"]');
    const tail = swipe(); document.querySelector('.palette-footer-title')!.dispatchEvent(tail);
    return { returned, captured: first.defaultPrevented, tailCaptured: tail.defaultPrevented };
  });
  expect(result).toEqual({ returned: true, captured: true, tailCaptured: true });
  await ui.waitForTimeout(300);
  await expect(search).toBeFocused();
  expect(ui.isClosed()).toBe(false);
});

test('English Escape routing survives lost control focus through binding and settings layers', async ({ palette }) => {
  const { ui } = palette;
  await palette.open({ locale: 'en-US' });
  const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  const escapeWithoutControlFocus = async () => {
    await ui.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await ui.keyboard.press('Escape');
  };
  await search.fill('settings'); await search.press('Enter');
  const language = ui.getByRole('combobox', { name: 'Language', exact: true });
  await language.press('Enter'); await escapeWithoutControlFocus();
  await expect(language).toHaveAttribute('aria-expanded', 'false'); await expect(language).toBeFocused();
  const setup = ui.getByRole('button', { name: 'Set Up', exact: true });
  await setup.click();
  await ui.keyboard.press('Meta+k'); await escapeWithoutControlFocus();
  await expect(ui.locator('.binding-view .primary-action')).toBeFocused();
  await escapeWithoutControlFocus(); await expect(setup).toBeFocused();
  await expect(ui.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  await escapeWithoutControlFocus(); await expect(search).toBeFocused(); await expect(search).toHaveValue('settings');
  await search.fill('help'); await search.press('Meta+ArrowUp');
  await expect(ui.locator('[id="justonehop-command:help"]')).toHaveAttribute('aria-selected', 'true');
  await search.press('Enter');
  await expect(ui.getByRole('article', { name: 'Help', exact: true })).toBeVisible();
  await escapeWithoutControlFocus(); await expect(search).toBeFocused(); await expect(search).toHaveValue('help');
});

test('English Backspace returns from empty searches while preserving text editing and the root', async ({ palette }) => {
  const { ui } = palette;
  await palette.open({ locale: 'en-US' });
  const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await search.fill('settings'); await search.press('Enter');
  const settings = ui.getByRole('textbox', { name: 'Search settings', exact: true });
  await settings.fill('test'); await settings.press('Backspace'); await expect(settings).toHaveValue('tes');
  await settings.press('Meta+a'); await settings.press('Backspace'); await expect(settings).toHaveValue('');
  const setup = ui.getByRole('button', { name: 'Set Up', exact: true });
  await setup.click();
  const code = ui.getByLabel('JavaScript code');
  const original = await code.inputValue();
  await code.focus(); await code.press('Backspace'); await expect(code).toBeFocused(); await expect(code).toHaveValue(original);
  await code.press('Meta+k');
  const actions = ui.getByRole('combobox', { name: 'Search actions' });
  await actions.fill('copy'); await actions.press('Backspace'); await expect(actions).toHaveValue('cop');
  await actions.fill(''); await actions.press('Backspace'); await expect(code).toBeFocused();
  await ui.locator('.footer-back').focus(); await ui.keyboard.press('Backspace'); await expect(setup).toBeFocused();
  const language = ui.getByRole('combobox', { name: 'Language', exact: true });
  await language.press('Enter'); await language.press('Backspace'); await expect(language).toHaveAttribute('aria-expanded', 'false');
  await language.press('Backspace'); await expect(search).toBeFocused();
  await search.fill(''); await search.press('Backspace'); await expect(search).toBeFocused();
  await search.press('Meta+k'); await ui.keyboard.press('Backspace'); await expect(search).toBeFocused();
});

test('English human first palette right click targets the clicked result and restores typing', async ({ palette }) => {
  const { ui } = palette;
  await palette.open({ locale: 'en-US', snapshot: { tabs: [snapshotTab(2, 'Mouse-A'), snapshotTab(3, 'Mouse-B')] } });
  const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await input.fill('Mouse');
  const row = ui.getByRole('option').filter({ hasText: 'Mouse A' });
  await row.click({ button: 'right' });
  await expect(ui.getByRole('dialog', { name: 'Actions', exact: true })).toBeVisible();
  await expect(ui.locator('.action-heading')).toContainText('Mouse A');
  await ui.keyboard.press('Escape');
  await expect(input).toBeFocused(); await expect(input).toHaveValue('Mouse');
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await input.press('Control+n');
  await expect(row).toHaveAttribute('aria-selected', 'false');
});
