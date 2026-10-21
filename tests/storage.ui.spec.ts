import { test, expect, snapshotTab, fixtureOrigin } from './support/paletteUI';

test('Chinese storage list UI shows supplied copy success, details, names and restores navigation', async ({ palette }) => {
  const raw = '{"message":"你好\\nworld","enabled":true}';
  await palette.open({ overlay: true, clipboard: 'record-success', reply: request => {
    if (request.type !== 'read-page-storage') return undefined;
    return { ok: true, data: { kind: request.payload.kind, url: `${fixtureOrigin}/source`, entries: request.payload.kind === 'local' ? [
      { id: 'app.config', name: 'app.config', value: raw }, { id: 'empty', name: 'empty', value: '' },
      { id: 'markup', name: 'markup', value: '<img src=x onerror=alert(1)>' },
    ] : [{ id: 'session-only', name: 'session-only', value: 'session-value' }] } };
  } });
  const { ui } = palette; const surface = ui.frameLocator('.justonehop-frame');
  const rootInput = surface.locator('.search-bar input');
  await rootInput.fill('local storage'); await rootInput.press('Enter');
  const input = surface.locator('.storage-search input');
  await expect(surface.locator('.storage-row')).toHaveCount(3);
  await expect(surface.locator('.storage-preview .preview-code')).toHaveValue(JSON.stringify(JSON.parse(raw), null, 2));
  await expect(surface.locator('.storage-row').first()).not.toContainText(raw); await expect(input).toBeFocused();
  await input.press('Control+n'); await expect(surface.locator('.storage-row[aria-selected="true"]')).toContainText('empty');
  await input.press('Enter'); await expect(surface.locator('.operation-feedback')).toContainText('已复制值');
  await expect.poll(palette.copies).toEqual(['']);
  await input.press('Control+p'); await input.fill('config');
  await expect(surface.locator('.operation-feedback')).toContainText('已复制值');
  await expect(surface.locator('.storage-row mark')).toHaveText('config'); await input.press('Enter');
  await expect.poll(palette.copies).toEqual(['', raw]); await expect(input).toBeFocused();
  await input.press('Meta+k'); const actionInput = surface.locator('.action-search input');
  await actionInput.press('Control+n'); await expect(surface.locator('.action-row[aria-selected="true"]')).toContainText('复制名称');
  await actionInput.press('Enter'); await expect.poll(palette.copies).toEqual(['', raw, 'app.config']);
  await expect(input).toHaveValue('config');
  await input.press('Meta+k'); await actionInput.fill('details'); await actionInput.press('Enter');
  await expect(surface.locator('.storage-value')).toHaveText(JSON.stringify(JSON.parse(raw), null, 2));
  await expect(surface.locator('.storage-detail')).toBeFocused(); await ui.keyboard.press('Enter');
  await expect.poll(palette.copies).toEqual(['', raw, 'app.config', raw]);
  await ui.keyboard.press('Escape'); await expect(input).toHaveValue('config'); await expect(input).toBeFocused();
  await input.press('Meta+k'); await actionInput.fill('details'); await actionInput.press('Enter');
  await expect(surface.locator('.storage-detail')).toBeFocused(); await surface.locator('.palette-footer .footer-back').click();
  await expect(input).toHaveValue('config'); await expect(input).toBeFocused();
  await input.fill('markup'); await input.press('Enter');
  await expect.poll(palette.copies).toEqual(['', raw, 'app.config', raw, '<img src=x onerror=alert(1)>']);
  await expect(surface.locator('.storage-row img')).toHaveCount(0);
  await input.fill('absent'); await expect(surface.locator('.empty')).toContainText('没有找到'); await input.fill('');
  for (const colorScheme of ['dark', 'light'] as const) {
    await ui.emulateMedia({ colorScheme });
    await surface.locator('.palette').screenshot({ path: test.info().outputPath(`storage-ui-Chinese-${colorScheme}.png`) });
  }
  await ui.setViewportSize({ width: 390, height: 600 });
  expect(await surface.locator('.footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await input.press('Escape'); await expect(rootInput).toHaveValue('local storage'); await expect(rootInput).toBeFocused();
  await rootInput.fill('session storage'); await expect(surface.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
  await expect(surface.locator('[id="justonehop-command:sessionStorage"]')).toHaveAttribute('aria-selected', 'true'); await rootInput.press('Enter');
  await expect(surface.locator('.storage-row')).toHaveCount(1); await expect(surface.locator('.storage-row')).toContainText('session-only');
  await input.press('Enter'); await expect.poll(async () => (await palette.copies()).at(-1)).toBe('session-value');
  // Recorded copy attempts only. English extension E2E reads the actual clipboard and checks persisted data.
});

test('Chinese storage and Tab Group UI layers preserve actual embedded palette geometry with supplied data', async ({ palette }) => {
  const source = { ...snapshotTab(1, 'source'), active: true, groupId: 10, title: 'Layout host' };
  await palette.open({ overlay: true, reply: request => {
    if (request.type === 'snapshot') return { ok: true, data: {
      windowId: 1, currentTabId: 1, shortcut: 'Alt+Space', bookmarks: [], groups: [{ id: 10, windowId: 1, title: 'Layout Group Unique', color: 'blue', collapsed: false }],
      tabs: [source, { ...snapshotTab(2, 'Layout-member'), groupId: 10 }, ...Array.from({ length: 7 }, (_, at) => snapshotTab(at + 3, `Layout-other-${at}`))],
    } };
    if (request.type === 'read-page-storage') return { ok: true, data: { kind: 'local', url: source.url, entries: [{ id: 'layout.key', name: 'layout.key', value: 'preview value' }] } };
    return undefined;
  } });
  const { ui } = palette; const surface = ui.frameLocator('.justonehop-frame');
  const root = surface.locator('.search-bar input'); await expect(surface.locator('.result.tab')).toHaveCount(0);
  await root.fill('Layout'); await expect(surface.locator('.result.tab')).toHaveCount(9);
  await expect(surface.locator('[id="justonehop-tab:1"] .current-badge')).toHaveText('当前');
  await expect(surface.locator('.result.tab .current-badge')).toHaveCount(1);
  async function geometry() {
    // Layer navigation can remount the panel before its entrance scale settles.
    await expect.poll(() => surface.locator('.palette').evaluate(panel =>
      panel.getAnimations().every(animation => animation.playState === 'finished'))).toBe(true);
    return surface.locator('.palette').evaluate(panel => {
      const box = (selector: string) => {
        const rect = panel.querySelector(selector)!.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      const rect = panel.getBoundingClientRect(); const title = box('.result .entry-title'); const footerTitle = box('.palette-footer-title');
      const footerType = getComputedStyle(panel.querySelector('.palette-footer-title')!); const contextType = getComputedStyle(panel.querySelector('.palette-footer-context')!);
      return { panel: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, footer: box('.palette-footer'),
        search: box('.search-bar, .storage-search'), input: box('.search-bar input, .storage-search input'), row: box('.result'),
        icon: box('.result .entry-icon'), title: { x: title.x, y: title.y, height: title.height }, navigation: box('.footer-navigation'),
        footerTitle: { x: footerTitle.x, y: footerTitle.y, height: footerTitle.height },
        footerType: { size: footerType.fontSize, weight: footerType.fontWeight, color: footerType.color },
        contextType: { size: contextType.fontSize, weight: contextType.fontWeight, lineHeight: contextType.lineHeight, color: contextType.color } };
    });
  }
  for (const size of [{ width: 750, height: 760 }, { width: 390, height: 600 }, { width: 390, height: 440 }]) {
    await ui.setViewportSize(size); await root.fill('local storage'); await expect(surface.getByRole('option').first()).toBeVisible();
    const main = await geometry(); expect(main.footer.height).toBe(44); expect(main.search.height).toBe(56);
    expect(main.row.y - main.search.y - main.search.height).toBe(4); expect(main.row.height).toBe(40); expect(main.panel.height).toBeLessThanOrEqual(516);
    await root.press('Enter'); await expect(surface.locator('.storage-row')).toHaveCount(1); const storage = await geometry();
    for (const key of ['panel', 'footer', 'search', 'icon', 'title', 'navigation', 'footerTitle', 'footerType', 'contextType'] as const) expect(storage[key]).toEqual(main[key]);
    expect(storage.row.x).toBe(main.row.x); expect(storage.row.y).toBe(main.row.y); expect(storage.row.height).toBe(main.row.height);
    if (size.width > 520) expect(storage.row.width).toBeLessThan(main.row.width); else expect(storage.row.width).toBe(main.row.width);
    expect(storage.input.x).toBe(main.input.x); expect(storage.input.y).toBe(main.input.y);
    await expect(surface.locator('.palette-footer .primary-action')).toBeInViewport();
    expect(await surface.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await expect(surface.locator('.storage-search .search-dismiss')).toHaveText('esc'); await surface.locator('.storage-search .search-dismiss').click();
    await expect(root).toBeFocused(); await expect(root).toHaveValue('local storage');
    await root.fill('Layout Group Unique'); await expect(surface.getByRole('option').filter({ hasText: 'Layout Group Unique' }).first()).toBeVisible();
    const groupMain = await geometry(); await surface.getByRole('option').filter({ hasText: 'Layout Group Unique' }).first().click();
    await expect(surface.locator('.group-view .result')).toHaveCount(2); await expect(surface.locator('.group-view .current-badge')).toHaveCount(1);
    await expect(surface.locator('[id="group-tab:1"] .current-badge')).toHaveCount(1); const group = await geometry();
    for (const key of ['panel', 'footer', 'search', 'row', 'icon', 'title', 'navigation', 'footerTitle', 'footerType', 'contextType'] as const) expect(group[key]).toEqual(groupMain[key]);
    expect(group.input.x).toBe(groupMain.input.x); expect(group.input.y).toBe(groupMain.input.y);
    await expect(surface.locator('.palette-footer .primary-action')).toBeInViewport(); await expect(surface.locator('.group-view .search-dismiss')).toHaveText('esc');
    await surface.locator('.group-view .search-dismiss').click(); await expect(root).toBeFocused();
  }
  await ui.setViewportSize({ width: 750, height: 760 }); await surface.locator('.settings-button').click();
  await expect(surface.locator('.settings-search input')).toBeFocused(); expect((await surface.locator('.settings-search').boundingBox())!.height).toBe(56);
});
