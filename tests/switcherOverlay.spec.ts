import { expect } from '@playwright/test';
import { focusClosedButton, pressNativeEnter } from './support/nativeInput';
import { test, defaults, origin, context, ui, worker } from './support/paletteFixture';
import { bridgeFixture } from './support/paletteHelpers';
import { registerPaletteFixture } from './support/paletteFixture';

registerPaletteFixture();

// Each variant owns fresh tabs; closed candidates cannot leak into later MRU lists.
async function withBridgeStep(run: (fixture: Awaited<ReturnType<typeof bridgeFixture>>) => Promise<void>) {
  const f = await bridgeFixture();
  const errors: unknown[] = [];
  try {
    await expect.poll(f.active).toBe(f.ids.source);
    await run(f);
  } catch (error) { errors.push(error); }
  finally {
    try { if (!f.a.isClosed()) await f.a.keyboard.up('Control'); } catch (error) { errors.push(error); }
    for (const page of [f.a, f.b]) {
      try { if (!page.isClosed()) await page.close(); } catch (error) { errors.push(error); }
    }
    try { await ui.bringToFront(); } catch (error) { errors.push(error); }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'Overlay step and cleanup failures');
}

async function delayRecentOverlay() {
  await worker.evaluate(() => {
    const state = globalThis as unknown as { __resumeOverlay?: () => void; __overlayPending?: boolean };
    const original = chrome.tabs.sendMessage.bind(chrome.tabs);
    state.__overlayPending = false;
    chrome.tabs.sendMessage = (async (id: number, message: any, options: any) => {
      if (message?.type === 'open-overlay') {
        chrome.tabs.sendMessage = original;
        state.__overlayPending = true;
        await new Promise<void>(resolve => { state.__resumeOverlay = resolve; });
        state.__overlayPending = false;
      }
      return original(id, message, options);
    }) as typeof chrome.tabs.sendMessage;
  });
}

async function resumeRecentOverlay() {
  await worker.evaluate(() => (globalThis as unknown as { __resumeOverlay: () => void }).__resumeOverlay());
}

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English recent bridge storage overlay geometry, search activation, filtered confirmation, no matches, and narrow layout', async () => {
    await test.step('shares palette geometry and focuses its capsule only after search activation', async () => {
      await withBridgeStep(async f => {
        await worker.evaluate(async () => {
          const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
          await Promise.all(callbacks.map(callback => callback('toggle-palette')));
        });
        const surface = f.a.frameLocator('.justonehop-frame');
        await expect(surface.getByRole('combobox')).toBeFocused();
        const paletteBounds = await surface.locator('.palette').boundingBox();
        const paletteFooter = await surface.locator('.palette-footer').boundingBox();
        const navigationHint = await surface.locator('.navigation-hint').innerHTML();
        const searchGeometry = () => surface.locator('.search-bar').evaluate(node => {
          const input = node.querySelector('input')!;
          // Compare the visible glyph; the focus-recovery button has a larger hit area.
          const icon = node.querySelector('.search-icon svg')!;
          const close = node.querySelector('.close-button')!;
          const rect = (element: Element) => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; };
          const pill = getComputedStyle(node, '::before');
          return { bar: rect(node), input: rect(input), icon: rect(icon), close: rect(close), border: pill.borderColor, radius: pill.borderRadius, background: pill.backgroundColor, font: getComputedStyle(input).fontSize };
        });
        await expect.poll(async () => (await searchGeometry()).border).toBe('rgb(11, 87, 208)');
        await expect.poll(async () => (await searchGeometry()).background).toBe('rgb(255, 255, 255)');
        const mainSearch = await searchGeometry();
        await f.a.keyboard.press('Escape');
        await f.a.keyboard.down('Control'); await f.open();
        await expect(f.a.locator('#justonehop-command-palette')).toBeAttached();
        await expect(surface.getByRole('listbox')).toBeFocused();
        await expect(surface.getByRole('combobox')).toBeDisabled();
        expect(await f.windows()).toBe(0);
        const switcherBounds = await surface.locator('.palette').boundingBox();
        expect(switcherBounds).toEqual(paletteBounds);
        expect(await surface.locator('.palette-footer').boundingBox()).toEqual(paletteFooter);
        expect(await surface.locator('.navigation-hint').innerHTML()).toBe(navigationHint);
        await expect.poll(async () => {
          const { bar, input, icon, close } = await searchGeometry();
          return { bar, input, icon, close };
        }).toEqual({ bar: mainSearch.bar, input: mainSearch.input, icon: mainSearch.icon, close: mainSearch.close });
        await expect.poll(async () => (await searchGeometry()).border).toBe('rgba(0, 0, 0, 0)');
        await expect(surface.getByRole('combobox')).toHaveValue('');
        await expect(surface.getByRole('combobox')).toHaveAttribute('placeholder', 'Search recent tabs…');
        await expect(surface.locator('.recent-help')).toHaveCount(0);
        await expect(surface.locator('.palette-footer-title')).toHaveText('Release Ctrl to switch');
        await expect(surface.locator('.primary-action')).toHaveText('Switch↵');
        await expect(surface.locator('.secondary-action')).toHaveText('Cancelesc');
        expect(await surface.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        await expect(surface.locator('.recent-overlay')).toHaveCSS('opacity', '1');
        await surface.locator('.palette').screenshot({ path: test.info().outputPath('justonehop-switcher-shared-footer.png') });
        const initial = await surface.locator('[aria-selected=true]').getAttribute('id');
        await f.a.keyboard.press('n');
        expect(await surface.locator('[aria-selected=true]').getAttribute('id')).not.toBe(initial);
        await f.a.keyboard.press('p');
        expect(await surface.locator('[aria-selected=true]').getAttribute('id')).toBe(initial);
        expect(await f.active()).toBe(f.ids.source);
        await surface.locator('button.search-icon').click();
        await expect(surface.getByRole('combobox')).toBeEnabled();
        await expect(surface.getByRole('combobox')).toBeFocused();
        await expect.poll(searchGeometry).toEqual(mainSearch);
        await surface.locator('.palette').screenshot({ path: test.info().outputPath('justonehop-switcher-activated.png') });
        await f.a.keyboard.up('Control');
        await expect(surface.getByRole('combobox')).toBeFocused();
        expect(await f.active()).toBe(f.ids.source);
        await surface.locator('.primary-action').click();
        await expect.poll(f.active).toBe(Number(initial!.replace('recent-', '')));
        await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
      });
    });

    await test.step('held search activation ignores release and confirms filtered results with Enter', async () => {
      await withBridgeStep(async f => {
        const extra = await context.newPage();
        try {
          await extra.goto(`${origin}/Bridge-C`);
          await f.a.bringToFront();
          await f.a.keyboard.down('Control'); await f.open();
          const surface = f.a.frameLocator('.justonehop-frame');
          const input = surface.getByRole('combobox');
          await expect(surface.getByRole('listbox')).toBeFocused(); await expect(input).toBeDisabled();
          await f.a.keyboard.press('f');
          await expect(input).toBeEnabled(); await expect(input).toBeFocused();
          await input.fill('Bridge');
          await expect(surface.getByRole('option')).toHaveCount(3);
          const selected = await input.getAttribute('aria-activedescendant');
          await f.a.keyboard.press('n');
          await expect(input).not.toHaveAttribute('aria-activedescendant', selected!);
          await f.a.keyboard.press('p');
          await expect(input).toHaveAttribute('aria-activedescendant', selected!);
          await expect(input).toHaveValue('Bridge');
          expect(await f.active()).toBe(f.ids.source);
          await input.fill('Bridge C');
          await expect(surface.getByRole('option')).toHaveCount(1);
          await expect(surface.locator('.entry-title mark')).toHaveText(['Bridge', 'C']);
          await expect(surface.locator('.recent-overlay')).toHaveCSS('opacity', '1');
          await surface.locator('.palette').screenshot({ path: test.info().outputPath('justonehop-switcher-filtered.png') });
          const target = Number((await input.getAttribute('aria-activedescendant'))!.replace('recent-', ''));
          await f.a.keyboard.up('Control');
          await expect(input).toBeFocused(); await expect(input).toHaveValue('Bridge C');
          await expect(f.a.locator('#justonehop-command-palette')).toBeAttached();
          expect(await f.active()).toBe(f.ids.source);
          await f.a.keyboard.press('Enter');
          await expect.poll(f.active).toBe(target);
          await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
        } finally {
          if (!extra.isClosed()) await extra.close();
        }
      });
    });

    for (const method of ['wrapper', 'icon', 'keyboard'] as const) {
      await test.step(`activate with ${method} and release modifier`, async () => {
        await withBridgeStep(async f => {
          await f.a.keyboard.down('Control'); await f.open();
          const surface = f.a.frameLocator('.justonehop-frame');
          const input = surface.getByRole('combobox');
          await expect(surface.getByRole('listbox')).toBeFocused(); await expect(input).toBeDisabled();
          if (method === 'wrapper') await surface.locator('.recent-search-field').click();
          else if (method === 'icon') await surface.locator('button.search-icon.recent-search-activate').click();
          else await f.a.keyboard.press('f');
          await expect(input).toBeEnabled();
          await expect(surface.locator('.palette-footer-title')).toHaveText('Tab Switcher');
          await f.a.keyboard.up('Control');
          await expect(input).toBeFocused(); expect(await f.active()).toBe(f.ids.source);
          const list = surface.getByRole('listbox');
          await list.click({ position: { x: 10, y: 240 } });
          await expect(list).toBeFocused();
          if (method === 'wrapper') await surface.locator('.recent-search-field').click();
          else if (method === 'icon') await surface.locator('button.search-icon.recent-search-activate').click();
          else await f.a.keyboard.press('Control+f');
          await expect(input).toBeFocused();
          await input.pressSequentially('Bridge-B');
          await expect(surface.getByRole('option')).toHaveCount(1);
          await surface.locator('.palette').screenshot({ path: test.info().outputPath(`justonehop-switcher-search-${method}.png`) });
          await f.a.keyboard.press('Enter');
          await expect.poll(f.active).toBe(f.ids.previous);
          await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
        });
      });
    }

    await test.step('search with no matches stays open until a visible choice', async () => {
      await withBridgeStep(async f => {
        await f.a.keyboard.down('Control'); await f.open();
        const surface = f.a.frameLocator('.justonehop-frame');
        const input = surface.getByRole('combobox');
        await expect(surface.getByRole('listbox')).toBeFocused(); await expect(input).toBeDisabled();
        await surface.locator('button.search-icon').click();
        await expect(input).toBeEnabled(); await expect(input).toBeFocused();
        await input.fill('no-such-tab');
        await expect(surface.getByRole('option')).toHaveCount(0);
        await expect(input).not.toHaveAttribute('aria-activedescendant');
        await expect(surface.locator('.primary-action')).toBeDisabled();
        await f.a.keyboard.press('Enter');
        await f.a.keyboard.up('Control');
        expect(await f.active()).toBe(f.ids.source);
        await expect(input).toBeFocused();
        await input.fill(`${origin}/Bridge-B`);
        await expect(surface.getByRole('option')).toHaveCount(1);
        await f.a.keyboard.press('Shift+Enter');
        await expect(input).toBeFocused(); expect(await f.active()).toBe(f.ids.source);
        await input.press('ArrowDown');
        await surface.getByRole('option').click();
        await expect.poll(f.active).toBe(f.ids.previous);
      });
    });

    await test.step('mouse selection and narrow geometry match palette', async () => {
      await withBridgeStep(async f => {
        await f.a.setViewportSize({ width: 390, height: 440 });
        await f.open();
        const surface = f.a.frameLocator('.justonehop-frame');
        await expect(surface.getByRole('listbox')).toBeFocused();
        await expect(surface.getByRole('combobox')).toBeDisabled();
        const before = await surface.locator('.palette').boundingBox();
        expect(before!.x).toBe(10); expect(before!.y).toBe(24);
        expect(before!.x + before!.width).toBeLessThanOrEqual(380);
        expect(before!.y + before!.height).toBeLessThanOrEqual(416);
        const footer = await surface.locator('.palette-footer').boundingBox();
        expect(footer!.height).toBe(44);
        expect(footer!.y + footer!.height).toBe(before!.y + before!.height - 1);
        await expect(surface.locator('.palette-footer-context')).toBeHidden();
        await expect(surface.locator('.palette-footer-title')).toHaveText('Release Ctrl to switch');
        await expect(surface.getByRole('combobox')).toHaveAttribute('placeholder', 'Search recent tabs…');
        expect((await surface.locator('.search-bar').boundingBox())!.height).toBe(56);
        await surface.locator('button.search-icon').click();
        await expect(surface.getByRole('combobox')).toBeEnabled();
        await expect(surface.getByRole('combobox')).toBeFocused();
        await surface.getByRole('combobox').fill('Bridge');
        await expect(surface.getByRole('option')).toHaveCount(2);
        await expect(surface.locator('.primary-action')).toBeInViewport({ ratio: 1 });
        await expect(surface.locator('.secondary-action')).toBeInViewport({ ratio: 1 });
        expect(await surface.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        await expect.poll(() => surface.locator('.recent-overlay').evaluate(node => getComputedStyle(node).opacity)).toBe('1');
        await surface.locator('.palette').screenshot({ path: test.info().outputPath('justonehop-switcher-shared-footer-narrow-English.png') });
        await surface.getByRole('option').filter({ hasText: 'Bridge B' }).click();
        await expect.poll(f.active).toBe(f.ids.previous);
        await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
      });
    });
  });

  test('English recent bridge storage overlay quick taps, no-flash release, held shortcut navigation, and delayed opening', async () => {
    await test.step('quick taps alternate without creating a window', async () => {
      await withBridgeStep(async f => {
        for (let attempt = 0; attempt < 6; attempt++) {
          const page = attempt % 2 ? f.b : f.a;
          await page.keyboard.down('Control'); await page.keyboard.up('Control'); await f.open();
          await expect.poll(f.active).toBe(attempt % 2 ? f.ids.source : f.ids.previous);
          expect(await f.windows()).toBe(0);
          await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
        }
      });
    });

    await test.step('buffers release and repeated shortcuts while opening', async () => {
      await withBridgeStep(async f => {
        await delayRecentOverlay();
        await f.a.keyboard.down('Control');
        const opening = f.open();
        await expect.poll(() => worker.evaluate(() => !!(globalThis as unknown as { __overlayPending: boolean }).__overlayPending)).toBe(true);
        await f.open(); await f.open();
        const order = await worker.evaluate(async id => (await chrome.tabs.query({ windowId: id }))
          .sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0) || a.index - b.index).map(tab => tab.id), f.ids.window);
        await f.a.keyboard.up('Control');
        await resumeRecentOverlay(); await opening;
        await expect.poll(f.active).toBe(order[3 % order.length]);
        await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
        expect(await f.windows()).toBe(0);
      });
    });

    await test.step('quick release never paints the scrim or panel', async () => {
      await withBridgeStep(async f => {
        await f.a.evaluate(() => {
          const samples: number[] = [];
          (window as any).__switcherPaint = samples;
          const sample = () => {
            const dialog = document.querySelector('#justonehop-command-palette')?.shadowRoot?.querySelector('dialog');
            if (dialog) {
              const surface = dialog.querySelector('iframe')?.contentDocument?.body.shadowRoot?.querySelector('.recent-overlay');
              if (surface) {
                const backdrop = getComputedStyle(dialog, '::backdrop');
                const scrimVisible = backdrop.backgroundColor !== 'rgba(0, 0, 0, 0)' && Number(backdrop.opacity) > 0;
                samples.push(scrimVisible ? 1 : Number(getComputedStyle(surface).opacity));
              }
            }
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
        await f.a.keyboard.down('Control'); await f.open();
        // Release after one painted frame, rather than before the background starts.
        await f.a.waitForFunction(() => (window as any).__switcherPaint.length > 0, undefined, { polling: 'raf' });
        await f.a.keyboard.up('Control');
        await expect.poll(f.active).toBe(f.ids.previous);
        const samples = await f.a.evaluate(() => (window as any).__switcherPaint as number[]);
        expect(samples.length).toBeGreaterThan(0);
        expect(samples.every(opacity => opacity === 0)).toBe(true);
      });
    });

    await test.step('held shortcut reveals and navigates normally', async () => {
      await withBridgeStep(async f => {
        await f.a.keyboard.down('Control'); await f.open();
        const surface = f.a.frameLocator('.justonehop-frame');
        await expect(surface.locator('.recent-overlay')).toHaveCSS('opacity', '1');
        for (const theme of ['light', 'dark']) {
          await surface.locator('.recent-overlay').evaluate((node, value) => { node.setAttribute('data-theme', value); }, theme);
          await expect(surface.locator('.recent-overlay')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
          expect(await f.a.locator('#justonehop-command-palette').evaluate(host =>
            getComputedStyle(host.shadowRoot!.querySelector('dialog')!, '::backdrop').backgroundColor)).toBe('rgba(0, 0, 0, 0)');
        }
        const list = surface.getByRole('listbox');
        const input = surface.getByRole('combobox');
        await expect(list).toBeFocused(); await expect(input).toBeDisabled();
        await expect(input).not.toBeFocused(); await expect(input).not.toHaveAttribute('aria-activedescendant');
        const selected = await list.getAttribute('aria-activedescendant');
        await f.a.keyboard.press('n');
        await expect(list).not.toHaveAttribute('aria-activedescendant', selected!);
        await f.a.keyboard.press('p');
        await expect(list).toHaveAttribute('aria-activedescendant', selected!);
        await expect(list).toBeFocused(); await expect(input).toBeDisabled();
        await expect(input).toHaveValue(''); await expect(input).toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)');
        await expect.poll(() => surface.locator('.search-bar').evaluate(node => {
          const style = getComputedStyle(node, '::before');
          return { border: style.borderColor, shadow: style.boxShadow };
        })).toEqual({ border: 'rgba(0, 0, 0, 0)', shadow: 'none' });
        await surface.locator('.palette').screenshot({ path: test.info().outputPath('justonehop-switcher-disabled.png') });
        await f.a.keyboard.up('Control');
        await expect.poll(f.active).toBe(f.ids.previous);
        await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
        await f.a.bringToFront();
        await f.a.keyboard.down('Control'); await f.open();
        await expect(surface.locator('.current-badge')).toHaveText('Current');
        await expect(surface.locator('.search-dismiss')).toHaveAttribute('title', 'Escape — Cancel');
        await surface.getByRole('button', { name: 'Search recent tabs…' }).click();
        await expect(surface.getByRole('combobox')).toBeEnabled();
        await f.a.keyboard.up('Control');
        await expect(f.a.locator('#justonehop-command-palette')).toBeAttached();
        expect(await f.active()).toBe(f.ids.source);
        await surface.locator('.search-dismiss').click();
        await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
        expect(await f.active()).toBe(f.ids.source);
        await f.a.keyboard.down('Control'); await f.open();
        await expect(surface.locator('.recent-overlay')).toHaveCSS('opacity', '1');
        await surface.locator('.recent-overlay').click({ position: { x: 2, y: 2 } });
        await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
        await f.a.keyboard.up('Control');
        expect(await f.active()).toBe(f.ids.source);
      });
    });
  });

  test('English recent bridge storage overlay cancellation, candidate removal, unfocused fallback, and worker stop', { tag: '@windows' }, async () => {
    for (const reason of ['Escape', 'outside click'] as const) {
      await test.step(`cancel with ${reason}`, async () => {
        await withBridgeStep(async f => {
          await f.a.getByRole('textbox').fill('keep my text'); await f.a.getByRole('textbox').focus();
          await f.a.keyboard.down('Control'); await f.open();
          const surface = f.a.frameLocator('.justonehop-frame');
          await expect(surface.getByRole('listbox')).toBeFocused();
          if (reason === 'Escape') await f.a.keyboard.press('Escape');
          else await surface.locator('.recent-overlay').click({ position: { x: 5, y: 5 } });
          await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
          expect(await f.active()).toBe(f.ids.source);
          expect(await f.windows()).toBe(0);
          await expect(f.a.getByRole('textbox')).toHaveValue('keep my text');
          await expect(f.a.getByRole('textbox')).toBeFocused();
          await f.a.keyboard.up('Control');
          expect(await f.active()).toBe(f.ids.source);
        });
      });
    }

    for (const reason of ['another window', 'another tab', 'opening interrupted'] as const) {
      await test.step(`cancels on ${reason} without accepting a tab`, async () => {
        await withBridgeStep(async f => {
          let createdWindowId: number | undefined;
          try {
            await f.a.getByRole('textbox').fill('keep my text'); await f.a.getByRole('textbox').focus();
            if (reason === 'opening interrupted') await delayRecentOverlay();
            await f.a.keyboard.down('Control');
            const opening = f.open();
            if (reason === 'opening interrupted') {
              await expect.poll(() => worker.evaluate(() => !!(globalThis as unknown as { __overlayPending: boolean }).__overlayPending)).toBe(true);
              const other = await worker.evaluate(() => chrome.windows.create({ url: 'about:blank', focused: true }));
              createdWindowId = other?.id;
              await resumeRecentOverlay(); await opening;
              expect(await worker.evaluate(async () => (await chrome.windows.getLastFocused()).id)).toBe(other!.id);
            } else {
              await opening;
              const surface = f.a.frameLocator('.justonehop-frame');
              await expect(surface.getByRole('listbox')).toBeFocused();
              if (reason === 'another window') {
                const other = await worker.evaluate(() => chrome.windows.create({ url: 'about:blank', focused: true }));
                createdWindowId = other?.id;
              }
              if (reason === 'another tab') await worker.evaluate(id => chrome.tabs.update(id, { active: true }), f.ids.previous);
            }
            await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
            expect(await f.active()).toBe(reason === 'another tab' ? f.ids.previous : f.ids.source);
            expect(await f.windows()).toBe(0);
            await expect(f.a.getByRole('textbox')).toHaveValue('keep my text');
          } finally {
            if (createdWindowId !== undefined) {
              await worker.evaluate(id => chrome.windows.remove(id).catch(() => {}), createdWindowId);
            }
          }
        });
      });
    }

    await test.step('keeps source selected when a candidate closes', async () => {
      await withBridgeStep(async f => {
        await f.a.keyboard.down('Control'); await f.open();
        const surface = f.a.frameLocator('.justonehop-frame');
        await expect(surface.getByRole('listbox')).toBeFocused();
        await worker.evaluate(id => chrome.tabs.remove(id), f.ids.previous);
        await expect(surface.locator('[aria-selected=true]')).toHaveAttribute('id', `recent-${f.ids.source}`);
        await f.a.keyboard.up('Control');
        await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
        expect(await f.active()).toBe(f.ids.source);
      });
    });

    await test.step('rejects unfocused pages and retains window fallback', async () => {
      await withBridgeStep(async f => {
        await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
          Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false });
        } }), f.ids.source);
        const created = context.waitForEvent('page', page => page.url().includes('switcher.html'));
        await f.open(); const popup = await created;
        await expect(popup.getByRole('listbox')).toBeFocused();
        await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
        expect(await f.active()).toBe(f.ids.source);
        await popup.keyboard.press('Escape').catch(error => { if (!popup.isClosed()) throw error; });
        await expect.poll(() => popup.isClosed()).toBe(true);
      });
    });

    await test.step('closes safely when its worker stops', async () => {
      const f = await bridgeFixture();
      await f.a.keyboard.down('Control'); await f.open();
      await expect(f.a.frameLocator('.justonehop-frame').getByRole('listbox')).toBeFocused();
      const monitor = await context.newCDPSession(f.a);
      await monitor.send('ServiceWorker.enable'); await monitor.send('ServiceWorker.stopAllWorkers');
      await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
    });
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, commands: true } });
  test('English recent bridge closed storage overlay Enter belongs to focused buttons and preserves production navigation and release', async () => {
    for (const action of ['header cancel', 'footer cancel', 'search', 'switch'] as const) {
      await test.step(`Enter activates focused ${action} button`, async () => {
        await withBridgeStep(async f => {
          await f.a.keyboard.down('Control'); await f.open();
          await expect(f.a.locator('#justonehop-command-palette')).toBeAttached();
          // The step closes this page, which also ends its CDP session.
          const cdp = await context.newCDPSession(f.a);
          const name = action.includes('cancel') ? 'Cancel' : action === 'search' ? 'Search recent tabs…' : 'Switch';
          const frameId = await focusClosedButton(cdp, name, action === 'footer cancel' ? 1 : 0, action.includes('cancel') ? 2 : 1);
          await pressNativeEnter(cdp, f.a);
          if (action === 'search') {
            await f.a.keyboard.up('Control');
            const focusedInput = async () => (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes.some(node =>
              node.role?.value === 'combobox' && node.properties?.some(property => property.name === 'focused' && property.value?.value === true));
            await expect.poll(focusedInput).toBe(true);
            expect(await f.active()).toBe(f.ids.source);
            await f.a.keyboard.press('Escape');
          }
          await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
          expect(await f.active()).toBe(action === 'switch' ? f.ids.previous : f.ids.source);
        });
      });
    }

    await test.step('preserves production navigation and release', async () => {
      await withBridgeStep(async f => {
        await f.a.keyboard.down('Control'); await f.open();
        await expect(f.a.locator('#justonehop-command-palette')).toBeAttached();
        const cdp = await context.newCDPSession(f.a);
        const selectedName = async () => {
          const { frameTree } = await cdp.send('Page.getFrameTree');
          const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
          const { nodes } = await cdp.send('Accessibility.getFullAXTree', { frameId });
          return nodes.find(node => node.role?.value === 'option' && node.properties?.some(property => property.name === 'selected' && property.value?.value === true))?.name?.value;
        };
        await expect.poll(selectedName).toContain('Bridge B');
        await f.a.keyboard.press('n');
        await expect.poll(selectedName).not.toContain('Bridge B');
        await f.a.keyboard.press('p');
        await expect.poll(selectedName).toContain('Bridge B');
        expect(await f.active()).toBe(f.ids.source);
        await f.a.keyboard.up('Control');
        await expect.poll(f.active).toBe(f.ids.previous);
        await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
        expect(await f.windows()).toBe(0);
      });
    });
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, commands: true, vimium: true } });
  test('English recent bridge closed storage overlay preserves Vimium navigation and release', async () => {
    const f = await bridgeFixture(); await f.a.keyboard.down('Control'); await f.open();
    await expect(f.a.locator('#justonehop-command-palette')).toBeAttached();
    const cdp = await context.newCDPSession(f.a);
    const selectedName = async () => {
      const { frameTree } = await cdp.send('Page.getFrameTree');
      const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
      const { nodes } = await cdp.send('Accessibility.getFullAXTree', { frameId });
      return nodes.find(node => node.role?.value === 'option' && node.properties?.some(property => property.name === 'selected' && property.value?.value === true))?.name?.value;
    };
    await expect.poll(selectedName).toContain('Bridge B');
    await f.a.keyboard.press('n');
    await expect.poll(selectedName).not.toContain('Bridge B');
    await f.a.keyboard.press('p');
    await expect.poll(selectedName).toContain('Bridge B');
    expect(await f.active()).toBe(f.ids.source);
    await f.a.keyboard.up('Control');
    await expect.poll(f.active).toBe(f.ids.previous);
    await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
    expect(await f.windows()).toBe(0);
  });
});
