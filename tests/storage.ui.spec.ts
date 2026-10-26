import { test, expect, snapshotTab, fixtureOrigin } from './support/paletteUI';

test('Chinese storage list UI shows supplied copy success, details, names, menu guards and restores navigation', async ({ palette }) => {
  const raw = JSON.stringify({ message: '你好\nworld', enabled: true, lines: Array.from({ length: 30 }, (_, index) => `Value ${index}: 你好`) });
  await palette.open({ overlay: true, clipboard: 'record-success', reply: request => {
    if (request.type !== 'read-page-storage') return undefined;
    return { ok: true, data: { kind: request.payload.kind, url: `${fixtureOrigin}/source`, entries: request.payload.kind === 'local' ? [
      { id: 'app.config', name: 'app.config', value: raw }, { id: 'empty', name: 'empty', value: '' },
      { id: 'markup', name: 'markup', value: '<img src=x onerror=alert(1)>' },
      ...Array.from({ length: 12 }, (_, index) => ({ id: `z.key.${String(index).padStart(2, '0')}`, name: `z.key.${String(index).padStart(2, '0')}`, value: `${index}` })),
    ] : [{ id: 'session-only', name: 'session-only', value: 'session-value' }] } };
  } });
  const { ui } = palette; const surface = ui.frameLocator('.justonehop-frame');
  const rootInput = surface.locator('.search-bar input');
  await rootInput.fill('local storage'); await rootInput.press('Enter');
  const input = surface.locator('.storage-search input');
  await expect(surface.locator('.storage-row')).toHaveCount(15);
  await expect(surface.locator('.palette-footer .navigation-hint')).toBeHidden();
  await expect(surface.locator('.palette-footer .footer-hint-pet')).toBeVisible();
  await expect.poll(() => surface.locator('.palette').evaluate(node =>
    node.getAnimations().every(animation => animation.playState === 'finished'))).toBe(true);
  const locationTitle = await surface.locator('.palette-footer-title').boundingBox();
  const contextBox = await surface.locator('.palette-footer-context').boundingBox();
  await surface.locator('.storage-row').first().click();
  await expect(surface.locator('.storage-preview .preview-code')).toHaveValue(JSON.stringify(JSON.parse(raw), null, 2));
  await expect(surface.locator('.storage-row').first()).not.toContainText(raw);
  await expect(surface.locator('.operation-feedback')).toBeEmpty();
  expect(await palette.copies()).toEqual([]);
  await surface.locator('.palette-footer .primary-action').click();
  await expect(surface.locator('.operation-feedback')).toContainText('已复制值');
  await expect(surface.locator('.palette-footer-context')).toBeHidden();
  expect(await surface.locator('.palette-footer-title').boundingBox()).toEqual(locationTitle);
  expect((await surface.locator('.operation-feedback').boundingBox())!.x).toBe(contextBox!.x);
  await expect.poll(palette.copies).toEqual([raw]);
  await expect(input).toBeFocused();
  await input.press('Control+n'); await expect(surface.locator('.storage-row[aria-selected="true"]')).toContainText('empty');
  await input.press('Enter'); await expect(surface.locator('.operation-feedback')).toContainText('已复制值');
  await expect.poll(palette.copies).toEqual([raw, '']);
  await input.press('Control+p'); await input.fill('config');
  await expect(surface.locator('.operation-feedback')).toContainText('已复制值');
  await expect(surface.locator('.storage-row mark')).toHaveText('config'); await input.press('Enter');
  await expect.poll(palette.copies).toEqual([raw, '', raw]); await expect(input).toBeFocused();
  await expect(surface.locator('.storage-view')).toHaveAttribute('aria-busy', 'false');

  await test.step('storage action menu focus trap, background navigation lock and modifier-key guards', async () => {
    await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
    await surface.locator('.storage-row').first().click({ button: 'right' });
    const actionInput = surface.locator('.action-search input');
    await expect(actionInput).toBeFocused();
    await actionInput.fill('复制');
    await expect(surface.locator('.action-row mark')).toHaveCount(2);
    await surface.locator('.palette-footer-title').click();
    await expect(surface.locator('.storage-view')).toBeFocused();
    for (const key of ['ArrowDown', 'Control+n', 'PageDown', 'Meta+ArrowDown']) await ui.keyboard.press(key);
    await expect(surface.locator('.storage-row[aria-selected="true"]')).toContainText('app.config');
    await expect(surface.locator('.action-heading')).toContainText('app.config');
    await ui.keyboard.press('Tab'); await expect(actionInput).toBeFocused();
    await surface.locator('.palette-footer-title').click();
    await expect(surface.locator('.action-search .search-focus, .action-search .search-dismiss')).toHaveCount(0);
    await ui.keyboard.press('Shift+Tab'); await expect(actionInput).toBeFocused();
    await actionInput.press('Control+n');
    await expect(surface.locator('.action-row[aria-selected="true"]')).toContainText('复制名称');
    await actionInput.press('Tab'); await expect(actionInput).toBeFocused();
    const primary = surface.locator('.palette-footer .primary-action');
    await primary.focus();
    for (const key of ['Shift+Enter', 'Control+Enter', 'Alt+Enter', 'Meta+Enter', 'Shift+Space']) {
      await primary.press(key);
      await expect(surface.locator('.action-menu')).toBeVisible();
    }
    const prevented = await primary.evaluate(node => [
      { key: 'Enter', repeat: true }, { key: 'Enter', isComposing: true }, { key: 'Enter', keyCode: 229 },
    ].map(init => !node.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }))));
    expect(prevented).toEqual([true, true, true]);
    await primary.press('Enter');
    await expect(surface.locator('.action-menu')).toHaveCount(0);
    await expect.poll(palette.copies).toEqual([raw, '', raw, 'app.config']);
    await expect(input).toHaveValue('config');
    await expect(input).toBeFocused();
    expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
    await expect(surface.locator('.storage-view')).toHaveAttribute('aria-busy', 'false');
  });

  const actionInput = surface.locator('.action-search input');
  await input.press('Meta+k'); await actionInput.fill('details'); await actionInput.press('Enter');
  await expect(surface.locator('.storage-value')).toHaveText(JSON.stringify(JSON.parse(raw), null, 2));
  await expect(surface.locator('.storage-detail')).toBeFocused();
  await expect(surface.locator('.storage-detail')).toHaveCSS('padding', '16px');
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('storage-detail-spacing.png') });
  await ui.keyboard.press('Enter');
  await expect.poll(palette.copies).toEqual([raw, '', raw, 'app.config', raw]);
  await ui.keyboard.press('Escape'); await expect(input).toHaveValue('config'); await expect(input).toBeFocused();
  await input.press('Meta+k'); await actionInput.fill('details'); await actionInput.press('Enter');
  await expect(surface.locator('.storage-detail')).toBeFocused();
  await expect(surface.locator('.palette-footer .footer-back')).toHaveCount(0);
  await surface.locator('.task-back').click();
  await expect(input).toHaveValue('config'); await expect(input).toBeFocused();
  await input.fill('markup'); await input.press('Enter');
  await expect.poll(palette.copies).toEqual([raw, '', raw, 'app.config', raw, '<img src=x onerror=alert(1)>']);
  await expect(surface.locator('.storage-row img')).toHaveCount(0);
  await input.fill('absent');
  await expect(surface.locator('.empty')).toContainText('没有找到');
  await expect(surface.locator('.storage-preview')).toHaveCount(0);
  await expect(surface.locator('.palette-footer .primary-action')).toBeDisabled();
  await input.fill('');

  await test.step('preview metadata, side-by-side vs stacked layout and independent scroll', async () => {
    const preview = surface.locator('.storage-preview');
    const value = preview.locator('.preview-code');
    const list = surface.locator('.storage-results');
    const firstRow = surface.locator('.storage-row').first();
    for (const size of [{ width: 1100, height: 760 }, { width: 390, height: 440 }]) {
      await ui.setViewportSize(size);
      await firstRow.click();
      await expect(value).toHaveAttribute('readonly', '');
      await expect(preview.locator('h1, .storage-value-label')).toHaveCount(0);
      await expect(preview.locator('.preview-info')).toContainText('app.config');
      await expect(preview.locator('.preview-info')).toContainText('JSON');
      const valueBox = (await value.boundingBox())!;
      const infoBox = (await preview.locator('.preview-info').boundingBox())!;
      expect(valueBox.y + valueBox.height).toBeLessThan(infoBox.y);
      await surface.locator('.storage-row').nth(1).hover();
      await expect(firstRow).toHaveAttribute('aria-selected', 'true');
      const listBox = (await list.boundingBox())!;
      const previewBox = (await preview.boundingBox())!;
      if (size.width > 520) {
        expect(listBox.x + listBox.width).toBeLessThanOrEqual(previewBox.x);
        expect(listBox.y).toBe(previewBox.y);
      } else {
        expect(listBox.y + listBox.height).toBeLessThanOrEqual(previewBox.y);
        expect(listBox.width).toBe(previewBox.width);
      }
      await input.press('Tab'); await expect(surface.locator('.storage-search .search-dismiss')).toBeFocused();
      await ui.keyboard.press('Tab'); await expect(value).toBeFocused();
      await value.evaluate(node => { node.scrollTop = 40; });
      expect(await list.evaluate(node => node.scrollTop)).toBe(0);
      await list.evaluate(node => { node.scrollTop = 40; });
      expect(await value.evaluate(node => node.scrollTop)).toBe(40);
      await value.press('Tab'); await expect(surface.locator('.palette-footer .footer-hint-pet')).toBeFocused();
      await list.evaluate(node => { node.scrollTop = 0; });
      await value.evaluate(node => { node.scrollTop = 0; });
    }
  });

  await ui.setViewportSize({ width: 1100, height: 760 });
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

test('Chinese storage and Tab Group UI layers preserve actual embedded palette geometry and group rename flow', async ({ palette }) => {
  const source = { ...snapshotTab(1, 'source'), active: true, groupId: 10, title: 'Layout host' };
  let groupTitle = 'Layout Group Unique';
  await palette.open({ overlay: true, reply: request => {
    if (request.type === 'snapshot') return { ok: true, data: {
      windowId: 1, currentTabId: 1, shortcut: 'Alt+Space', bookmarks: [], groups: [{ id: 10, windowId: 1, title: groupTitle, color: 'blue', collapsed: false }],
      tabs: [source, { ...snapshotTab(2, 'Layout-member'), groupId: 10 }, ...Array.from({ length: 7 }, (_, at) => snapshotTab(at + 3, `Layout-other-${at}`))],
    } };
    if (request.type === 'read-page-storage') return { ok: true, data: { kind: 'local', url: source.url, entries: [{ id: 'layout.key', name: 'layout.key', value: 'preview value' }] } };
    if (request.type === 'execute' && request.payload.action === 'updateGroup') {
      if (request.payload.groupChanges?.title !== undefined) groupTitle = request.payload.groupChanges.title;
      return { ok: true, data: undefined };
    }
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
      const footerType = getComputedStyle(panel.querySelector('.palette-footer-title')!);
      return { panel: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, footer: box('.palette-footer'),
        search: box('.search-bar, .storage-search'), input: box('.search-bar input, .storage-search input'), row: box('.result'),
        icon: box('.result .entry-icon'), title: { x: title.x, y: title.y, height: title.height }, navigation: box('.footer-hint-pet'),
        footerTitle: { x: footerTitle.x, y: footerTitle.y, height: footerTitle.height },
        footerType: { size: footerType.fontSize, weight: footerType.fontWeight, color: footerType.color },
        textSlot: box('.palette-footer-text') };
    });
  }
  for (const size of [{ width: 750, height: 760 }, { width: 390, height: 600 }, { width: 390, height: 440 }]) {
    await ui.setViewportSize(size); await root.fill('local storage'); await expect(surface.getByRole('option').first()).toBeVisible();
    const main = await geometry(); expect(main.footer.height).toBe(44); expect(main.search.height).toBe(56);
    expect(main.row.y - main.search.y - main.search.height).toBe(4); expect(main.row.height).toBe(40); expect(main.panel.height).toBeLessThanOrEqual(516);
    await root.press('Enter'); await expect(surface.locator('.storage-row')).toHaveCount(1); const storage = await geometry();
    for (const key of ['panel', 'footer', 'search', 'icon', 'title', 'navigation', 'footerTitle', 'footerType'] as const) expect(storage[key]).toEqual(main[key]);
    expect(storage.textSlot.x).toBe(main.textSlot.x);
    await expect(surface.locator('.storage-search .search-focus')).toHaveAttribute('class', /is-back/);
    await expect(surface.locator('.footer-back')).toHaveCount(0);
    await surface.locator('.footer-hint-pet').click();
    await expect(surface.locator('.footer-hint-bubble .navigation-key')).toHaveText(['Ctrl+P上一个', 'Ctrl+N下一个']);
    await surface.locator('.footer-hint-pet').click();
    expect(storage.row.x).toBe(main.row.x); expect(storage.row.y).toBe(main.row.y); expect(storage.row.height).toBe(main.row.height);
    if (size.width > 520) expect(storage.row.width).toBeLessThan(main.row.width); else expect(storage.row.width).toBe(main.row.width);
    expect(storage.input.x).toBe(main.input.x); expect(storage.input.y).toBe(main.input.y);
    await expect(surface.locator('.palette-footer .primary-action')).toBeInViewport();
    expect(await surface.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await expect(surface.locator('.storage-search .search-dismiss')).toHaveText('esc'); await surface.locator('.storage-search .search-focus.is-back').click();
    await expect(root).toBeFocused(); await expect(root).toHaveValue('local storage');
    await root.fill(groupTitle); await expect(surface.getByRole('option').filter({ hasText: groupTitle }).first()).toBeVisible();
    const groupMain = await geometry(); await surface.getByRole('option').filter({ hasText: groupTitle }).first().click();
    await expect(surface.locator('.group-view .result')).toHaveCount(2); await expect(surface.locator('.group-view .current-badge')).toHaveCount(1);
    await expect(surface.locator('[id="group-tab:1"] .current-badge')).toHaveCount(1); const group = await geometry();
    for (const key of ['panel', 'footer', 'search', 'row', 'icon', 'title', 'navigation', 'footerTitle', 'footerType'] as const) expect(group[key]).toEqual(groupMain[key]);
    expect(group.input.x).toBe(groupMain.input.x); expect(group.input.y).toBe(groupMain.input.y);
    await expect(surface.locator('.palette-footer .primary-action')).toBeInViewport(); await expect(surface.locator('.group-view .search-dismiss')).toHaveText('esc');
    expect(group.textSlot.x).toBe(groupMain.textSlot.x);
    await expect(surface.locator('.group-view .footer-back')).toHaveCount(0);
    if (size.height === 440) {
      await ui.keyboard.press('Meta+k'); await ui.keyboard.press('Escape');
      await expect(surface.getByRole('combobox', { name: '搜索组内标签页…' })).toBeFocused();
    }
    await surface.locator('.group-view .search-focus.is-back').press('Enter'); await expect(root).toBeFocused();
  }

  await test.step('Chinese Tab Group labels, danger action state, rename editor and focus refresh', async () => {
    await ui.setViewportSize({ width: 750, height: 516 });
    await root.fill(groupTitle);
    await surface.getByRole('option').filter({ hasText: `标签组: ${groupTitle}` }).click();
    const groupSearch = surface.getByRole('combobox', { name: '搜索组内标签页…' });
    await groupSearch.fill('Layout');
    await groupSearch.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 3));
    await surface.getByRole('option').first().click({ button: 'right' });
    await surface.getByRole('combobox', { name: '搜索操作' }).fill('close');
    await expect(surface.locator('.palette-footer .primary-action')).toHaveClass(/danger/);
    await surface.getByRole('combobox', { name: '搜索操作' }).fill('rename');
    await ui.keyboard.press('Enter');
    await expect(surface.getByLabel('标签组名称')).toBeFocused();
    await ui.keyboard.press('Escape');
    await expect(groupSearch).toBeFocused();
    expect(await groupSearch.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 3]);
    await groupSearch.fill('');
    await surface.getByRole('button', { name: '打开操作菜单' }).click();
    await surface.getByRole('combobox', { name: '搜索操作' }).fill('重命名');
    await ui.keyboard.press('Enter');
    await expect(surface.getByLabel('标签组名称')).toBeFocused();
    await surface.getByLabel('标签组名称').fill('阅读资料');
    await surface.getByRole('button', { name: '保存', exact: true }).click();
    await expect(surface.locator('.palette-footer .footer-title-label')).toHaveText('标签组: 阅读资料');
    groupTitle = '外部改名';
    await ui.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(surface.locator('.palette-footer .footer-title-label')).toHaveText('标签组: 外部改名');
    await ui.keyboard.press('Escape');
    await expect(root).toBeFocused();
  });

  await ui.setViewportSize({ width: 750, height: 760 }); await surface.locator('.settings-button').click();
  await expect(surface.locator('.settings-search input')).toBeFocused(); expect((await surface.locator('.settings-search').boundingBox())!.height).toBe(56);
});
