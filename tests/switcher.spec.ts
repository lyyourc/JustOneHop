import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, defaults, origin, context, ui, worker } from './support/paletteFixture';
import { openStorageOverlay, recentPopup, bridgeFixture, openNativePalette } from './support/paletteHelpers';
import { registerPaletteFixture } from './support/paletteFixture';

registerPaletteFixture();

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test('Embedded Tab Switcher overlay confirms explicitly and restores parent query caret on every cancel route', async () => {
    const page = await context.newPage(); await page.goto(`${origin}/Embedded-source`);
    const seed = await worker.evaluate(async base => {
      const source = (await chrome.tabs.query({})).find(tab => tab.url === `${base}/Embedded-source`)!;
      const target = await chrome.tabs.create({ url: `${base}/Embedded-target`, active: false });
      const sibling = await chrome.tabs.create({ url: `${base}/Embedded-sibling`, active: false });
      return { source: source.id!, target: target.id!, sibling: sibling.id!, windowId: source.windowId };
    }, origin);
    for (const id of [seed.target, seed.sibling]) await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).status, id)).toBe('complete');
    const surface = await openStorageOverlay(page);
    const root = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    const child = surface.locator('.recent-switcher');
    const search = child.getByRole('combobox');
    const active = () => worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0]?.id, seed.windowId);
    await root.fill('tab switcher');
    await expect(surface.locator('[id="justonehop-command:tabSwitcher"]')).toHaveAttribute('aria-selected', 'true');
    const parentOrder = await surface.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id));
    for (const route of ['Escape', 'cancel', 'back', 'dismiss'] as const) {
      await root.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 8));
      if (route === 'cancel') await surface.locator('[id="justonehop-command:tabSwitcher"]').click();
      else await root.press('Enter');
      await expect(search).toBeEnabled(); await expect(search).toBeFocused();
      await expect(search).toHaveValue('');
      await expect(child.locator('.palette-footer-title')).toHaveText('Tab Switcher');
      await expect(child.locator(`#recent-${seed.source} .current-badge`)).toHaveText('Current');
      await search.fill('Embedded target');
      await expect(child.getByRole('option')).toHaveCount(1);
      for (const modifier of ['Control', 'Alt', 'Meta']) {
        await page.keyboard.down(modifier); await page.keyboard.up(modifier);
        await expect(search).toBeFocused(); expect(await active()).toBe(seed.source);
      }
      await search.press('Meta+Enter');
      await search.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', repeat: true, bubbles: true });
      await search.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true, bubbles: true });
      expect(await active()).toBe(seed.source);
      if (route === 'Escape') await search.press('Escape');
      else if (route === 'cancel') await child.locator('.secondary-action').click();
      else if (route === 'back') await child.getByRole('button', { name: 'Back · Tab Switcher', exact: true }).click();
      else {
        await child.locator('.search-dismiss').click();
        await expect(search).toHaveValue(''); await expect(search).toBeFocused();
        await child.locator('.search-dismiss').click();
      }
      await expect(child).toHaveCount(0);
      await expect(root).toHaveValue('tab switcher'); await expect(root).toBeFocused();
      expect(await root.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 8]);
      await expect(surface.locator('[id="justonehop-command:tabSwitcher"]')).toHaveAttribute('aria-selected', 'true');
      expect(await surface.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(parentOrder);
      expect(await active()).toBe(seed.source);
    }
    // Mouse row, plain Enter and footer confirmation all use the selected source-window tab.
    for (const confirm of ['mouse', 'keyboard', 'footer'] as const) {
      if (confirm === 'mouse') {
        await root.fill('');
        await surface.locator('[id="justonehop-command:tabSwitcher"]').click();
      } else {
        await page.bringToFront();
        await worker.evaluate(id => chrome.tabs.sendMessage(id, { source: 'justonehop', type: 'toggle' }), seed.source);
        await root.fill('切换标签页');
        await expect(surface.locator('[id="justonehop-command:tabSwitcher"]')).toHaveAttribute('aria-selected', 'true');
        await root.press('Enter');
      }
      await expect(search).toBeFocused();
      await search.fill('Embedded no matching tab');
      await expect(child.getByRole('option')).toHaveCount(0);
      await expect(child.locator('.primary-action')).toBeDisabled();
      await search.press('Enter'); expect(await active()).toBe(seed.source);
      await search.fill('Embedded target');
      await expect(child.getByRole('option')).toHaveCount(1);
      if (confirm === 'mouse') await child.getByRole('option').click();
      else if (confirm === 'keyboard') {
        await search.press('Control+n'); await search.press('Enter');
      } else {
        await page.setViewportSize({ width: 390, height: 600 });
        await expect(child.locator('.primary-action')).toBeInViewport();
        await expect(child.getByRole('button', { name: 'Back · Tab Switcher', exact: true })).toBeInViewport();
        expect(await child.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        await surface.locator('.palette').screenshot({ path: test.info().outputPath('embedded-switcher-narrow.png') });
        await child.locator('.primary-action').click();
      }
      await expect.poll(active).toBe(seed.target);
      await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
    }
  });
});

test.describe('windows', { tag: '@windows' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });

  async function withSearchPopup(paths: string[], run: (popup: Awaited<ReturnType<typeof recentPopup>>, pages: Page[]) => Promise<void>, direction: 1 | -1 = 1) {
    const pages: Page[] = [];
    let popup: Awaited<ReturnType<typeof recentPopup>> | undefined;
    const errors: unknown[] = [];
    try {
      for (const path of paths) {
        const page = await context.newPage(); pages.push(page);
        await page.goto(`${origin}/${path}`);
      }
      popup = await recentPopup(pages[0], direction);
      await run(popup, pages);
    } catch (error) { errors.push(error); }
    finally {
      if (popup && !popup.page.isClosed()) {
        try { await popup.page.close(); } catch (error) { errors.push(error); }
      }
      for (const page of pages) {
        try { if (!page.isClosed()) await page.close(); } catch (error) { errors.push(error); }
      }
      try { if (!ui.isClosed()) await ui.bringToFront(); } catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Switcher step and cleanup failures');
  }

  test('English recent switcher keyboard navigation, release, wheel back, mouse confirm, and reverse selection', async () => {
    await test.step('wheel back cancels the standalone switcher without switching tabs', async () => {
      await withSearchPopup(['Wheel-switcher-source', 'Wheel-switcher-other'], async popup => {
        await popup.page.getByRole('button', { name: 'Search recent tabs…', exact: true }).click();
        await popup.page.screenshot({ path: test.info().outputPath('switcher-window.png') });
        await popup.page.locator('.palette-footer-title').hover(); await popup.page.mouse.wheel(-140, 0);
        await expect.poll(popup.closed).toBe(true);
        expect(await popup.active()).toBe(popup.target.id);
      });
    });

    await test.step('keeps source active while selecting and switches only on release', async () => {
      await withSearchPopup(['Recent-A', 'Recent-B', 'Recent-C'], async popup => {
        const order: string[] = await popup.read("Array.from(document.querySelectorAll('[role=option]'),row=>row.id)");
        expect(order[0]).toBe(`recent-${popup.target.id}`);
        await popup.key('keyDown', 'Control', 'ControlLeft', 17, 2);
        for (let step = 2; step < order.length + 3; step++) {
          await popup.key('keyDown', 'n', 'KeyN', 78, 2);
          await expect.poll(popup.selected).toBe(order[step % order.length]);
          expect(await popup.active()).toBe(popup.target.id);
          await popup.key('keyUp', 'n', 'KeyN', 78, 2);
          expect(await popup.closed()).toBe(false);
          expect(await popup.read('document.hasFocus()')).toBe(true);
        }
        await popup.key('keyDown', 'p', 'KeyP', 80, 2);
        await expect.poll(popup.selected).toBe(order[1]);
        expect(await popup.active()).toBe(popup.target.id);
        expect(await popup.read("Array.from(document.querySelectorAll('[role=option]'),row=>row.id)")).toEqual(order);
        expect(await worker.evaluate(async () => (await chrome.windows.getLastFocused()).id)).toBe(popup.own.id);
        await popup.key('keyUp', 'Control', 'ControlLeft', 17);
        await expect.poll(popup.closed).toBe(true);
        expect(await popup.active()).toBe(Number(order[1].replace('recent-', '')));
        await expect.poll(() => worker.evaluate(async () => (await chrome.windows.getLastFocused()).id)).toBe(popup.target.windowId);
      });
    });

    await test.step('keeps search disabled and neutral during ordinary typing and navigation', async () => {
      await withSearchPopup(['Search-Source', 'Filter-One'], async popup => {
        const input = popup.page.getByRole('combobox');
        const list = popup.page.getByRole('listbox');
        const capsule = () => popup.page.locator('.search-bar').evaluate(node => {
          const style = getComputedStyle(node, '::before');
          return { border: style.borderColor, shadow: style.boxShadow };
        });
        await expect(input).toBeDisabled(); await expect(input).not.toBeFocused();
        await expect(list).toBeFocused(); await expect(list).toHaveAttribute('tabindex', '0');
        await expect(input).not.toHaveAttribute('aria-activedescendant');
        const selected = await popup.selected();
        const count = await popup.page.getByRole('option').count();
        await expect(list).toHaveAttribute('aria-activedescendant', selected);
        await expect.poll(capsule).toEqual({ border: 'rgba(0, 0, 0, 0)', shadow: 'none' });
        await expect(input).toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)');
        await input.evaluate(node => node.focus());
        await expect(input).not.toBeFocused(); await expect(list).toBeFocused();
        await popup.page.keyboard.type('Filter-One');
        await expect(input).toHaveValue(''); await expect(input).toBeDisabled();
        await expect(popup.page.getByRole('option')).toHaveCount(count);
        await popup.page.keyboard.press('ArrowDown');
        await expect(list).not.toHaveAttribute('aria-activedescendant', selected);
        await popup.page.keyboard.press('ArrowUp');
        await expect(list).toHaveAttribute('aria-activedescendant', selected);
        await expect(list).toBeFocused(); await expect(input).not.toBeFocused();
        await expect.poll(capsule).toEqual({ border: 'rgba(0, 0, 0, 0)', shadow: 'none' });
        await expect(input).toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)');
        await popup.key('keyDown', 'Escape', 'Escape', 27);
        await expect.poll(popup.closed).toBe(true); expect(await popup.active()).toBe(popup.target.id);
      });
    });

    await test.step('missed release keeps original tab and Enter confirms reverse selection', async () => {
      await withSearchPopup(['Recent-A', 'Recent-B'], async popup => {
        const order: string[] = await popup.read("Array.from(document.querySelectorAll('[role=option]'),row=>row.id)");
        expect(await popup.selected()).toBe(order.at(-1));
        const active = await popup.active();
        expect(active).toBe(popup.target.id);
        await popup.key('keyDown', 'Enter', 'Enter', 13);
        await expect.poll(popup.closed).toBe(true);
        expect(await popup.active()).toBe(Number(order.at(-1)!.replace('recent-', '')));
      }, -1);
    });

    await test.step('human first clickable confirm, focused cancel, and mouse hover or row click', async () => {
      await withSearchPopup(['Mouse-A', 'Mouse-B', 'Mouse-C'], async (popup, pages) => {
        const selected = Number((await popup.selected()).replace('recent-', ''));
        await popup.page.getByRole('button', { name: 'Switch', exact: true }).click();
        await expect.poll(popup.closed).toBe(true); expect(await popup.active()).toBe(selected);
        const second = await recentPopup(pages[0]);
        await expect(second.page.locator('.current-badge')).toHaveText('Current');
        const cancel = second.page.locator('.search-dismiss');
        await expect(cancel).toHaveAttribute('title', 'Escape — Cancel');
        await cancel.press('Enter').catch(error => { if (!second.page.isClosed()) throw error; });
        await expect.poll(second.closed).toBe(true); expect(await second.active()).toBe(second.target.id);
        const third = await recentPopup(pages[0]);
        const initial = await third.selected();
        const row = third.page.getByRole('option').filter({ hasText: 'Mouse B' });
        await row.hover();
        expect(await third.selected()).toBe(initial);
        await third.key('keyDown', 'n', 'KeyN', 78, 2);
        expect(await third.selected()).not.toBe(initial);
        const target = Number((await row.getAttribute('id'))!.replace('recent-', ''));
        await row.click();
        await expect.poll(third.closed).toBe(true); expect(await third.active()).toBe(target);
      });
    });
  });

  test('English recent switcher search activation, filtering, confirmation, and empty or removed selection', async () => {
    for (const confirm of ['Enter', 'row', 'footer'] as const) {
      await test.step(`confirm with ${confirm}`, async () => {
        await withSearchPopup(['Search-Source', 'Filter-One', 'Filter-Two'], async popup => {
          const input = popup.page.getByRole('combobox');
          await expect(popup.page.getByRole('listbox')).toBeFocused();
          await expect(input).toBeDisabled(); await expect(input).toHaveValue('');
          await expect(input).toHaveAttribute('placeholder', 'Search recent tabs…');
          expect(await popup.page.locator('.search-bar').evaluate(node => node.getBoundingClientRect().height)).toBe(56);
          const original = await popup.page.getByRole('option').evaluateAll(rows => rows.map(row => ({ id: row.id, text: row.textContent })));
          await popup.page.locator('button.search-icon').click();
          await expect(input).toBeEnabled(); await expect(input).toBeFocused();
          await input.pressSequentially('Filter');
          const expected = original.filter(row => row.text?.includes('Filter')).map(row => row.id);
          await expect(popup.page.getByRole('option')).toHaveCount(2);
          expect(await popup.page.getByRole('option').evaluateAll(rows => rows.map(row => row.id))).toEqual(expected);
          await expect(popup.page.locator('.entry-title mark')).toHaveText(['Filter', 'Filter']);
          await popup.page.keyboard.press('ArrowDown');
          const target = Number((await popup.selected()).replace('recent-', ''));
          await expect(input).toHaveAttribute('aria-activedescendant', `recent-${target}`);
          expect(await popup.active()).toBe(popup.target.id);
          if (confirm === 'Enter') await popup.key('keyDown', 'Enter', 'Enter', 13);
          else if (confirm === 'row') await popup.page.locator(`#recent-${target}`).click();
          else await popup.page.locator('.primary-action').click();
          await expect.poll(popup.closed).toBe(true);
          expect(await popup.active()).toBe(target);
        });
      });
    }

    for (const method of ['wrapper', 'icon', 'Control+f', 'Meta+f'] as const) {
      await test.step(`activate with ${method} and release modifier`, async () => {
        await withSearchPopup(['Search-Source', 'Filter-One'], async popup => {
          const input = popup.page.getByRole('combobox');
          const list = popup.page.getByRole('listbox');
          await expect(list).toBeFocused(); await expect(input).toBeDisabled();
          const modifier = method === 'Meta+f' ? 'Meta' : 'Control';
          await popup.page.keyboard.down(modifier);
          if (method === 'wrapper') await popup.page.locator('.recent-search-field').click();
          else if (method === 'icon') await popup.page.locator('button.search-icon.recent-search-activate').click();
          else await popup.page.keyboard.press('f');
          await expect(popup.page.locator('.palette-footer-title')).toHaveText('Tab Switcher');
          await popup.page.keyboard.up(modifier);
          await expect(input).toBeEnabled(); await expect(input).toBeFocused();
          await expect(list).not.toHaveAttribute('aria-activedescendant');
          await expect(input).toHaveAttribute('aria-activedescendant', await popup.selected());
          expect(await popup.closed()).toBe(false); expect(await popup.active()).toBe(popup.target.id);
          await list.click({ position: { x: 10, y: 240 } });
          await expect(list).toBeFocused();
          if (method === 'wrapper') await popup.page.locator('.recent-search-field').click();
          else if (method === 'icon') await popup.page.locator('button.search-icon.recent-search-activate').click();
          else await popup.page.keyboard.press(method);
          await expect(input).toBeFocused();
          await input.pressSequentially('Filter-One');
          await expect(popup.page.getByRole('option')).toHaveCount(1);
          const target = Number((await popup.selected()).replace('recent-', ''));
          await popup.key('keyDown', 'Enter', 'Enter', 13);
          await expect.poll(popup.closed).toBe(true); expect(await popup.active()).toBe(target);
        });
      });
    }

    await test.step('handles empty results, composition, and removed filtered selection safely', async () => {
      await withSearchPopup(['Search-Source', 'Filter-One', 'Filter-Two'], async popup => {
        const input = popup.page.getByRole('combobox');
        const originalCount = await popup.page.getByRole('option').count();
        await popup.page.locator('button.search-icon').click();
        await expect(input).toBeEnabled(); await expect(input).toBeFocused();
        await input.fill('127.0.0.1');
        await expect(popup.page.getByRole('option')).toHaveCount(3);
        await expect(popup.page.locator('.entry-subtitle mark')).toHaveCount(3);
        await input.fill('no-such-tab');
        await expect(popup.page.getByRole('option')).toHaveCount(0);
        await expect(input).not.toHaveAttribute('aria-activedescendant');
        await expect(popup.page.locator('.primary-action')).toBeDisabled();
        await popup.key('keyDown', 'Enter', 'Enter', 13);
        await popup.key('keyUp', 'Control', 'ControlLeft', 17);
        expect(await popup.closed()).toBe(false); expect(await popup.active()).toBe(popup.target.id);
        await input.fill(''); await expect(popup.page.getByRole('option')).toHaveCount(originalCount);
        await input.fill('Filter');
        await input.dispatchEvent('compositionstart');
        await popup.key('keyDown', 'Enter', 'Enter', 13);
        await popup.key('keyUp', 'Control', 'ControlLeft', 17);
        expect(await popup.closed()).toBe(false);
        await input.dispatchEvent('keydown', { key: 'Escape', keyCode: 229 });
        expect(await popup.closed()).toBe(false);
        await input.dispatchEvent('compositionend');
        await popup.key('keyDown', 'Enter', 'Enter', 13, 8);
        expect(await popup.closed()).toBe(false);
        await popup.key('keyDown', 'Enter', 'Enter', 13, 2);
        expect(await popup.closed()).toBe(false);
        const browser = await context.newCDPSession(popup.page);
        await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, autoRepeat: true });
        expect(await popup.closed()).toBe(false);
        await popup.page.keyboard.press('Meta+ArrowDown');
        expect(await popup.selected()).toBe(await popup.page.getByRole('option').last().getAttribute('id'));
        await popup.page.keyboard.press('PageUp');
        expect(await popup.selected()).toBe(await popup.page.getByRole('option').first().getAttribute('id'));
        const selected = Number((await popup.selected()).replace('recent-', ''));
        await worker.evaluate(id => chrome.tabs.remove(id), selected);
        await expect(popup.page.getByRole('option')).toHaveCount(1);
        await expect(input).not.toHaveAttribute('aria-activedescendant');
        await expect(popup.page.locator('.primary-action')).toBeDisabled();
        await popup.key('keyUp', 'Control', 'ControlLeft', 17);
        expect(await popup.closed()).toBe(false); expect(await popup.active()).toBe(popup.target.id);
        await popup.page.keyboard.press('ArrowDown');
        const remaining = Number((await popup.selected()).replace('recent-', ''));
        await popup.page.locator('.primary-action').click();
        await expect.poll(popup.closed).toBe(true); expect(await popup.active()).toBe(remaining);
      });
    });
  });

  test('English recent switcher candidate removal, rapid navigation, and source tab or window close', async () => {
    await test.step('removes closed or moved candidates without activating another window', async () => {
      let movedWindowId: number | undefined;
      await withSearchPopup(['Recent-A', 'Recent-B', 'Recent-C'], async popup => {
        const selected = Number((await popup.selected()).replace('recent-', ''));
        movedWindowId = await worker.evaluate(async id => (await chrome.windows.create({ tabId: id, focused: false }))!.id!, selected);
        await expect(popup.page.locator(`#recent-${selected}`)).toHaveCount(0);
        const rows = await popup.page.getByRole('option').count();
        await popup.key('keyDown', 'n', 'KeyN', 78, 2);
        expect(await popup.active()).toBe(popup.target.id);
        const closing = Number((await popup.selected()).replace('recent-', ''));
        await worker.evaluate(id => chrome.tabs.remove(id), closing);
        await expect(popup.page.locator(`#recent-${closing}`)).toHaveCount(0);
        expect(await popup.page.getByRole('option').count()).toBe(rows - 1);
        await popup.key('keyDown', 'n', 'KeyN', 78, 2);
        expect(await popup.active()).toBe(popup.target.id);
        const finalId = Number((await popup.selected()).replace('recent-', ''));
        await popup.key('keyUp', 'Control', 'ControlLeft', 17);
        await expect.poll(popup.closed).toBe(true);
        expect(await popup.active()).toBe(finalId);
      });
      if (movedWindowId !== undefined) await worker.evaluate(id => chrome.windows.remove(id), movedWindowId).catch(() => {});
    });

    await test.step('rapid navigation then release preserves final selection', async () => {
      await withSearchPopup(['Recent-A', 'Recent-B'], async popup => {
        const order: string[] = await popup.read("Array.from(document.querySelectorAll('[role=option]'),row=>row.id)");
        for (let step = 0; step < 9; step++) await popup.key('keyDown', 'n', 'KeyN', 78, 2);
        await popup.key('keyUp', 'Control', 'ControlRight', 17);
        await expect.poll(popup.closed).toBe(true);
        expect(await popup.active()).toBe(Number(order[10 % order.length].replace('recent-', '')));
      });
    });

    await test.step('cancels when original tab is closed', async () => {
      await withSearchPopup(['Recent-A', 'Recent-B'], async popup => {
        await worker.evaluate(id => chrome.tabs.remove(id), popup.target.id);
        await expect.poll(popup.closed).toBe(true);
      });
    });

    await test.step('closes when source window closes and never changes toolbar popup', async () => {
      const otherWin = await worker.evaluate(async base => {
        const win = await chrome.windows.create({ url: `${base}/WinClose-A`, focused: true });
        await chrome.tabs.create({ windowId: win!.id!, url: `${base}/WinClose-B`, active: false });
        return { windowId: win!.id!, tabId: win!.tabs![0].id! };
      }, origin);
      await expect.poll(() => context.pages().some(p => p.url() === `${origin}/WinClose-A`)).toBe(true);
      const sourcePage = context.pages().find(p => p.url() === `${origin}/WinClose-A`)!;
      const popup = await recentPopup(sourcePage);
      expect(await worker.evaluate(id => chrome.action.getPopup({ tabId: id }), popup.target.id)).toBe('');
      await worker.evaluate(id => chrome.windows.remove(id), popup.target.windowId);
      await expect.poll(popup.closed).toBe(true);
    });
  });
});

test.describe('windows', { tag: '@windows' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });

  async function withBridge(run: (f: Awaited<ReturnType<typeof bridgeFixture>>) => Promise<void>) {
    const f = await bridgeFixture();
    try {
      await run(f);
    } finally {
      await context.unroute('**/switcher.js').catch(() => {});
      for (const page of [f.a, f.b]) {
        if (!page.isClosed()) await page.close().catch(() => {});
      }
      if (!ui.isClosed()) await ui.bringToFront().catch(() => {});
    }
  }

  test('English recent bridge quick taps, child frames, held Control handoff, synthetic keyups, and uninjected pages', async () => {
    await test.step('accepts a quick tap released before the command handler starts', async () => {
      await withBridge(async f => {
        await f.a.keyboard.down('Control');
        await f.a.keyboard.up('Control');
        await f.open();
        await expect.poll(f.active).toBe(f.ids.previous);
        expect(await f.windows()).toBe(0);
        expect(await worker.evaluate(() => chrome.permissions.contains({ origins: ['*://example.com/*'] }))).toBe(false);
        await f.b.keyboard.down('Control'); await f.b.keyboard.up('Control');
        await f.open();
        await expect.poll(f.active).toBe(f.ids.source);
      });
    });

    await test.step('catches a quick release inside a focused child frame', async () => {
      await withBridge(async f => {
        await f.a.evaluate(url => { const frame = document.createElement('iframe'); frame.src = url; document.body.append(frame); }, `${origin}/Child-frame`);
        const input = f.a.frameLocator('iframe').getByRole('textbox');
        await input.click();
        await f.a.keyboard.down('Control'); await f.a.keyboard.up('Control');
        await f.open();
        await expect.poll(f.active).toBe(f.ids.previous);
        expect(await f.windows()).toBe(0);
      });
    });

    await test.step('hands held Control to the window for navigation and release', async () => {
      await withBridge(async f => {
        await f.a.keyboard.down('Control');
        const created = context.waitForEvent('page');
        await f.open();
        const popup = await created;
        await expect(popup.getByRole('option').first()).toBeVisible();
        expect(await f.active()).toBe(f.ids.source);
        await popup.keyboard.press('Control+n');
        await expect.poll(() => popup.isClosed()).toBe(true);
        await f.a.bringToFront();
        await f.a.keyboard.down('Control');
        const nextPage = context.waitForEvent('page'); await f.open(); const next = await nextPage;
        await expect(next.getByRole('option').first()).toBeVisible();
        await next.keyboard.down('Control');
        await next.keyboard.press('n'); await next.keyboard.press('p');
        expect(await f.active()).toBe(f.ids.source);
        const selected = await next.locator('[aria-selected=true]').getAttribute('id');
        await next.keyboard.up('Control');
        await expect.poll(f.active).toBe(Number(selected!.replace('recent-', '')));
        await expect.poll(() => next.isClosed()).toBe(true);
      });
    });

    await test.step('ignores synthetic page releases and leaves typing unchanged', async () => {
      await withBridge(async f => {
        const input = f.a.getByRole('textbox');
        await input.fill('ordinary text');
        await f.a.keyboard.down('Control');
        await f.a.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' })));
        const created = context.waitForEvent('page'); await f.open(); const popup = await created;
        await expect(popup.getByRole('option').first()).toBeVisible();
        expect(await f.active()).toBe(f.ids.source);
        await popup.keyboard.down('Escape');
        await expect.poll(() => popup.isClosed()).toBe(true);
        await expect(input).toHaveValue('ordinary text');
      });
    });

    await test.step('does not infer release on pages without an injected listener', async () => {
      await withBridge(async f => {
        await f.a.goto('about:blank');
        const created = context.waitForEvent('page'); await f.open(); const popup = await created;
        await expect(popup.getByRole('option').first()).toBeVisible();
        expect(await f.active()).toBe(f.ids.source);
        await popup.keyboard.down('Escape');
        await expect.poll(() => popup.isClosed()).toBe(true);
        expect(await f.active()).toBe(f.ids.source);
      });
    });
  });

  test('English recent bridge delayed window startup, buffered release, repeated steps, focus loss, source window removal, and prepared tab reuse', async () => {
    await test.step('buffers release while the independent window is loading', async () => {
      await withBridge(async f => {
        let resume!: () => void;
        const gate = new Promise<void>(resolve => { resume = resolve; });
        await context.route('**/switcher.js', async route => { await gate; await route.continue(); });
        await f.a.keyboard.down('Control');
        const created = context.waitForEvent('page', page => page.url().includes('switcher.html'));
        await f.open();
        const popup = await created;
        expect(await f.active()).toBe(f.ids.source);
        await f.a.keyboard.up('Control');
        resume();
        await expect.poll(f.active).toBe(f.ids.previous);
        await expect.poll(() => popup.isClosed()).toBe(true);
      });
    });

    await test.step('preserves repeated command steps during delayed window startup', async () => {
      await withBridge(async f => {
        let resume!: () => void;
        const gate = new Promise<void>(resolve => { resume = resolve; });
        await context.route('**/switcher.js', async route => { await gate; await route.continue(); });
        await f.a.keyboard.down('Control');
        const created = context.waitForEvent('page'); await f.open(); const popup = await created;
        await f.open(); await f.open();
        await f.a.keyboard.up('Control');
        const order = await worker.evaluate(async id => {
          const all = await chrome.tabs.query({ windowId: id });
          return all.sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0) || a.index - b.index).map(tab => tab.id);
        }, f.ids.window);
        resume();
        await expect.poll(f.active).toBe(order[3 % order.length]);
        await expect.poll(() => popup.isClosed()).toBe(true);
      });
    });

    await test.step('cancels when focus is lost before the window becomes ready', async () => {
      await withBridge(async f => {
        let resume!: () => void;
        const gate = new Promise<void>(resolve => { resume = resolve; });
        await context.route('**/switcher.js', async route => { await gate; await route.continue(); });
        await f.a.keyboard.down('Control');
        await f.open();
        const other = await worker.evaluate(() => chrome.windows.create({ url: 'about:blank', focused: true }));
        resume();
        await expect.poll(f.windows).toBe(0);
        expect(await f.active()).toBe(f.ids.source);
        expect(await worker.evaluate(async () => (await chrome.windows.getLastFocused()).id)).toBe(other!.id);
        await worker.evaluate(id => chrome.windows.remove(id), other!.id!);
      });
    });

    await test.step('closes a loading popup when its source window is removed', async () => {
      const otherWin = await worker.evaluate(async base => {
        const win = await chrome.windows.create({ url: `${base}/RemoveWin-A`, focused: true });
        await chrome.tabs.create({ windowId: win!.id!, url: `${base}/RemoveWin-B`, active: false });
        return { windowId: win!.id! };
      }, origin);
      await expect.poll(() => context.pages().some(p => p.url() === `${origin}/RemoveWin-A`)).toBe(true);
      const pageA = context.pages().find(p => p.url() === `${origin}/RemoveWin-A`)!;
      let resume!: () => void;
      const gate = new Promise<void>(resolve => { resume = resolve; });
      await context.route('**/switcher.js', async route => { await gate; await route.continue(); });
      try {
        await pageA.bringToFront();
        await pageA.keyboard.down('Control');
        await worker.evaluate(async () => {
          const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
          await Promise.all(callbacks.map(callback => callback('switch-recent')));
        });
        await worker.evaluate(id => chrome.windows.remove(id), otherWin.windowId);
        resume();
        await expect.poll(() => worker.evaluate(async () => (await chrome.windows.getAll({ populate: true })).filter(w => w.tabs?.some(t => t.url?.includes('switcher.html'))).length)).toBe(0);
      } finally {
        await context.unroute('**/switcher.js').catch(() => {});
      }
    });

    await test.step('reuses prepared tabs instead of querying again', async () => {
      const code = await readFile(resolve('dist/switcher.js'), 'utf8');
      await context.route('**/switcher.js', route => route.fulfill({ contentType: 'text/javascript', body: `
        globalThis.__switchQueries = 0;
        const originalQuery = chrome.tabs.query.bind(chrome.tabs);
        chrome.tabs.query = async (...args) => {
          globalThis.__switchQueries++;
          await new Promise(resolve => setTimeout(resolve, 600));
          return originalQuery(...args);
        };
        ${code}` }));
      await withBridge(async f => {
        await f.a.keyboard.down('Control');
        const created = context.waitForEvent('page', page => page.url().includes('switcher.html'));
        const start = performance.now(); await f.open(); const popup = await created;
        await expect(popup.getByRole('option').first()).toBeVisible();
        const elapsed = Math.round(performance.now() - start);
        const queries = await popup.evaluate(() => (globalThis as unknown as { __switchQueries: number }).__switchQueries);
        console.log(JSON.stringify({ performance: 'recent-ready', readyMs: elapsed, duplicateQueries: queries, simulatedQueryMs: 600 }));
        expect(queries).toBe(0);
        await popup.keyboard.down('Control');
        await popup.keyboard.press('n'); await popup.keyboard.press('p');
        const selected = await popup.locator('[aria-selected=true]').getAttribute('id');
        await popup.keyboard.up('Control');
        await expect.poll(f.active).toBe(Number(selected!.replace('recent-', '')));
        await expect.poll(() => popup.isClosed()).toBe(true);
      });
    });
  });
});

test.describe('headed', { tag: '@headed' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true, headed: true } });
  test('native palette hands the switcher shortcut to its source window and embedded Tab Switcher confirms only in its source window', async () => {
    await test.step('release native palette hands switcher shortcut to source window', async () => {
      const { source, palette } = await openNativePalette();
      const target = await worker.evaluate(async ({ windowId, base }) => (await chrome.tabs.create({ windowId, url: `${base}/Shortcut-target`, active: false })).id!, { windowId: source.windowId, base: origin });
      await palette.keyboard.down('Control');
      const created = context.waitForEvent('page', { predicate: page => page.url().includes('switcher.html?'), timeout: 5000 });
      const dispatched = worker.evaluate(async () => {
        const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
        await Promise.all(callbacks.map(callback => callback('switch-recent')));
      });
      const [switcher] = await Promise.all([created, dispatched]);
      await expect(switcher.locator('.recent-switcher')).toBeVisible();
      await expect(switcher.locator(`#recent-${source.tabId} .current-badge`)).toHaveText('Current');
      await switcher.locator('.recent-search-activate').click();
      const search = switcher.getByRole('combobox');
      await search.fill('Shortcut target');
      await switcher.keyboard.up('Control');
      await expect(switcher.locator(`#recent-${target}`)).toHaveAttribute('aria-selected', 'true');
      await search.press('Enter');
      await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).active, target)).toBe(true);
      await expect.poll(() => switcher.isClosed()).toBe(true);
      await worker.evaluate(ids => chrome.tabs.remove(ids), [source.tabId, target]);
    });

    await test.step('Embedded Tab Switcher native palette returns to parent and confirms only in its source window', async () => {
      const target = await worker.evaluate(async base => {
        const tab = await chrome.tabs.create({ url: `${base}/Embedded-native-target`, active: false });
        return { id: tab.id!, windowId: tab.windowId };
      }, origin);
      await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).status, target.id)).toBe('complete');
      const { source, palette } = await openNativePalette();
      expect(source.windowId).toBe(target.windowId);
      const root = palette.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
      const child = palette.locator('.recent-switcher');
      const search = child.getByRole('combobox');
      await root.fill('tab switcher');
      await expect(palette.locator('[id="justonehop-command:tabSwitcher"]')).toHaveAttribute('aria-selected', 'true');
      await root.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 7));
      await root.press('Enter');
      await expect(search).toBeEnabled(); await expect(search).toBeFocused();
      await expect(child.locator(`#recent-${source.tabId} .current-badge`)).toHaveText('Current');
      await search.fill('Embedded native target');
      await expect(child.getByRole('option')).toHaveCount(1);
      await palette.keyboard.down('Control'); await palette.keyboard.up('Control');
      await expect(search).toBeFocused();
      expect(await worker.evaluate(async id => (await chrome.tabs.get(id)).active, source.tabId)).toBe(true);
      await child.getByRole('button', { name: 'Back · Tab Switcher', exact: true }).click();
      await expect(root).toHaveValue('tab switcher'); await expect(root).toBeFocused();
      expect(await root.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 7]);
      await expect(palette.locator('[id="justonehop-command:tabSwitcher"]')).toHaveAttribute('aria-selected', 'true');
      await palette.locator('.palette-footer .primary-action').click();
      await search.fill('Embedded native target');
      await expect(child.locator(`#recent-${target.id}`)).toHaveAttribute('aria-selected', 'true');
      await search.press('Enter').catch(error => { if (!palette.isClosed()) throw error; });
      await expect.poll(() => palette.isClosed()).toBe(true);
      await expect.poll(() => worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0]?.id, source.windowId)).toBe(target.id);
      expect(await worker.evaluate(async id => (await chrome.tabs.get(id)).windowId, target.id)).toBe(source.windowId);
    });
  });
});
