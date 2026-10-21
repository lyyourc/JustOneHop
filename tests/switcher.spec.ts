import { test as base, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, defaults, origin, context, ui, worker, popupUrl } from './support/paletteFixture';
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
  test('English wheel back cancels the standalone switcher without switching tabs', async () => {
    const source = await context.newPage(); await source.goto(`${origin}/Wheel-switcher-source`);
    const other = await context.newPage(); await other.goto(`${origin}/Wheel-switcher-other`);
    const popup = await recentPopup(source);
    await popup.page.getByRole('button', { name: 'Search recent tabs…', exact: true }).click();
    await popup.page.locator('.palette-footer-title').hover(); await popup.page.mouse.wheel(-140, 0);
    await expect.poll(popup.closed).toBe(true);
    expect(await popup.active()).toBe(popup.target.id);
  });
  test('English recent switcher keeps the source active while selecting and switches only on release', async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Recent-A`);
  const b = await context.newPage(); await b.goto(`${origin}/Recent-B`);
  const c = await context.newPage(); await c.goto(`${origin}/Recent-C`);
  const popup = await recentPopup(a);
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

test.describe('windows', { tag: '@windows' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English recent switcher keeps search disabled and neutral during ordinary typing and navigation', async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Search-Source`);
  const b = await context.newPage(); await b.goto(`${origin}/Filter-One`);
  const popup = await recentPopup(a);
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

test.describe('windows', { tag: '@windows' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });

  async function withSearchPopup(paths: string[], run: (popup: Awaited<ReturnType<typeof recentPopup>>) => Promise<void>) {
    const pages: Page[] = [];
    let popup: Awaited<ReturnType<typeof recentPopup>> | undefined;
    const errors: unknown[] = [];
    try {
      for (const path of paths) {
        const page = await context.newPage(); pages.push(page);
        await page.goto(`${origin}/${path}`);
      }
      popup = await recentPopup(pages[0]);
      await run(popup);
    } catch (error) { errors.push(error); }
    finally {
      // Closing the popup also drops held keys; releasing them first can accept
      // a selection and close the target before the remaining cleanup runs.
      if (popup && !popup.page.isClosed()) {
        try { await popup.page.close(); } catch (error) { errors.push(error); }
      }
      // Attempt every owned page even if another close fails.
      for (const page of pages) {
        try { if (!page.isClosed()) await page.close(); } catch (error) { errors.push(error); }
      }
      try { await ui.bringToFront(); } catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Switcher step and cleanup failures');
  }

  test('English recent switcher search filters visible targets and confirms with Enter, row and footer', async () => {
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
  });

  test('English recent switcher search accepts ordinary typing after wrapper, icon, Control+f and Meta+f activation and modifier release', async () => {
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
  });
});

test.describe('windows', { tag: '@windows' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English recent switcher search handles empty results, composition and removed filtered selection safely', async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Search-Source`);
  const b = await context.newPage(); await b.goto(`${origin}/Filter-One`);
  const c = await context.newPage(); await c.goto(`${origin}/Filter-Two`);
  const popup = await recentPopup(a);
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

test.describe('windows', { tag: '@windows' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English recent switcher missed release keeps the original tab and Enter confirms the reverse selection', async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Recent-A`);
  const b = await context.newPage(); await b.goto(`${origin}/Recent-B`);
  const popup = await recentPopup(a, -1);
  const order: string[] = await popup.read("Array.from(document.querySelectorAll('[role=option]'),row=>row.id)");
  expect(await popup.selected()).toBe(order.at(-1));
  const active = await popup.active();
  expect(active).toBe(popup.target.id);
  await popup.key('keyDown', 'Enter', 'Enter', 13);
  await expect.poll(popup.closed).toBe(true);
  expect(await popup.active()).toBe(Number(order.at(-1)!.replace('recent-', '')));
});
});

test('Chinese recent switcher Escape and focus loss cancel without switching or stealing focus', { tag: '@windows' }, async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Recent-A`);
  const b = await context.newPage(); await b.goto(`${origin}/Recent-B`);
  let popup = await recentPopup(a);
  expect(await popup.read('document.body.textContent')).toContain('松开 Ctrl 切换');
  await popup.key('keyDown', 'Escape', 'Escape', 27);
  await expect.poll(popup.closed).toBe(true);
  expect(await popup.active()).toBe(popup.target.id);
  popup = await recentPopup(a);
  const preview = await popup.active();
  const other = await worker.evaluate(() => chrome.windows.create({ url: 'about:blank', focused: true }));
  await expect.poll(popup.closed).toBe(true);
  expect(await popup.active()).toBe(preview);
  expect(await worker.evaluate(async () => (await chrome.windows.getLastFocused()).id)).toBe(other!.id);
});

test.describe('windows', { tag: '@windows' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English recent switcher removes closed or moved candidates without activating another window', async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Recent-A`);
  const b = await context.newPage(); await b.goto(`${origin}/Recent-B`);
  const c = await context.newPage(); await c.goto(`${origin}/Recent-C`);
  const popup = await recentPopup(a);
  const selected = Number((await popup.selected()).replace('recent-', ''));
  await worker.evaluate(async id => { await chrome.windows.create({ tabId: id, focused: false }); }, selected);
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
});

test.describe('windows', { tag: '@windows' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English recent switcher rapid navigation then release preserves the final selection', async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Recent-A`);
  const b = await context.newPage(); await b.goto(`${origin}/Recent-B`);
  const popup = await recentPopup(a);
  const order: string[] = await popup.read("Array.from(document.querySelectorAll('[role=option]'),row=>row.id)");
  for (let step = 0; step < 9; step++) await popup.key('keyDown', 'n', 'KeyN', 78, 2);
  await popup.key('keyUp', 'Control', 'ControlRight', 17);
  await expect.poll(popup.closed).toBe(true);
  expect(await popup.active()).toBe(Number(order[10 % order.length].replace('recent-', '')));
});
});

test.describe('windows', { tag: '@windows' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English recent switcher closes when source window closes and never changes toolbar popup', async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Recent-A`);
  const b = await context.newPage(); await b.goto(`${origin}/Recent-B`);
  const popup = await recentPopup(a);
  expect(await worker.evaluate(id => chrome.action.getPopup({tabId:id}), popup.target.id)).toBe('');
  await worker.evaluate(id => chrome.windows.remove(id), popup.target.windowId);
  await expect.poll(popup.closed).toBe(true);
});
});

test.describe('windows', { tag: '@windows' }, () => {
   test.use({ environment: { ...defaults, locale: 'en-US' } });
   test('English recent switcher cancels when its original tab is closed', async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Recent-A`);
  const b = await context.newPage(); await b.goto(`${origin}/Recent-B`);
  const popup = await recentPopup(a);
  await worker.evaluate(id => chrome.tabs.remove(id), popup.target.id);
  await expect.poll(popup.closed).toBe(true);
 });
 });

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English recent bridge accepts a quick tap released before the command handler starts', async () => {
  const f = await bridgeFixture();
  await f.a.keyboard.down('Control');
  await f.a.keyboard.up('Control');
  await f.open();
  await expect.poll(f.active).toBe(f.ids.previous);
  expect(await f.windows()).toBe(0);
  // The bridge does not grant Cookie host access as a side effect.
  expect(await worker.evaluate(() => chrome.permissions.contains({ origins: ['*://example.com/*'] }))).toBe(false);
  // A second tap switches back, with no stale session or stale release replay.
  await f.b.keyboard.down('Control'); await f.b.keyboard.up('Control');
  await f.open();
  await expect.poll(f.active).toBe(f.ids.source);
});
});

test.describe('windows', { tag: '@windows' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English recent bridge buffers release while the independent window is loading', async () => {
  const f = await bridgeFixture();
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

test.describe('windows', { tag: '@windows' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English recent bridge hands held Control to the window for navigation and release', async () => {
  const f = await bridgeFixture();
  await f.a.keyboard.down('Control');
  const created = context.waitForEvent('page');
  await f.open();
  const popup = await created;
  await expect(popup.getByRole('option').first()).toBeVisible();
  expect(await f.active()).toBe(f.ids.source);
  await popup.keyboard.press('Control+n');
  // press releases Control, so use a separate held sequence in the next session.
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

test.describe('windows', { tag: '@windows' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English recent bridge Escape cancels the independent switcher during asynchronous startup', async () => {
  const f = await bridgeFixture();
  const script = await readFile(resolve('dist/switcher.js'), 'utf8');
  await context.route('**/switcher.js', async route => {
    await route.fulfill({ contentType: 'text/javascript', body: `const originalCommands = chrome.commands.getAll.bind(chrome.commands);\nchrome.commands.getAll = () => new Promise(resolve => { window.__resumeSwitcherCommands = () => originalCommands().then(resolve); });\n${script}` });
  });
  await f.a.keyboard.down('Control');
  const switcherUrl = popupUrl.replace('popup.html', `switcher.html?tab=${f.ids.source}&window=${f.ids.window}&direction=1`);
  const created = context.waitForEvent('page', page => page.url() === switcherUrl);
  await worker.evaluate(url => chrome.windows.create({ url, type: 'popup', focused: true }), switcherUrl);
  const popup = await created;
  await popup.waitForFunction(() => typeof (window as any).__resumeSwitcherCommands === 'function');
  await popup.bringToFront();
  await popup.keyboard.press('Escape').catch(error => { if (!popup.isClosed()) throw error; });
  await expect.poll(() => popup.isClosed()).toBe(true);
  expect(await f.active()).toBe(f.ids.source);
});
});

test.describe('windows', { tag: '@windows' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English recent bridge replays paging, jumps and command steps in order after asynchronous startup', async () => {
  const f = await bridgeFixture();
  await worker.evaluate(async ({ windowId, base }) => {
    for (let at = 0; at < 20; at++) await chrome.tabs.create({ windowId, url: `${base}/Startup-${at}`, active: false });
  }, { windowId: f.ids.window, base: origin });
  const script = await readFile(resolve('dist/switcher.js'), 'utf8');
  await context.route('**/switcher.js', async route => {
    await route.fulfill({ contentType: 'text/javascript', body: `const originalCommands = chrome.commands.getAll.bind(chrome.commands);\nchrome.commands.getAll = () => new Promise(resolve => { window.__resumeSwitcherCommands = () => originalCommands().then(resolve); });\nconst originalAddCommand = chrome.commands.onCommand.addListener.bind(chrome.commands.onCommand);\nchrome.commands.onCommand.addListener = callback => { window.__stepSwitcher = callback; originalAddCommand(callback); };\n${script}` });
  });
  const switcherUrl = popupUrl.replace('popup.html', `switcher.html?tab=${f.ids.source}&window=${f.ids.window}&direction=1`);
  const created = context.waitForEvent('page', page => page.url() === switcherUrl);
  await worker.evaluate(url => chrome.windows.create({ url, type: 'popup', focused: true }), switcherUrl);
  const popup = await created;
  await popup.waitForFunction(() => typeof (window as any).__resumeSwitcherCommands === 'function');
  await popup.bringToFront();
  await popup.setViewportSize({ width: 750, height: 316 });
  const cdp = await context.newCDPSession(popup);
  const key = (key: string, code: string, windowsVirtualKeyCode: number, modifiers = 0) => cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers });
  await key('PageUp', 'PageUp', 33);
  await key('ArrowDown', 'ArrowDown', 40, 2);
  await key('PageUp', 'PageUp', 33);
  await key('ArrowUp', 'ArrowUp', 38, 1);
  await key('Tab', 'Tab', 9, 8);
  await popup.evaluate(() => (window as any).__stepSwitcher('switch-recent'));
  await key('PageDown', 'PageDown', 34);
  await popup.evaluate(() => (window as any).__resumeSwitcherCommands());
  const rows = popup.getByRole('option');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(20);
  const pageSize = await popup.locator('.recent-list').evaluate(node => Math.max(1, Math.floor(node.clientHeight / 40)));
  expect(pageSize).toBeLessThan(10);
  const target = await rows.nth(await rows.count() - 1 - pageSize).getAttribute('id');
  await expect(popup.getByRole('listbox')).toHaveAttribute('aria-activedescendant', target!);
  expect(await f.active()).toBe(f.ids.source);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 });
  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect.poll(f.active).toBe(Number(target!.replace('recent-', '')));
});
});

test.describe('windows', { tag: '@windows' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English recent bridge search during asynchronous startup supersedes buffered release', async () => {
  const f = await bridgeFixture();
  const script = await readFile(resolve('dist/switcher.js'), 'utf8');
  await context.route('**/switcher.js', async route => {
    await route.fulfill({ contentType: 'text/javascript', body: `const originalCommands = chrome.commands.getAll.bind(chrome.commands);\nchrome.commands.getAll = () => new Promise(resolve => { window.__resumeSwitcherCommands = () => originalCommands().then(resolve); });\n${script}` });
  });
  await f.a.keyboard.down('Control');
  const switcherUrl = popupUrl.replace('popup.html', `switcher.html?tab=${f.ids.source}&window=${f.ids.window}&direction=1`);
  const created = context.waitForEvent('page', page => page.url() === switcherUrl);
  await worker.evaluate(url => chrome.windows.create({ url, type: 'popup', focused: true }), switcherUrl);
  const popup = await created;
  await popup.waitForFunction(() => typeof (window as any).__resumeSwitcherCommands === 'function');
  await popup.bringToFront();
  const cdp = await context.newCDPSession(popup);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 });
  await popup.keyboard.press('Control+f');
  await popup.evaluate(() => (window as any).__resumeSwitcherCommands());
  const input = popup.getByRole('combobox'); await expect(input).toBeFocused();
  await expect(popup.locator('.palette-footer-title')).toHaveText('Tab Switcher');
  expect(await f.active()).toBe(f.ids.source);
  await input.pressSequentially('Bridge-B');
  await expect(popup.getByRole('option')).toHaveCount(1);
  await popup.locator('.primary-action').click();
  await expect.poll(() => popup.isClosed()).toBe(true); await expect.poll(f.active).toBe(f.ids.previous);
});
});

test.describe('windows', { tag: '@windows' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English recent bridge cancels when focus is lost before the window becomes ready', async () => {
  const f = await bridgeFixture();
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
});
});

test.describe('windows', { tag: '@windows' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English recent bridge ignores synthetic page releases and leaves typing unchanged', async () => {
  const f = await bridgeFixture();
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

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English recent bridge catches a quick release inside a focused child frame', async () => {
  const f = await bridgeFixture();
  await f.a.evaluate(url => { const frame = document.createElement('iframe'); frame.src = url; document.body.append(frame); }, `${origin}/Child-frame`);
  const input = f.a.frameLocator('iframe').getByRole('textbox');
  await input.click();
  await f.a.keyboard.down('Control'); await f.a.keyboard.up('Control');
  await f.open();
  await expect.poll(f.active).toBe(f.ids.previous);
  expect(await f.windows()).toBe(0);
});
});

test.describe('windows', { tag: '@windows' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English recent bridge does not infer release on pages without an injected listener', async () => {
  const f = await bridgeFixture();
  await f.a.goto('about:blank');
  const created = context.waitForEvent('page'); await f.open(); const popup = await created;
  await expect(popup.getByRole('option').first()).toBeVisible();
  expect(await f.active()).toBe(f.ids.source);
  await popup.keyboard.down('Escape');
  await expect.poll(() => popup.isClosed()).toBe(true);
  expect(await f.active()).toBe(f.ids.source);
});
});

test.describe('windows', { tag: '@windows' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English recent bridge preserves repeated command steps during delayed window startup', async () => {
  const f = await bridgeFixture();
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

test.describe('windows', { tag: '@windows' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English recent bridge closes a loading popup when its source window is removed', async () => {
  const f = await bridgeFixture();
  let resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  await context.route('**/switcher.js', async route => { await gate; await route.continue(); });
  await f.a.keyboard.down('Control');
  await f.open();
  await worker.evaluate(id => chrome.windows.remove(id), f.ids.window);
  resume();
  await expect.poll(f.windows).toBe(0);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English performance recent bridge reuses the prepared tabs instead of querying again', { tag: '@windows' }, async () => {
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
  const f = await bridgeFixture();
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

test.describe('headed', { tag: '@headed' }, () => {
test.use({ environment: { ...defaults, locale: 'en-US', commands: true, headed: true } });
test('Embedded Tab Switcher native palette returns to parent and confirms only in its source window', async () => {
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
