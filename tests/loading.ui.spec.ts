import { test, expect, snapshotTab } from './support/paletteUI';
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
    const clockStart = Date.now();
    await ui.clock.install({ time: clockStart });
    await ui.clock.pauseAt(clockStart + 60_000);
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

test('English keep-open stale Retry guard, failed mutation refresh and pending group mutation busy state', async ({ palette }) => {
  const { ui } = palette;
  const source = { ...snapshotTab(1, 'source'), active: true };
  const makeTabs = () => [2, 3, 4, 5].map(id => ({ ...snapshotTab(id, `Batch-fixture-${id}`), groupId: 10 }));
  let tabs = makeTabs();
  let snapshotReads = 0;
  let releaseStaleRetry: (() => void) | undefined;
  let releaseExecution: ((ok: boolean) => void) | undefined;
  let executionCalls = 0;

  await palette.open({
    locale: 'en-US',
    startupFailure: true,
    reply: async request => {
      if (request.type === 'snapshot') {
        const read = ++snapshotReads;
        if (read === 1) return { ok: false, error: 'Initial snapshot fixture failure' };
        const captured: Snapshot = {
          windowId: 1, currentTabId: 1, shortcut: 'Alt+Space', bookmarks: [],
          groups: [{ id: 10, windowId: 1, title: 'Batch Research', color: 'blue', collapsed: false }],
          tabs: [source, ...structuredClone(tabs)],
        };
        if (read === 2) await new Promise<void>(resolve => { releaseStaleRetry = resolve; });
        return { ok: true, data: captured };
      }
      if (request.type === 'execute' && request.payload.action === 'close') {
        executionCalls++;
        const ok = await new Promise<boolean>(resolve => { releaseExecution = resolve; });
        return ok ? { ok: true, data: undefined } : { ok: false, error: 'Tab already closed' };
      }
      return undefined;
    },
  });

  const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });

  await test.step('initial Retry cannot replace a newer snapshot with stale tab data', async () => {
    await expect(ui.getByRole('alert')).toBeVisible();
    await ui.locator('.error-banner button').click();
    await expect.poll(() => typeof releaseStaleRetry).toBe('function');
    tabs = tabs.filter(tab => tab.id !== 3);
    await ui.evaluate(() => window.dispatchEvent(new Event('focus')));
    await input.fill('Batch fixture');
    await expect(ui.locator('#justonehop-results .result.tab')).toHaveCount(3);
    await expect(ui.locator('[id="justonehop-tab:3"]')).toHaveCount(0);
    releaseStaleRetry!();
    await ui.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(ui.locator('#justonehop-results .result.tab')).toHaveCount(3);
    await expect(ui.locator('[id="justonehop-tab:3"]')).toHaveCount(0);
    await expect(input).toHaveValue('Batch fixture');
    await expect(input).toBeFocused();
  });

  await test.step('keep-open failed mutation refreshes changes received while execution was pending', async () => {
    tabs = makeTabs();
    await ui.evaluate(() => window.dispatchEvent(new Event('focus')));
    const rows = ui.locator('#justonehop-results .result.tab');
    await expect(rows).toHaveCount(4);
    const order = await rows.evaluateAll(nodes => nodes.map(node => node.id));
    const targetId = Number(order[1].split(':')[1]);
    await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 7));
    await ui.locator(`[id="${order[1]}"]`).click({ button: 'right' });
    await ui.locator('[id="justonehop-actions-action:close"]').click();
    await expect.poll(() => executionCalls).toBe(1);
    tabs = tabs.filter(tab => tab.id !== targetId);
    // Focus events while executing are ignored until the failed mutation's recovery refresh runs.
    await ui.evaluate(() => window.dispatchEvent(new Event('focus')));
    releaseExecution!(false);
    await expect(ui.getByRole('alert')).toBeVisible();
    await expect(rows).toHaveCount(3);
    await expect(ui.locator(`[id="${order[1]}"]`)).toHaveCount(0);
    await expect(ui.getByRole('dialog')).toHaveCount(0);
    await expect(ui.locator('#justonehop-results [aria-selected="true"]')).toHaveAttribute('id', order[2]);
    await expect(input).toHaveValue('Batch fixture');
    await expect(input).toBeFocused();
    expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 7]);
    await ui.keyboard.type('X');
    await expect(input).toHaveValue('BaXixture');
    expect(executionCalls).toBe(1);
  });

  await test.step('pending group mutation stays busy after Escape returns to root', async () => {
    tabs = makeTabs();
    await ui.evaluate(() => window.dispatchEvent(new Event('focus')));
    await input.fill('Batch Research');
    await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 7));
    await ui.getByRole('option').filter({ hasText: 'Tab Group: Batch Research' }).click();
    await ui.locator('[id="group-tab:3"]').click({ button: 'right' });
    await ui.locator('#group-actions-close').click();
    await expect.poll(() => executionCalls).toBe(2);
    await ui.keyboard.press('Escape');
    await ui.keyboard.press('Escape');
    await expect(input).toBeVisible();
    await expect(input).toBeDisabled();
    await expect(ui.locator('.palette-footer .primary-action')).toBeDisabled();
    await expect(ui.getByRole('button', { name: 'Open action menu' })).toBeDisabled();
    await ui.keyboard.press('Enter');
    await ui.locator('[id="justonehop-tab:4"]').click();
    expect(executionCalls).toBe(2);
    tabs = tabs.filter(tab => tab.id !== 3);
    releaseExecution!(true);
    await expect(input).toBeEnabled();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('Batch Research');
    expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 7]);
    await expect(ui.locator('[id="justonehop-tab:3"]')).toHaveCount(0);
    expect(executionCalls).toBe(2);
  });
});
