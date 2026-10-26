import { test, expect, fixtureOrigin } from './support/paletteUI';

test('task headers return through guide and recovery menus without losing parent context or narrow feedback', async ({ palette }) => {
  const { ui } = palette;
  await palette.open({
    locale: 'en-US', overlay: true, clipboard: 'record-success',
    snapshot: { tuckRecoveries: [{ id: 'review', title: 'Reading', urls: [`${fixtureOrigin}/reading`], candidates: [
      { id: 7, windowId: 1, title: 'Reading', fingerprint: 'reading', tabs: [{ id: 2, title: 'Article', url: `${fixtureOrigin}/reading` }] },
    ] }] },
  });
  const surface = ui.frameLocator('.justonehop-frame');
  const search = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });

  await test.step('binding guide header, action menu and narrow copy feedback', async () => {
    await surface.locator('.settings-button').click();
    const settings = surface.getByRole('textbox', { name: 'Search settings', exact: true });
    await settings.fill('ctrl tab');
    const setup = surface.getByRole('button', { name: 'Set Up', exact: true });
    await setup.click();
    await expect(surface.locator('.settings-footer .primary-action')).toBeFocused();
    await expect(surface.locator('.binding-view .footer-back, .binding-view .search-bar, .binding-view .task-back')).toHaveCount(0);
    await expect(surface.locator('.settings-search')).toBeVisible();
    const code = surface.getByRole('textbox', { name: 'JavaScript code' });
    await code.focus(); await code.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(2, 12));
    await surface.locator('.footer-hint-pet').click();
    await code.focus();
    await code.press('Meta+k');
    await surface.locator('.settings-search .search-focus.is-back').click();
    await expect(surface.locator('.action-menu')).toHaveCount(0);
    await expect(code).toBeFocused();
    expect(await code.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 12]);
    await expect(surface.locator('.footer-hint-pet')).toHaveAttribute('aria-expanded', 'true');
    await surface.locator('.footer-hint-pet').click();
    await expect(surface.locator('.footer-hint-pet')).toHaveAttribute('aria-expanded', 'false');
    await expect(code).toBeVisible();
    await ui.setViewportSize({ width: 390, height: 400 });
    await expect(surface.locator('.settings-search .search-focus.is-back')).toBeInViewport();
    const primary = surface.locator('.settings-footer .primary-action');
    await expect(primary).toBeInViewport();
    await surface.locator('.settings-view').screenshot({ path: test.info().outputPath('binding-task-narrow.png') });
    await primary.press('Meta+k');
    const actions = surface.getByRole('combobox', { name: 'Search actions', exact: true });
    await actions.fill('copy');
    await actions.press('Enter');
    await expect(surface.locator('.operation-feedback')).toContainText('copied');
    await expect(primary).toBeEnabled();
    await expect(primary).toBeFocused();
    const message = (await surface.locator('.operation-feedback-message').boundingBox())!;
    expect(message.width).toBeGreaterThan(20);
    const button = (await primary.boundingBox())!;
    expect(message.x + message.width).toBeLessThanOrEqual(button.x);
    await expect(surface.locator('.actions-button')).toBeInViewport({ ratio: 1 });
    expect(await surface.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await surface.locator('.settings-search .search-focus.is-back').click();
    await expect(setup).toBeFocused(); await expect(settings).toHaveValue('ctrl tab');
    await setup.press('Escape'); await expect(settings).toHaveValue(''); await expect(settings).toBeFocused();
    await settings.press('Escape');
  });

  await test.step('tuck recovery task header and keyboard/mouse back navigation', async () => {
    await search.fill('recover tucked tabs'); await search.press('Enter');
    const list = surface.getByRole('listbox');
    await expect(list).toBeFocused();
    await expect(list).toHaveCSS('outline-width', '2px');
    await list.press('Enter'); await expect(surface.locator('.tuck-recovery')).toBeVisible();
    await surface.locator('.tuck-recovery').screenshot({ path: test.info().outputPath('recovery-narrow.png') });
    await list.press('Shift+Tab'); await expect(surface.locator('.task-back')).toBeFocused();
    await ui.keyboard.press('Tab'); await expect(list).toBeFocused();
    await ui.keyboard.press('Tab'); await expect(surface.locator('.footer-hint-pet')).toBeFocused();
    await ui.keyboard.press('Tab'); await expect(surface.locator('.primary-action')).toBeFocused();
    await surface.locator('.actions-button').click();
    await expect(surface.locator('.palette-footer-pet')).toHaveAttribute('inert', '');
    const back = surface.locator('.task-back');
    await back.press('Shift+Enter');
    await back.dispatchEvent('keydown', { key: 'Enter', repeat: true });
    await back.dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229 });
    await expect(surface.locator('.action-menu')).toBeVisible();
    await back.press('Enter');
    await expect(surface.locator('.action-menu')).toHaveCount(0); await expect(list).toBeFocused();
    await expect(surface.locator('.tuck-recovery')).toBeVisible();
    await expect(surface.locator('.tuck-recovery .footer-back')).toHaveCount(0);
    await surface.locator('.task-back').click();
    await expect(search).toBeFocused(); await expect(search).toHaveValue('recover tucked tabs');
  });
});
