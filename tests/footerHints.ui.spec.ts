import { test, expect, fixtureOrigin } from './support/paletteUI';

test.use({ viewport: { width: 1100, height: 760 }, reducedMotion: 'reduce' });

for (const overlay of [false, true]) test(`footer keyboard hints preserve page context in ${overlay ? 'overlay' : 'window'}`, async ({ palette }) => {
  const { ui } = palette;
  await ui.clock.install();
  await palette.open({ locale: 'en-US', ...(overlay ? { overlay: true as const } : {}), clipboard: 'record-success', reply: request => {
    if (request.type === 'read-page-storage') return { ok: true, data: {
      kind: request.payload.kind, url: `${fixtureOrigin}/source`, entries: [{ id: 'key', name: 'key', value: 'value' }],
    } };
  } });
  const surface = overlay ? ui.frameLocator('.justonehop-frame') : ui;
  const search = surface.locator('.search-bar input');
  await search.fill('local storage'); await search.press('Enter');
  const context = surface.locator('.palette-footer-context');
  const pet = surface.locator('.footer-hint-pet');
  const bubble = surface.locator('.footer-hint-bubble');
  const actions = surface.locator('.footer-actions');
  await expect(context).toHaveText('fixture.test');
  await expect(context).toBeVisible();
  const originalContext = await context.boundingBox();
  const originalActions = await actions.boundingBox();
  await pet.click();
  await expect(bubble).toBeVisible();
  await expect(context).toBeVisible();
  expect(await context.boundingBox()).toEqual(originalContext);
  expect(await actions.boundingBox()).toEqual(originalActions);
  const hint = (await bubble.boundingBox())!;
  expect(hint.y + hint.height).toBeLessThanOrEqual(originalContext!.y);
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('context-and-keyboard-hint.png') });

  await pet.press('Space');
  await expect(bubble).toBeHidden();
  await expect(context).toBeVisible();
  await surface.locator('.storage-search input').focus();
  await ui.keyboard.press('Tab');
  await expect(surface.locator('.storage-search .search-dismiss')).toBeFocused();
  await ui.keyboard.press('Tab');
  await expect(surface.locator('.preview-code')).toBeFocused();
  await ui.keyboard.press('Tab');
  await expect(pet).toBeFocused();
  await ui.keyboard.press('Enter');
  await expect(bubble).toBeVisible();
  await expect(context).toBeVisible();

  await ui.keyboard.press('Tab');
  await expect(surface.locator('.primary-action')).toBeFocused();
  await ui.keyboard.press('Enter');
  await expect(surface.locator('.operation-feedback')).toHaveText('Value copied');
  await expect(bubble).toBeHidden();
  await pet.hover();
  await ui.clock.runFor(4100);
  await expect(bubble).toBeVisible();
  await expect(context).toBeVisible();

  await ui.setViewportSize({ width: 390, height: 600 });
  if (!overlay) await ui.evaluate(() => { document.body.style.width = '100%'; });
  await expect(bubble).toBeInViewport({ ratio: 1 });
  const narrowHint = (await bubble.boundingBox())!;
  const narrowActions = (await actions.boundingBox())!;
  expect(narrowHint.y + narrowHint.height).toBeLessThanOrEqual(narrowActions.y);
  await surface.locator('.primary-action').click({ trial: true });
  await ui.setViewportSize({ width: 1100, height: 760 });
  await expect(context).toBeVisible();
});
