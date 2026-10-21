import { test, expect } from './support/ui';
import type { Snapshot } from '../src/types';
test.use({ locale: 'en-US', viewport: { width: 1100, height: 760 }, reducedMotion: 'reduce' });

for (const scenario of ['fast', 'slow', 'failure and retry']) {
  test(`English delayed loading ${scenario}`, async ({ page: ui }) => {
    const snapshot: Snapshot = { windowId: 1, currentTabId: 1, tabs: [], bookmarks: [], shortcut: '' };
    await ui.addInitScript(snapshot => {
      const pending: (() => void)[] = [];
      const scope = globalThis as unknown as { __snapshot: { pending: (() => void)[]; fail: boolean } };
      scope.__snapshot = { pending, fail: false };
      Object.assign(globalThis, { chrome: {
        i18n: { getUILanguage: () => 'en-US' },
        storage: { local: { get: async () => ({}) }, onChanged: { addListener: () => {} } },
        runtime: {
          connect: () => ({ onMessage: { addListener: () => {} }, disconnect: () => {} }),
          sendMessage: async (request: { type: string }) => {
            if (request.type === 'search-history') return { ok: true, data: { items: [], limited: false } };
            if (request.type !== 'snapshot') throw new Error(`Unexpected UI fixture request: ${request.type}`);
            await new Promise<void>(resolve => pending.push(resolve));
            return scope.__snapshot.fail ? { ok: false, error: 'Snapshot fixture failed' } : { ok: true, data: snapshot };
          },
        },
      } });
    }, snapshot);
    await ui.clock.install();
    await ui.clock.pauseAt(new Date());
    await ui.goto('https://justonehop.test/popup.html');
    const input = ui.locator('.search-bar input');
    await expect(input).toBeFocused();
    await expect(ui.locator('.results .spinner')).toHaveCount(0);
    await expect(ui.locator('.result-status')).toHaveText('');
    const release = (fail = false) => ui.evaluate(fail => {
      const state = (globalThis as unknown as { __snapshot: { pending: (() => void)[]; fail: boolean } }).__snapshot;
      state.fail = fail;
      state.pending.splice(0).forEach(resolve => resolve());
    }, fail);
    if (scenario === 'fast') {
      await ui.clock.runFor(100);
      await release();
      await expect(ui.locator('.result.command')).toHaveCount(9);
      await ui.clock.runFor(200);
      await expect(ui.locator('.results .spinner')).toHaveCount(0);
    } else if (scenario === 'slow') {
      await input.fill('new tab');
      await ui.clock.runFor(149);
      await expect(ui.locator('.results .spinner')).toHaveCount(0);
      await ui.clock.runFor(1);
      await expect(ui.locator('.results .spinner')).toBeVisible();
      await expect(ui.locator('.result-status')).not.toHaveText('');
      await release();
      await expect(ui.locator('.result').first()).toHaveAttribute('id', 'justonehop-command:newTab');
      await expect(input).toHaveValue('new tab');
      await expect(input).toBeFocused();
      await expect(ui.locator('.results .spinner')).toHaveCount(0);
      await ui.evaluate(() => window.dispatchEvent(new Event('focus')));
      await ui.clock.runFor(200);
      await expect(ui.locator('.result').first()).toHaveAttribute('id', 'justonehop-command:newTab');
      await expect(ui.locator('.results .spinner')).toHaveCount(0);
      await release();
    } else {
      await ui.clock.runFor(50);
      await release(true);
      await expect(ui.getByRole('alert')).toContainText('Something went wrong. Please try again.');
      await ui.clock.runFor(200);
      await expect(ui.locator('.results .spinner')).toHaveCount(0);
      await expect(ui.locator('.result-status')).toHaveText('');
      await ui.locator('.error-banner button').click();
      await ui.clock.runFor(149);
      await expect(ui.locator('.results .spinner')).toHaveCount(0);
      await ui.clock.runFor(1);
      await expect(ui.locator('.results .spinner')).toBeVisible();
      await release();
      await expect(ui.locator('.result.command')).toHaveCount(9);
      await expect(ui.getByRole('alert')).toHaveCount(0);
      await expect(ui.locator('.results .spinner')).toHaveCount(0);
    }
  });
}
