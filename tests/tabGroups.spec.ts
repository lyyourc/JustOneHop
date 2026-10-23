import { expect } from '@playwright/test';
import { test, defaults, origin, context, ui, worker } from './support/paletteFixture';
import { registerPaletteFixture } from './support/paletteFixture';

registerPaletteFixture();

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English group result actions preserve context and confirm whole-group deletion', async () => {
    const setup = await worker.evaluate(async origin => {
      const a = await chrome.tabs.create({ url: `${origin}/Direct-Alpha`, active: false });
      const b = await chrome.tabs.create({ url: `${origin}/Direct-Beta`, active: false });
      const id = await chrome.tabs.group({ tabIds: [a.id!, b.id!] });
      await chrome.tabGroups.update(id, { title: 'DirectGroup', color: 'blue', collapsed: true });
      return { id, ids: [a.id!, b.id!] };
    }, origin);
    const root = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    const actionSearch = ui.getByRole('combobox', { name: 'Search actions' });
    const groupRow = () => ui.getByRole('option').filter({ hasText: 'Tab Group: DirectGroup' });
    await root.fill('DirectGroup');
    await root.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
    await groupRow().click({ button: 'right' });
    await expect(ui.locator('.action-menu [role="option"]')).toHaveCount(4);
    await expect(ui.locator('.palette-footer .primary-action')).toHaveText(/Expand Group/);
    for (const title of ['Expand Group', 'Rename Group', 'Ungroup (Keep All Tabs)', 'Close Entire Group']) {
      await expect(ui.getByRole('option', { name: title })).toBeVisible();
    }
    await ui.getByRole('option', { name: 'Expand Group' }).click();
    await expect(root).toBeFocused();
    await expect(ui.getByRole('button', { name: 'View Group Tabs', exact: true })).toBeVisible();
    expect(await worker.evaluate(id => chrome.tabGroups.get(id), setup.id)).toMatchObject({ collapsed: false });
    expect(await root.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
    await ui.getByRole('button', { name: 'Open action menu' }).click();
    await ui.getByRole('option', { name: 'Rename Group', exact: true }).click();
    await ui.getByLabel('Group Name', { exact: true }).fill('DirectGroup Renamed');
    await ui.locator('.palette').screenshot({ path: test.info().outputPath('group-rename.png') });
    await ui.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(root).toBeFocused(); await expect(root).toHaveValue('DirectGroup');
    expect(await root.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
    expect(await worker.evaluate(id => chrome.tabGroups.get(id), setup.id)).toMatchObject({ title: 'DirectGroup Renamed', color: 'blue' });
    await root.press('Meta+k'); await actionSearch.fill('close'); await actionSearch.press('Enter');
    const confirmation = ui.getByRole('alertdialog');
    await expect(confirmation).toContainText('DirectGroup Renamed'); await expect(confirmation).toContainText('2 tabs');
    await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await ui.locator('.palette').screenshot({ path: test.info().outputPath('group-confirmation.png') });
    await ui.keyboard.press('Escape'); await expect(actionSearch).toBeFocused();
    await ui.keyboard.press('Escape'); await expect(root).toBeFocused();
    expect(await root.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
    // A new member after confirmation was shown must never be swept into deletion.
    await root.press('Meta+k'); await actionSearch.fill('close'); await actionSearch.press('Enter');
    const extra = await worker.evaluate(async ({ origin, id }) => {
      const tab = await chrome.tabs.create({ url: `${origin}/Direct-Gamma`, active: false });
      await chrome.tabs.group({ groupId: id, tabIds: [tab.id!] }); return tab.id!;
    }, { origin, id: setup.id });
    await confirmation.getByRole('button', { name: 'Close Entire Group', exact: true }).click();
    await expect(ui.getByRole('alert')).toContainText('Group membership changed');
    expect(await worker.evaluate(async ids => Promise.all(ids.map(id => chrome.tabs.get(id))), [...setup.ids, extra])).toHaveLength(3);
    await ui.keyboard.press('Escape');
    await root.press('Enter');
    const members = ui.getByRole('combobox', { name: 'Search tabs in this group…' });
    await expect(members).toBeFocused();
    await ui.getByRole('button', { name: 'Open action menu' }).click();
    await ui.getByRole('option', { name: 'Ungroup (Keep All Tabs)', exact: true }).click();
    await expect(root).toBeFocused(); await expect(root).toHaveValue('DirectGroup');
    expect(await worker.evaluate(async ids => Promise.all(ids.map(async id => (await chrome.tabs.get(id)).groupId)), [...setup.ids, extra])).toEqual([-1, -1, -1]);
    await worker.evaluate(async ids => {
      const id = await chrome.tabs.group({ tabIds: ids as [number, ...number[]] });
      await chrome.tabGroups.update(id, { title: 'DirectGroup' });
    }, setup.ids);
    await ui.evaluate(() => window.dispatchEvent(new Event('focus')));
    await groupRow().click(); await expect(members).toBeFocused();
    await members.fill('Alpha');
    await members.press('Meta+k'); await actionSearch.fill('close entire'); await actionSearch.press('Enter');
    await expect(confirmation).toContainText('2 tabs');
    await ui.keyboard.press('Tab'); await ui.keyboard.press('Enter');
    await expect(root).toBeFocused(); await expect(root).toHaveValue('DirectGroup');
    expect(await worker.evaluate(async ids => Promise.all(ids.map(id => chrome.tabs.get(id).then(() => true, () => false))), setup.ids)).toEqual([false, false]);
    expect(await worker.evaluate(async id => (await chrome.tabs.get(id)).groupId, extra)).toBe(-1);
  });

  test('English Tab Group search management and nested keyboard navigation', async () => {
  const setup = await worker.evaluate(async origin => {
    const a = await chrome.tabs.create({ url: `${origin}/Group-Alpha`, active: false });
    const b = await chrome.tabs.create({ url: `${origin}/Group-Beta`, active: false });
    const id = await chrome.tabs.group({ tabIds: [a.id!, b.id!] });
    await chrome.tabGroups.update(id, { title: 'Research', color: 'blue', collapsed: true });
    return { id, a: a.id!, b: b.id! };
  }, origin);
  await ui.setViewportSize({ width: 750, height: 516 });
  const root = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await root.fill('Research');
  await expect(ui.getByRole('option').filter({ hasText: 'Tab Group: Research' })).toBeVisible();
  const mainPanel = await ui.locator('.palette').boundingBox();
  const mainFooter = await ui.locator('.palette-footer').boundingBox();
  await expect(ui.locator('.tab-group-badge')).toHaveCount(2);
  await ui.getByRole('option').filter({ hasText: 'Tab Group: Research' }).click();
  const search = ui.getByRole('combobox', { name: 'Search tabs in this group…' });
  await expect(search).toBeFocused();
  await expect(ui.getByRole('option')).toHaveCount(2);
  expect(await ui.locator('.palette').boundingBox()).toEqual(mainPanel);
  expect(await ui.locator('.palette-footer').boundingBox()).toEqual(mainFooter);
  expect(mainPanel!.height).toBe(516); expect(mainFooter!.height).toBe(44);
  await search.press('Control+n'); await search.press('Control+p');
  // A lower row must remain visible when the editor remounts the member list.
  const extraTabs = await worker.evaluate(async ({ origin, groupId }) => {
    const ids: number[] = [];
    for (let at = 0; at < 16; at++) ids.push((await chrome.tabs.create({ url: `${origin}/Group-Extra-${at}`, active: false })).id!);
    await chrome.tabs.group({ groupId, tabIds: ids as [number, ...number[]] });
    return ids;
  }, { origin, groupId: setup.id });
  await ui.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(ui.locator('.group-view .result')).toHaveCount(18);
  await search.fill('Group');
  await search.press('Meta+ArrowDown');
  const lowerRow = ui.locator('.group-view .result[aria-selected=true]');
  const lowerId = await lowerRow.getAttribute('id');
  expect(await ui.locator('#justonehop-group-tabs').evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await search.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 3));
  async function action(text: string) {
    await ui.keyboard.press('Meta+k');
    await ui.getByRole('combobox', { name: 'Search actions' }).fill(text);
    await ui.keyboard.press('Enter');
  }
  await action('Rename Group');
  const name = ui.getByLabel('Group Name', { exact: true });
  await expect(name).toBeFocused();
  await name.fill('Reading');
  await ui.keyboard.press('Meta+k'); await ui.keyboard.press('Escape');
  await expect(name).toBeFocused();
  await ui.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(ui.locator('.palette-footer .footer-title-label')).toHaveText('Tab Group: Reading');
  await expect(ui.locator('.operation-feedback')).toContainText('Group renamed');
  await expect(search).toBeFocused(); await expect(search).toHaveValue('Group');
  expect(await search.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 3]);
  await expect(lowerRow).toHaveAttribute('id', lowerId!);
  const lowerRowVisible = () => lowerRow.evaluate(node => {
    const row = node.getBoundingClientRect(), list = node.closest('.results')!.getBoundingClientRect();
    return row.top >= list.top - 1 && row.bottom <= list.bottom + 1;
  });
  expect(await lowerRowVisible()).toBe(true);
  await action('Rename Group');
  await ui.locator('.task-back').click();
  await expect(search).toBeFocused(); await expect(lowerRow).toHaveAttribute('id', lowerId!);
  expect(await lowerRowVisible()).toBe(true);
  await worker.evaluate(ids => chrome.tabs.remove(ids), extraTabs);
  await ui.evaluate(() => window.dispatchEvent(new Event('focus')));
  await search.fill(''); await expect(ui.locator('.group-view .result')).toHaveCount(2);
  expect(await worker.evaluate(id => chrome.tabGroups.get(id), setup.id)).toMatchObject({ title: 'Reading', color: 'blue' });
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('justonehop-tab-group-en.png') });
  await action('Expand Group');
  expect((await worker.evaluate(id => chrome.tabGroups.get(id), setup.id)).collapsed).toBe(false);
  await search.fill('Beta');
  await action('Remove Tab from Group');
  await expect(ui.getByRole('option')).toHaveCount(0);
  expect((await worker.evaluate(id => chrome.tabs.get(id), setup.b)).groupId).toBe(-1);
  await search.fill('');
  await action('Rename Group');
  await ui.keyboard.press('Escape'); await expect(search).toBeFocused();
  await search.press('Backspace'); await expect(root).toBeFocused();
  await expect(root).toHaveValue('Research');
  await root.fill('Reading'); await ui.getByRole('option').filter({ hasText: 'Tab Group: Reading' }).click();
  // The header Back button returns to the search that opened this layer in one click.
  await ui.locator('.group-view .search-focus.is-back').click();
  await expect(root).toBeFocused(); await expect(root).toHaveValue('Reading');
  await root.fill('Reading'); await ui.getByRole('option').filter({ hasText: 'Tab Group: Reading' }).click();
  await action('Close Tab');
  await expect(ui.getByText('This tab group is no longer in this window.')).toBeVisible();
  await ui.keyboard.press('Escape'); await expect(root).toBeFocused();
});
});

test('Chinese Tab Group labels and compact footer stay usable', async () => {
  const group = await worker.evaluate(async origin => {
    const tab = await chrome.tabs.create({ url: `${origin}/中文资料`, active: false });
    const id = await chrome.tabs.group({ tabIds: [tab.id!] });
    await chrome.tabGroups.update(id, { title: '资料', color: 'green' }); return id;
  }, origin);
  const root = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
  await root.fill('资料');
  await ui.getByRole('option').filter({ hasText: '标签组: 资料' }).click();
  await ui.setViewportSize({ width: 750, height: 516 });
  const groupSearch = ui.getByRole('combobox', { name: '搜索组内标签页…' });
  await groupSearch.fill('127');
  await groupSearch.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 2));
  await ui.getByRole('option').first().click({ button: 'right' });
  await ui.getByRole('combobox', { name: '搜索操作' }).fill('close');
  await expect(ui.locator('.palette-footer .primary-action')).toHaveClass(/danger/);
  await ui.getByRole('combobox', { name: '搜索操作' }).fill('rename');
  await ui.keyboard.press('Enter');
  await expect(ui.getByLabel('标签组名称')).toBeFocused();
  await ui.keyboard.press('Escape');
  await expect(groupSearch).toBeFocused();
  expect(await groupSearch.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 2]);
  await groupSearch.fill('');
  await expect(ui.locator('.palette-footer .primary-action')).toBeInViewport();
  await ui.getByRole('button', { name: '打开操作菜单' }).click();
  await ui.getByRole('combobox', { name: '搜索操作' }).fill('重命名');
  await ui.keyboard.press('Enter');
  await expect(ui.getByLabel('标签组名称')).toBeFocused();
  await ui.getByLabel('标签组名称').fill('阅读资料');
  await ui.getByRole('button', { name: '保存', exact: true }).click();
  await expect(ui.locator('.palette-footer .footer-title-label')).toHaveText('标签组: 阅读资料');
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('justonehop-tab-group-zh.png') });
  await worker.evaluate(id => chrome.tabGroups.update(id, { title: '外部改名' }), group);
  // This headless Chrome does not reliably emit tabGroups.onUpdated for API edits.
  // Exercise the existing refresh-on-focus path used when returning to justonehop.
  await ui.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(ui.locator('.palette-footer .footer-title-label')).toHaveText('标签组: 外部改名');
  await ui.keyboard.press('Escape'); await expect(root).toBeFocused();
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English palette launch storage overlay Tab Group fits a narrow viewport', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Group-host`);
  await page.setViewportSize({ width: 390, height: 440 });
  await worker.evaluate(async origin => {
    const a = await chrome.tabs.create({ url: `${origin}/Group-member`, active: false });
    const id = await chrome.tabs.group({ tabIds: [a.id!] });
    await chrome.tabGroups.update(id, { title: 'Narrow', color: 'blue' });
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  }, origin);
  const surface = page.frameLocator('.justonehop-frame');
  await surface.getByRole('combobox').fill('Narrow');
  await surface.getByRole('option').filter({ hasText: 'Tab Group: Narrow' }).click();
  const primary = surface.locator('.palette-footer .primary-action');
  await expect(primary).toBeInViewport();
  expect(await surface.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('justonehop-tab-group-narrow.png') });
  await page.keyboard.press('Meta+k'); await page.keyboard.press('Escape');
  await expect(surface.getByRole('combobox', { name: 'Search tabs in this group…' })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' })).toBeFocused();
});
});
