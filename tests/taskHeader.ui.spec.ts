import { test, expect, fixtureOrigin } from './support/paletteUI';

test('task headers return through guide and recovery menus without losing parent context', async ({ palette }) => {
  const { ui } = palette;
  await palette.open({ locale: 'en-US', snapshot: { tuckRecoveries: [{ id: 'review', title: 'Reading', urls: [`${fixtureOrigin}/reading`], candidates: [
    { id: 7, windowId: 1, title: 'Reading', fingerprint: 'reading', tabs: [{ id: 2, title: 'Article', url: `${fixtureOrigin}/reading` }] },
  ] }] } });
  const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await ui.locator('.settings-button').click();
  const settings = ui.getByRole('textbox', { name: 'Search settings', exact: true });
  await settings.fill('ctrl tab');
  const setup = ui.getByRole('button', { name: 'Set Up', exact: true });
  await setup.click();
  await expect(ui.locator('.settings-footer .primary-action')).toBeFocused();
  await expect(ui.locator('.binding-view .footer-back, .binding-view .search-bar, .binding-view .task-back')).toHaveCount(0);
  await expect(ui.locator('.settings-search')).toBeVisible();
  const code = ui.getByRole('textbox', { name: 'JavaScript code' });
  await code.focus(); await code.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(2, 12));
  await code.press('Meta+k');
  await ui.locator('.settings-footer .footer-back').click();
  await expect(ui.locator('.action-menu')).toHaveCount(0);
  await expect(code).toBeFocused();
  expect(await code.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 12]);
  await ui.setViewportSize({ width: 390, height: 400 });
  await ui.locator('.justonehop-app').evaluate(node => { node.classList.replace('popup', 'overlay'); document.body.style.width = '390px'; });
  await expect(ui.locator('.settings-footer .footer-back')).toBeInViewport();
  await expect(ui.locator('.settings-footer .primary-action')).toBeInViewport();
  await ui.locator('.settings-view').screenshot({ path: test.info().outputPath('binding-task-narrow.png') });
  await ui.locator('.settings-footer .footer-back').click();
  await expect(setup).toBeFocused(); await expect(settings).toHaveValue('ctrl tab');
  await setup.press('Escape'); await expect(settings).toHaveValue(''); await expect(settings).toBeFocused();
  await settings.press('Escape');
  await search.fill('recover tucked tabs'); await search.press('Enter');
  const list = ui.getByRole('listbox');
  await expect(list).toBeFocused();
  await expect(list).toHaveCSS('outline-width', '2px');
  await list.press('Enter'); await expect(ui.locator('.tuck-recovery')).toBeVisible();
  await ui.locator('.tuck-recovery').screenshot({ path: test.info().outputPath('recovery-narrow.png') });
  await list.press('Shift+Tab'); await expect(ui.locator('.task-back')).toBeFocused();
  await ui.keyboard.press('Tab'); await expect(list).toBeFocused();
  await ui.keyboard.press('Tab'); await expect(ui.locator('.primary-action')).toBeFocused();
  await ui.locator('.actions-button').click();
  await ui.locator('.task-back').click();
  await expect(ui.locator('.action-menu')).toHaveCount(0); await expect(list).toBeFocused();
  await expect(ui.locator('.tuck-recovery .footer-back')).toHaveCount(0);
  await ui.locator('.task-back').click();
  await expect(search).toBeFocused(); await expect(search).toHaveValue('recover tucked tabs');
});
