import { expect } from '@playwright/test';
import { test, defaults, context, worker, registerPaletteFixture } from './support/paletteFixture';
import { bridgeFixture } from './support/paletteHelpers';

registerPaletteFixture();

test.describe('windows', { tag: '@windows' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('badge draft survives repeated shortcut switcher handoffs and cancellation', async () => {
    const f = await bridgeFixture();
    await worker.evaluate(async () => {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    });
    const surface = f.a.frameLocator('.justonehop-frame');
    await surface.locator('.settings-button').click();
    await surface.getByRole('button', { name: 'Wear Badge', exact: true }).click();
    const emoji = surface.getByRole('textbox', { name: 'Emoji', exact: true });
    await emoji.fill('🌱');
    for (const cancel of [false, false, true]) {
      await f.a.keyboard.down('Control');
      const created = context.waitForEvent('page', page => page.url().includes('switcher.html'));
      await f.open();
      const popup = await created;
      await expect(popup.getByRole('option').first()).toBeVisible();
      await expect(emoji).toHaveValue('🌱');
      const selected = Number((await popup.locator('[aria-selected=true]').getAttribute('id'))!.replace('recent-', ''));
      await popup.keyboard.down('Control');
      if (cancel) await popup.keyboard.down('Escape');
      else await popup.keyboard.up('Control');
      await expect.poll(() => popup.isClosed()).toBe(true);
      await expect.poll(f.active).toBe(cancel ? f.ids.source : selected);
      await f.a.keyboard.up('Control');
      await worker.evaluate(async id => { await chrome.tabs.update(id, { active: true }); }, f.ids.source);
      await f.a.bringToFront();
      await expect(emoji).toBeVisible(); await expect(emoji).toHaveValue('🌱');
    }
    await emoji.press('Escape');
    await f.a.keyboard.down('Control'); await f.open();
    await expect(surface.locator('.recent-switcher')).toBeVisible();
    expect(await f.windows()).toBe(0);
    await f.a.keyboard.press('Escape'); await f.a.keyboard.up('Control');
  });
});
