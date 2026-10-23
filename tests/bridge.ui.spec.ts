import { test, expect } from './support/paletteUI';

test('Chinese recent bridge UI embedded switcher mouse selection and narrow geometry with supplied session', async ({ palette }) => {
  const { ui } = palette;
  await ui.setViewportSize({ width: 390, height: 440 });
  await palette.open({ overlay: {
    session: 'ui-session', sourceId: 1, offset: 1, modifier: 'Control', shortcut: 'Ctrl+Q',
    tabs: [{ id: 1, title: 'Bridge A', url: 'https://fixture.test/a' }, { id: 2, title: 'Bridge B', url: 'https://fixture.test/b' }] as chrome.tabs.Tab[],
  }, reply: request => request.source === 'justonehop-recent' && ['accept-overlay', 'cancel-overlay'].includes(request.type)
    ? { ok: true, data: undefined } : undefined });
  const surface = ui.frameLocator('.justonehop-frame');
  await expect(surface.getByRole('listbox')).toBeFocused(); await expect(surface.getByRole('combobox')).toBeDisabled();
  await expect(surface.getByRole('listbox')).toHaveCSS('outline-style', 'none');
  await ui.keyboard.press('ArrowUp');
  await expect(surface.getByRole('option', { selected: true })).toContainText('Bridge A');
  await expect(surface.getByRole('listbox')).toHaveCSS('outline-style', 'none');
  await ui.keyboard.press('ArrowDown');
  await expect(surface.getByRole('option', { selected: true })).toContainText('Bridge B');
  // The isolated UI can focus before the entrance scale animation finishes.
  await expect.poll(() => surface.locator('.palette').evaluate(node =>
    node.getAnimations().every(animation => animation.playState === 'finished'))).toBe(true);
  const before = await surface.locator('.palette').boundingBox();
  expect(before!.x).toBe(10); expect(before!.y).toBe(24);
  expect(before!.x + before!.width).toBeLessThanOrEqual(380); expect(before!.y + before!.height).toBeLessThanOrEqual(416);
  const footer = await surface.locator('.palette-footer').boundingBox();
  expect(footer!.height).toBe(44); expect(footer!.y + footer!.height).toBe(before!.y + before!.height - 1);
  await expect(surface.locator('.palette-footer-context')).toBeHidden();
  await expect(surface.locator('.palette-footer-title')).toHaveText('松开 Ctrl 切换');
  await expect(surface.getByRole('combobox')).toHaveAttribute('placeholder', '搜索最近标签页…');
  expect((await surface.locator('.search-bar').boundingBox())!.height).toBe(56);
  await surface.locator('button.search-icon').click();
  await expect(surface.getByRole('combobox')).toBeEnabled(); await expect(surface.getByRole('combobox')).toBeFocused();
  await surface.getByRole('combobox').fill('Bridge'); await expect(surface.getByRole('option')).toHaveCount(2);
  await expect(surface.locator('.primary-action')).toBeInViewport({ ratio: 1 }); await expect(surface.locator('.secondary-action')).toBeInViewport({ ratio: 1 });
  expect(await surface.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect.poll(() => surface.locator('.recent-overlay').evaluate(node => getComputedStyle(node).opacity)).toBe('1');
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('switcher-overlay-narrow.png') });
  await surface.getByRole('option').filter({ hasText: 'Bridge B' }).click();
  await expect.poll(() => palette.requests.filter(request => request.type === 'accept-overlay')).toEqual([
    { source: 'justonehop-recent', type: 'accept-overlay', session: 'ui-session', tabId: 2 },
  ]);
  await expect(ui.locator('#justonehop-command-palette')).not.toBeAttached();
  // No actual command bridge or tab activation is claimed; English extension E2E covers both.
});
