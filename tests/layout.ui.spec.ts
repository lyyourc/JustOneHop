import { test, expect, fixtureOrigin, snapshotTab } from './support/paletteUI';
import type { Locator } from '@playwright/test';

async function expectIconSpacing(bar: Locator, expectedLeft: number, expectedRight: number) {
  const spacing = await bar.evaluate(node => {
    const view = node.ownerDocument.defaultView!;
    const icon = node.querySelector('.search-icon')!.getBoundingClientRect();
    const input = node.querySelector('input')!;
    const style = view.getComputedStyle(input);
    const box = node.getBoundingClientRect();
    const pill = view.getComputedStyle(node, '::before');
    const edge = box.left + (pill.content === 'none' ? 0 : parseFloat(pill.left));
    return { left: icon.left - edge,
      right: input.getBoundingClientRect().left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth) - icon.right };
  });
  expect(spacing.left).toBeCloseTo(expectedLeft, 1);
  expect(spacing.right).toBeCloseTo(expectedRight, 1);
}

test.use({ viewport: { width: 1100, height: 760 }, reducedMotion: 'reduce' });

test('light and dark surfaces, compact rows and bottom action search fit without clipping', async ({ palette }) => {
  const { ui } = palette;
  await palette.open({ snapshot: {
    tabs: [snapshotTab(2, 'Design-System')],
    bookmarks: [{ id: 'manual', title: 'Raycast Manual', url: 'https://manual.raycast.com', folder: '' }],
  } });
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
  await ui.setViewportSize({ width: 750, height: 516 });
  for (const theme of ['light', 'dark'] as const) {
    await ui.emulateMedia({ colorScheme: theme });
    await input.fill('');
    await expectIconSpacing(ui.locator('.search-bar'), 14, 10);
    expect((await ui.locator('.result').first().boundingBox())!.height).toBe(40);
    await expect(ui.locator('.section-start')).toHaveCount(0);
    await expect(ui.locator('.suggested-label')).toHaveCount(0);
    await ui.locator('.palette').screenshot({ path: test.info().outputPath(`palette-${theme}.png`) });
    await input.fill('Design System');
    await expect(ui.locator('.result.tab')).toHaveCount(1);
    await expect(ui.locator('.result.tab .entry-title')).toHaveText('Design System');
    await input.press('Meta+ArrowUp');
    await expect(ui.locator('.result.tab')).toHaveAttribute('aria-selected', 'true');
    await input.press('Meta+k');
    await expect(ui.locator('.action-search .search-focus, .action-search .search-dismiss')).toHaveCount(0);
    await expect(ui.locator('.action-search input')).toBeFocused();
    await expect(ui.locator('.action-search input')).toHaveCSS('outline-style', 'none');
    const ring = await ui.locator('.action-search').evaluate(node => getComputedStyle(node, '::after').content);
    expect(ring).toBe('none');
    const searchBox = await ui.locator('.action-search').boundingBox();
    const actionList = await ui.locator('.action-list').boundingBox();
    expect(searchBox!.y).toBeGreaterThanOrEqual(actionList!.y + actionList!.height - 1);
    await ui.locator('.palette').screenshot({ path: test.info().outputPath(`actions-${theme}.png`) });
    await ui.keyboard.press('Escape');
  }
  await ui.setViewportSize({ width: 390, height: 600 });
  await ui.locator('.justonehop-app').evaluate(node => { node.classList.replace('popup', 'overlay'); document.body.style.width = '390px'; });
  await expectIconSpacing(ui.locator('.search-bar'), 8, 8);
  await ui.locator('.settings-button').click();
  await expectIconSpacing(ui.locator('.settings-search'), 8, 8);
  await ui.locator('.settings-search input').press('Escape');
  await expect(input).toHaveValue('Design System');
  await input.fill('标签切换器'); await input.press('Enter');
  await expectIconSpacing(ui.locator('.recent-switcher .search-bar'), 8, 8);
  await ui.locator('.recent-search-activate').click();
  await expect(ui.locator('.recent-search-field input')).toBeFocused();
});

for (const language of ['Chinese', 'English']) test(`${language} quiet layout exposes Ctrl P N navigation in results and actions at narrow widths`, async ({ palette }) => {
  const { ui } = palette;
  await palette.open({ locale: language === 'English' ? 'en-US' : 'zh-CN', snapshot: { tabs: [snapshotTab(2, 'Navigation-fixture')] } });
  const chinese = language === 'Chinese';
  const input = ui.getByRole('combobox');
  await expect(ui.locator('.result.tab')).toHaveCount(0);
  await expect(ui.locator('.list-heading, .section-heading, .context-hint')).toHaveCount(0);
  await expect(ui.locator('#justonehop-results')).toHaveAccessibleName(chinese ? '推荐' : 'Suggested');
  await expect(ui.getByText(chinese ? '推荐' : 'Suggested', { exact: true })).toHaveCount(0);
  await expect(ui.locator('.section-start')).toHaveCount(0);
  await expect(ui.locator('.suggested-label')).toHaveCount(0);
  await expect(ui.locator('.palette-footer .footer-divider')).toHaveCount(0);
  await expect(ui.locator('.palette-footer-context')).toHaveCSS('margin-left', '16px');
  const hintChords = ui.locator('.navigation-hint .key-chord');
  await expect(hintChords.nth(0).locator('kbd')).toHaveText(['Ctrl+P']);
  await expect(hintChords.nth(1).locator('kbd')).toHaveText(['Ctrl+N']);
  await expect(ui.locator('.navigation-label')).toHaveText(chinese ? ['上一个', '下一个'] : ['Previous', 'Next']);
  await expect(ui.locator('.navigation-hint')).toHaveAttribute('title', /Control \+ P.*Ctrl\+P.*Control \+ N.*Ctrl\+N/);
  await expect(ui.locator('.actions-button')).toHaveAttribute('title', /Command \+ K/);
  // Supporting shortcuts use the same text metrics as other footer context.
  const hintKey = await hintChords.first().locator('kbd').first().evaluate(node => {
    const key = getComputedStyle(node), context = getComputedStyle(node.closest('.palette-footer-context')!);
    return { size: key.fontSize, weight: key.fontWeight, lineHeight: key.lineHeight, color: key.color,
      contextSize: context.fontSize, contextWeight: context.fontWeight, contextLineHeight: context.lineHeight, contextColor: context.color,
      border: key.borderTopWidth, background: key.backgroundColor, height: node.getBoundingClientRect().height };
  });
  expect(hintKey.size).toBe(hintKey.contextSize); expect(hintKey.weight).toBe(hintKey.contextWeight);
  expect(hintKey.lineHeight).toBe(hintKey.contextLineHeight); expect(hintKey.color).toBe(hintKey.contextColor);
  expect(hintKey.border).toBe('0px'); expect(hintKey.background).toBe('rgba(0, 0, 0, 0)'); expect(hintKey.height).toBe(16);
  await expect(ui.locator('.footer-actions .key-chord').first().locator('kbd')).toHaveText(['↵']);
  await expect(ui.locator('.footer-actions .key-chord').nth(1).locator('kbd')).toHaveText(['⌘K']);
  const rows = ui.locator('.result');
  await input.press('Meta+ArrowUp');
  await expect(rows.first()).toHaveAttribute('aria-selected', 'true');
  await input.press('Control+n');
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
  await input.press('Control+p');
  await expect(rows.first()).toHaveAttribute('aria-selected', 'true');
  await expect(input).toBeFocused();
  const header = await ui.locator('.search-bar').boundingBox();
  const first = await rows.first().boundingBox();
  expect(first!.y - header!.y - header!.height).toBeGreaterThanOrEqual(0);
  expect(first!.y - header!.y - header!.height).toBeLessThanOrEqual(9);
  await input.fill('Navigation fixture');
  await expect(ui.locator('.kind-label')).toHaveCount(1);
  await input.press('Meta+k');
  const action = ui.getByRole('combobox', { name: chinese ? '搜索操作' : 'Search actions' });
  await action.press('Control+n');
  await expect(ui.locator('.action-row').nth(1)).toHaveAttribute('aria-selected', 'true');
  await action.press('Control+p');
  await expect(ui.locator('.action-row').first()).toHaveAttribute('aria-selected', 'true');
  await expect(action).toBeFocused();
  await action.press('Escape');
  await expect(input).toHaveValue('Navigation fixture');
  await input.fill('example.com/footer-layout');
  const primary = ui.locator('.primary-action'), secondary = ui.locator('.secondary-action');
  await expect(primary.locator('.primary-label')).toHaveText(chinese ? '当前页打开' : 'Open Here');
  await expect(secondary.locator('.primary-label')).toHaveText(chinese ? '新标签页打开' : 'New Tab');
  await expect(primary).toHaveAccessibleName(chinese ? '当前页打开' : 'Open in Current Tab');
  await expect(secondary).toHaveAccessibleName(chinese ? '在新标签页打开' : 'Open in New Tab');
  await expect(secondary).toHaveAttribute('title', /在新标签页打开|Open in New Tab/);
  await ui.evaluate(() => { document.body.style.width = '100%'; });
  for (const width of [750, 620, 750]) {
    await ui.setViewportSize({ width, height: 600 });
    if (width === 620) await expect(ui.locator('.navigation-hint')).toBeHidden();
    else await expect(ui.locator('.navigation-hint')).toBeVisible();
    const left = (await ui.locator('.palette-footer-location').boundingBox())!;
    const right = (await ui.locator('.footer-actions').boundingBox())!;
    expect(right.x - left.x - left.width).toBeGreaterThanOrEqual(16);
    expect(await ui.locator('.footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect((await ui.locator('.footer').boundingBox())!.height).toBe(44);
    const newTab = (await secondary.boundingBox())!, separator = (await ui.locator('.footer-separator').boundingBox())!;
    expect(separator.x).toBeGreaterThanOrEqual(newTab.x + newTab.width);
    if (width === 620) await ui.locator('.palette').screenshot({ path: test.info().outputPath(`quiet-${language.toLowerCase()}-compact.png`) });
  }
  // Mouse opens the full action descriptions; keyboard closes and restores the query.
  await ui.locator('.actions-button').click();
  await expect(ui.locator('.action-row').first()).toContainText(chinese ? '当前页打开' : 'Open in Current Tab');
  await expect(ui.locator('.action-row').nth(1)).toContainText(chinese ? '在新标签页打开' : 'Open in New Tab');
  await ui.getByRole('combobox', { name: chinese ? '搜索操作' : 'Search actions' }).press('Escape');
  await expect(input).toHaveValue('example.com/footer-layout');
  for (const theme of ['light', 'dark'] as const) {
    await ui.emulateMedia({ colorScheme: theme });
    await ui.locator('.palette').screenshot({ path: test.info().outputPath(`quiet-${language.toLowerCase()}-${theme}.png`) });
  }
  await ui.setViewportSize({ width: 390, height: 600 });
  await ui.locator('.justonehop-app').evaluate(node => { node.classList.replace('popup', 'overlay'); document.body.style.width = '390px'; });
  await expect(ui.locator('.navigation-hint')).toBeHidden();
  await expect(ui.locator('.palette-footer-title')).toHaveText(chinese ? '小范围瞬移' : 'JustOneHop');
  await expect(ui.locator('.footer-navigation')).toHaveAccessibleName(chinese ? '设置' : 'Settings');
  expect(await ui.locator('.footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  const locationBox = await ui.locator('.palette-footer-location').boundingBox(), actionsBox = await ui.locator('.footer-actions').boundingBox();
  expect(locationBox!.x + locationBox!.width).toBeLessThanOrEqual(actionsBox!.x);
  await expect(secondary.locator('.secondary-compact-icon')).toBeVisible();
  await expect(secondary.locator('.primary-label')).toBeHidden();
  await ui.locator('.palette').screenshot({ path: test.info().outputPath(`quiet-${language.toLowerCase()}-narrow.png`) });
  await input.fill('');
  await input.press('Control+n');
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
});
