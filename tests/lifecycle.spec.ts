import { test as base, expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, defaults, origin, context, ui, worker, popupUrl, setUI, setWorker } from './support/paletteFixture';
import { openNativePalette } from './support/paletteHelpers';
import { registerPaletteFixture } from './support/paletteFixture';

registerPaletteFixture();

test('close others preserves pinned tabs and another window; restore is functional', { tag: '@windows' }, async () => {
  const seed = await ui.evaluate(async base => {
    const self = (await chrome.tabs.getCurrent())!;
    const pinned = await chrome.tabs.create({ url: `${base}/Pinned`, pinned: true, active: false });
    const disposable = await chrome.tabs.create({ url: `${base}/Disposable`, active: false });
    const other = await chrome.windows.create({ url: `${base}/Other-window`, focused: false });
    return { self: self.id!, pinned: pinned.id!, disposable: disposable.id!, other: other!.tabs![0].id! };
  }, origin);
  await expect.poll(() => worker.evaluate(id => chrome.tabs.get(id).then(tab => tab.status), seed.disposable)).toBe('complete');
  await ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' }).fill('close other');
  await expect(ui.locator('#justonehop-results [aria-selected="true"]')).toContainText('关闭其他');
  await ui.keyboard.press('Enter');
  await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(t => t.id === id), seed.disposable)).toBe(false);
  const survivors = await worker.evaluate(async () => (await chrome.tabs.query({})).map(t => t.id));
  expect(survivors).toContain(seed.pinned); expect(survivors).toContain(seed.other);
  await expect(ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' })).toHaveValue('close other');
  await expect(ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' })).toBeFocused();
  await expect(ui.getByRole('dialog')).toHaveCount(0);
  const restorable = await ui.evaluate(async base => (await chrome.tabs.create({ url: `${base}/Restore-Target`, active: false })).id!, origin);
  await expect.poll(() => worker.evaluate(id => chrome.tabs.get(id).then(tab => tab.status), restorable)).toBe('complete');
  await ui.evaluate(id => chrome.tabs.remove(id), restorable);
  await ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' }).fill('restore');
  await expect(ui.locator('#justonehop-results [aria-selected="true"]')).toContainText('恢复');
  await ui.keyboard.press('Enter');
  await expect.poll(() => worker.evaluate(async base => (await chrome.tabs.query({})).some(t => t.url === `${base}/Restore-Target`), origin)).toBe(true);
});

test.describe(() => {
  test.use({ environment: { ...defaults, pageAccess: true } });
  test('overlay isolates page styles and restores real typing focus after Escape', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/Focus-fixture`);
  await page.addStyleTag({ content: 'dialog { display:none!important } button {color:red!important}' });
  await page.getByRole('textbox', { name: 'Page input' }).fill('before');
  const tabId = await ui.evaluate(async base => (await chrome.tabs.query({})).find(tab => tab.url === `${base}/Focus-fixture`)!.id!, origin);
  await worker.evaluate(async id => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(id, { source: 'justonehop', type: 'toggle' });
  }, tabId);
  await expect(page.locator('#justonehop-command-palette')).toBeAttached();
  const cdp = await context.newCDPSession(page);
  const ax = async () => {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
    return (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes;
  };
  const comboValue = async () => {
    const combo = (await ax()).find(node => node.role?.value === 'combobox');
    return combo ? combo.value?.value ?? '' : undefined;
  };
  await expect.poll(comboValue).toBe('');
  await page.screenshot({ path: test.info().outputPath('overlay-refined.png'), animations: 'disabled' });
  await page.keyboard.type('example');
  await expect.poll(comboValue).toBe('example');
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('close right');
  await expect.poll(comboValue).toBe('close right');
  await page.screenshot({ path: test.info().outputPath('overlay.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 400 });
  await page.keyboard.press('Meta+k');
  await expect.poll(comboValue).toBe('');
  await page.screenshot({ path: test.info().outputPath('overlay-narrow-actions.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect.poll(comboValue).toBe('close right');
  await page.keyboard.press('Escape');
  await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
  await expect(page.getByRole('textbox', { name: 'Page input' })).toBeFocused();
  await page.keyboard.type('-after');
  await expect(page.getByRole('textbox', { name: 'Page input' })).toHaveValue('before-after');
  const tabCount = await worker.evaluate(() => chrome.tabs.query({}).then(tabs => tabs.length));
  await worker.evaluate(id => chrome.tabs.sendMessage(id, { source: 'justonehop', type: 'toggle' }), tabId);
  await expect.poll(comboValue).toBe('');
  await page.keyboard.type('new');
  await expect.poll(comboValue).toBe('new');
  await expect.poll(async () => {
    const nodes = await ax();
    return nodes.some(node => node.role?.value === 'listbox' && !node.properties?.some(prop => prop.name === 'busy' && prop.value.value === true)) &&
      nodes.some(node => node.role?.value === 'option' && node.name?.value?.includes('新建标签页') && node.properties?.some(prop => prop.name === 'selected' && prop.value.value === true));
  }, { message: 'New tab command is selected and ready' }).toBe(true);
  await page.keyboard.press('Enter');
  await expect.poll(() => worker.evaluate(() => chrome.tabs.query({}).then(tabs => tabs.length))).toBe(tabCount + 1);
  await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, commands: true } });
  test('English keep-open closed-shadow overlay keyboard closes two explicit targets and restores real typing', async () => {
    const page = await context.newPage(); await page.goto(`${origin}/Closed-keyboard-host`);
    const seeded = await worker.evaluate(async origin => {
      const host = (await chrome.tabs.query({})).find(tab => tab.url === `${origin}/Closed-keyboard-host`)!;
      const first = await chrome.tabs.create({ windowId: host.windowId, url: `${origin}/Closed-target-Alpha`, active: false });
      const second = await chrome.tabs.create({ windowId: host.windowId, url: `${origin}/Closed-target-Beta`, active: false });
      return { host: host.id!, first: first.id!, second: second.id! };
    }, origin);
    for (const id of [seeded.first, seeded.second]) {
      await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).status, id)).toBe('complete');
    }
    await page.bringToFront();
    await worker.evaluate(async () => {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    });
    await expect(page.locator('#justonehop-command-palette')).toBeAttached();
    expect(await page.locator('#justonehop-command-palette').evaluate(node => node.shadowRoot)).toBeNull();
    const cdp = await context.newCDPSession(page);
    const ax = async () => {
      const { frameTree } = await cdp.send('Page.getFrameTree');
      const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
      return (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes;
    };
    const combo = async (name: string) => (await ax()).find(node => node.role?.value === 'combobox' && node.name?.value === name);
    const rootName = 'Search commands, tabs, bookmarks, and history';
    await expect.poll(async () => (await combo(rootName))?.properties?.find(property => property.name === 'focused')?.value.value).toBe(true);
    await page.keyboard.type('Closed target Alpha');
    for (const [query, target] of [['Closed target Alpha', seeded.first], ['Closed target Beta', seeded.second]] as const) {
      await expect.poll(async () => (await combo(rootName))?.value?.value).toBe(query);
      // Typing is immediate; history/snapshot refresh can still disable Actions.
      await expect.poll(async () => {
        const nodes = await ax();
        return nodes.some(node => node.role?.value === 'listbox' &&
          !node.properties?.some(property => property.name === 'busy' && property.value.value === true)) &&
          nodes.some(node => node.role?.value === 'option' && String(node.name?.value).includes(query) &&
            node.properties?.some(property => property.name === 'selected' && property.value.value === true));
      }, { message: 'Target tab is selected and Actions are ready' }).toBe(true);
      await page.keyboard.press('Meta+k');
      await expect.poll(async () => (await combo('Search actions'))?.properties?.find(property => property.name === 'focused')?.value.value).toBe(true);
      await page.keyboard.type('close tab');
      await expect.poll(async () => (await combo('Search actions'))?.value?.value).toBe('close tab');
      await page.keyboard.press('Enter');
      await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(tab => tab.id === id), target)).toBe(false);
      await expect.poll(async () => (await ax()).some(node => node.role?.value === 'dialog' && node.name?.value === 'Actions')).toBe(false);
      await expect.poll(async () => (await combo(rootName))?.value?.value).toBe(query);
      await expect.poll(async () => (await combo(rootName))?.properties?.find(property => property.name === 'focused')?.value.value).toBe(true);
      await expect(page.locator('#justonehop-command-palette')).toBeAttached();
      expect(await worker.evaluate(id => chrome.tabs.get(id), seeded.host)).toMatchObject({ active: true, url: `${origin}/Closed-keyboard-host` });
      await page.keyboard.press('Meta+a');
      await page.keyboard.type(target === seeded.first ? 'Closed target Beta' : 'settings');
    }
    await expect.poll(async () => (await combo(rootName))?.value?.value).toBe('settings');
    expect(page.isClosed()).toBe(false);
    await cdp.detach();
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English wheel back preserves layers readers and cancels on other input', async () => {
    const page = await context.newPage(); await page.goto(`${origin}/Wheel-readers`);
    await page.evaluate(() => localStorage.setItem('wide', 'wide text '.repeat(400)));
    await worker.evaluate(async () => {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    });
    const surface = page.frameLocator('.justonehop-frame');
    const search = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await search.fill('local storage');
    await expect(surface.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
    await expect(surface.locator('.primary-action')).toBeEnabled();
    await search.press('Enter');
    const keys = surface.getByRole('combobox', { name: 'Search storage keys' });
    await expect(surface.locator('.storage-row')).toHaveCount(1);
    const reader = surface.locator('.storage-preview .preview-code');
    await reader.hover(); await page.mouse.wheel(300, 0);
    await expect.poll(() => reader.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
    await page.mouse.wheel(-1000, 0);
    await expect.poll(() => reader.evaluate(node => node.scrollLeft)).toBe(0);
    await page.mouse.wheel(-200, 0);
    await page.waitForTimeout(300);
    await expect(keys).toBeVisible();
    await keys.fill('wide'); await keys.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 3));
    await surface.locator('.storage-row').click({ button: 'right' });
    await expect(surface.locator('.action-menu')).toBeVisible();
    await surface.locator('.action-heading').hover();
    for (const amount of [-45, -70, -30, -12, -4]) await page.mouse.wheel(amount, 0);
    await expect(surface.locator('.action-menu')).toHaveCount(0);
    await expect(keys).toBeFocused(); await expect(keys).toHaveValue('wide');
    expect(await keys.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 3]);
    // Playwright wheel calls may span several native sequences. End the reader's
    // final tail before starting a distinct gesture over the footer.
    await page.waitForTimeout(300);
    await surface.locator('.palette-footer-title').hover();
    await page.mouse.wheel(-60, 0);
    await expect(surface.locator('.wheel-back-hint')).toHaveAttribute('data-ready', 'false');
    await keys.evaluate(node => ((node.getRootNode() as ShadowRoot).activeElement as HTMLElement)?.blur());
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300); await expect(keys).toBeVisible();
    await surface.locator('.palette-footer-title').hover();
    await page.mouse.wheel(-20, 0); await page.waitForTimeout(300); await expect(keys).toBeVisible();
    await page.mouse.wheel(0, 150); await page.waitForTimeout(300); await expect(keys).toBeVisible();
    await page.mouse.wheel(-140, 0); await expect(search).toBeFocused();
    await expect(search).toHaveValue('local storage');
    await search.fill('tab switcher');
    await expect(surface.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
    await expect(surface.locator('.primary-action')).toBeEnabled();
    await search.press('Enter');
    await expect(surface.locator('.recent-switcher')).toBeVisible();
    await page.waitForTimeout(300);
    await surface.locator('.palette-footer-title').hover(); await page.mouse.wheel(-140, 0);
    await expect(search).toBeFocused(); await expect(search).toHaveValue('tab switcher');
    await page.keyboard.press('Escape'); await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, commands: true } });
  test('English wheel back works in the closed iframe and closes only the palette', async () => {
    const page = await context.newPage(); await page.goto(`${origin}/Wheel-closed`);
    await page.getByRole('textbox', { name: 'Page input' }).focus();
    await worker.evaluate(async () => {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    });
    const cdp = await context.newCDPSession(page);
    const focused = async (name: string) => {
      const { frameTree } = await cdp.send('Page.getFrameTree');
      const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
      const { nodes } = await cdp.send('Accessibility.getFullAXTree', { frameId });
      return nodes.some(node => node.name?.value === name && node.properties?.some(prop => prop.name === 'focused' && prop.value.value === true));
    };
    await expect.poll(() => focused('Search commands, tabs, bookmarks, and history')).toBe(true);
    // Wait for the settings button before using the shared keyboard shortcut.
    await expect.poll(async () => {
      const { frameTree } = await cdp.send('Page.getFrameTree');
      const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
      return (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes.some(node =>
        node.role?.value === 'button' && node.name?.value === 'Settings' &&
        !node.properties?.some(prop => prop.name === 'disabled' && prop.value.value === true));
    }).toBe(true);
    await page.keyboard.press('Meta+,');
    await expect.poll(() => focused('Search settings')).toBe(true);
    const size = page.viewportSize()!;
    await page.mouse.move(size.width / 2, Math.min(150, Math.max(28, size.height * .16)) + 30);
    await page.mouse.wheel(-140, 0);
    await expect.poll(() => focused('Search commands, tabs, bookmarks, and history')).toBe(true);
    await page.waitForTimeout(300);
    await page.mouse.wheel(-140, 0);
    await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
    await expect(page.getByRole('textbox', { name: 'Page input' })).toBeFocused();
    await expect(page).toHaveURL(`${origin}/Wheel-closed`);
    await cdp.detach();
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, commands: true } });
  test('English palette launch overlay Backspace respects fields inside the closed keyboard frame', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Backspace-navigation`);
  await page.evaluate(() => localStorage.setItem('fixture', '{"value":42}'));
  await worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  const cdp = await context.newCDPSession(page);
  const ax = async () => {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
    return (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes;
  };
  const focused = async (name: string) => (await ax()).some(node => node.name?.value === name && node.properties?.some(prop => prop.name === 'focused' && prop.value.value === true));
  const openCommand = async (query: string, title: string) => {
    await page.keyboard.press('Meta+a'); await page.keyboard.type(query);
    await expect.poll(async () => {
      const nodes = await ax();
      return nodes.some(node => node.role?.value === 'combobox' && node.value?.value === query) &&
        nodes.some(node => node.role?.value === 'listbox' && !node.properties?.some(prop => prop.name === 'busy' && prop.value.value === true)) &&
        nodes.some(node => node.role?.value === 'option' && node.name?.value?.includes(title) && node.properties?.some(prop => prop.name === 'selected' && prop.value.value === true));
    }, { message: `Selected command ready: ${query}` }).toBe(true);
    await page.keyboard.press('Enter');
  };
  await expect.poll(() => focused('Search commands, tabs, bookmarks, and history')).toBe(true);
  await openCommand('help', 'Help');
  await expect.poll(() => focused('Search help')).toBe(true);
  await page.keyboard.type('x'); await page.keyboard.press('Backspace');
  await expect.poll(() => focused('Search help')).toBe(true);
  await page.keyboard.press('Backspace');
  await expect.poll(() => focused('Search commands, tabs, bookmarks, and history')).toBe(true);
  await openCommand('ctrl tab', 'Set Up Ctrl+Tab');
  await expect.poll(() => focused('Set Up')).toBe(true);
  await page.keyboard.press('Enter'); await expect.poll(() => focused('Copy & Open')).toBe(true);
  await page.keyboard.press('Meta+k'); await expect.poll(() => focused('Search actions')).toBe(true);
  await page.keyboard.press('Backspace'); await expect.poll(() => focused('Copy & Open')).toBe(true);
  await page.keyboard.press('Backspace'); await expect.poll(() => focused('Set Up')).toBe(true);
  await page.keyboard.press('Backspace'); await expect.poll(() => focused('Search commands, tabs, bookmarks, and history')).toBe(true);
  await openCommand('local storage', 'View Local Storage');
  await expect.poll(() => focused('Search storage keys')).toBe(true);
  await expect.poll(async () => (await ax()).some(node => node.role?.value === 'option')).toBe(true);
  await page.keyboard.press('Meta+k'); await expect.poll(() => focused('Search actions')).toBe(true);
  await page.keyboard.type('details'); await page.keyboard.press('Enter');
  await expect.poll(async () => (await ax()).some(node => node.name?.value === 'JSON preview · copies original value')).toBe(true);
  await page.keyboard.press('Meta+k'); await expect.poll(() => focused('Search actions')).toBe(true);
  await page.keyboard.press('Backspace');
  await expect.poll(async () => (await ax()).some(node => node.name?.value === 'JSON preview · copies original value')).toBe(true);
  await page.keyboard.press('Backspace'); await expect.poll(() => focused('Search storage keys')).toBe(true);
  await page.keyboard.press('Backspace'); await expect.poll(() => focused('Search commands, tabs, bookmarks, and history')).toBe(true);
  await page.keyboard.press('Meta+a'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
  await expect.poll(() => focused('Search commands, tabs, bookmarks, and history')).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
});
});

for (const method of ['mouse', 'keyboard'] as const) {
  test.describe(() => {
    test.use({ environment: { ...defaults, locale: 'en-US', commands: true, pageAccess: true, shadow: method === 'mouse' ? 'open' : 'closed' } });
    test(`English reload justonehop extension via ${method} preserves pages and reopens the palette`, async () => {
      const page = await context.newPage();
      await page.goto('chrome://extensions');
      const developerMode = page.getByRole('switch', { name: 'Developer mode', exact: true });
      await developerMode.setChecked(true);
      await expect(developerMode).toBeChecked();
      await page.goto(`${origin}/Reload-extension-fixture`);
      await page.getByRole('textbox', { name: 'Page input' }).fill('keep this text');
      await worker.evaluate(() => chrome.storage.local.set({ reloadFixture: 'kept' }));
      const launch = async () => {
        await page.bringToFront();
        await worker.evaluate(async () => {
          const scope = globalThis as typeof globalThis & { __recentCommands: ((command: string) => Promise<void>)[] };
          for (const callback of scope.__recentCommands) await callback('toggle-palette');
        });
        await expect(page.locator('#justonehop-command-palette')).toBeAttached();
      };
      await launch();
      await page.keyboard.type(method === 'mouse' ? 'JustOneHop: Reload' : 'JustOneHop：重新加载');
      const nextWorker = context.waitForEvent('serviceworker', candidate => candidate.url() === worker.url());
      const oldWorker = worker;
      const stopped = oldWorker.waitForEvent('close');
      if (method === 'mouse') {
        const frame = page.frameLocator('.justonehop-frame');
        await expect(frame.getByRole('option').first().locator('.entry-title')).toHaveText('JustOneHop: Reload');
        await frame.getByRole('option').first().click();
      } else {
        await page.keyboard.press('Shift+Enter');
        await expect(page.locator('#justonehop-command-palette')).toBeAttached();
        await page.keyboard.press('Enter');
      }
      await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
      await stopped;
      setWorker(await nextWorker);
      await expect(page.getByRole('textbox', { name: 'Page input' })).toHaveValue('keep this text');
      await expect(page.getByRole('textbox', { name: 'Page input' })).toBeFocused();
      expect(await worker.evaluate(async () => (await chrome.storage.local.get('reloadFixture')).reloadFixture)).toBe('kept');
      await expect.poll(() => ui.isClosed()).toBe(true);
      await launch();
      if (method === 'mouse') await expect(page.frameLocator('.justonehop-frame').getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' })).toBeFocused();
      await page.keyboard.type('settings');
      if (method === 'mouse') {
        const frame = page.frameLocator('.justonehop-frame');
        await expect(frame.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' })).toHaveValue('settings');
        await expect(frame.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
        await expect(frame.locator('[id="justonehop-command:settings"]')).toHaveAttribute('aria-selected', 'true');
      }
      await page.keyboard.press('Enter');
      if (method === 'mouse') await expect(page.frameLocator('.justonehop-frame').getByRole('textbox', { name: 'Search settings' })).toBeFocused();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
    });
  });
}

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English palette launch worker lifecycle repeatedly wakes and reloads without script load errors', async () => {
  test.setTimeout(90_000);
  const monitor = await context.newPage(); await monitor.goto('chrome://extensions');
  const developerMode = monitor.getByRole('switch', { name: 'Developer mode', exact: true });
  await expect(developerMode).toBeVisible();
  await developerMode.setChecked(true);
  await expect(developerMode).toBeChecked();
  await monitor.goto(origin);
  const client = await context.newCDPSession(monitor);
  const errors: unknown[] = [];
  const workerUrl = popupUrl.replace('popup.html', 'background.js');
  const versions = new Map<string, { versionId: string; scriptURL: string; runningStatus: string; status: string }>();
  const events: { event: string; atMs: number }[] = [];
  const started = performance.now();
  const record = (event: string) => events.push({ event, atMs: Math.round(performance.now() - started) });
  context.on('close', () => record('context closed'));
  context.browser()?.on('disconnected', () => record('browser disconnected'));
  const watchPage = (page: Page) => {
    page.on('close', () => record('extension page closed'));
    page.on('crash', () => record('extension page crashed'));
  };
  watchPage(ui);
  client.on('ServiceWorker.workerErrorReported', event => errors.push(event.errorMessage));
  client.on('ServiceWorker.workerVersionUpdated', event => {
    for (const version of event.versions) if (version.scriptURL === workerUrl) {
      versions.set(version.versionId, version);
      record(`worker ${version.versionId}: ${version.runningStatus}`);
    }
  });
  await client.send('ServiceWorker.enable');
  const timings: { round: number; phase: string; ms: number }[] = [];
  let phase = 'ready', round = 0;
  let stops = 0, wakes = 0, reloads = 0;
  let completed = false;
  const timed = async <T,>(name: string, operation: () => Promise<T>): Promise<T> => {
    phase = name;
    const start = performance.now();
    try { return await operation(); }
    finally { timings.push({ round, phase: name, ms: Math.round(performance.now() - start) }); }
  };
  try {
    for (round = 0; round < 100; round++) {
      // Stop only this extension, and observe the stopped state before sending
      // the wake message; a global CDP stop can hang without identifying a target.
      await timed('stop', async () => {
        await expect.poll(() => [...versions.values()].some(version => version.status === 'activated' && version.runningStatus === 'running')).toBe(true);
        const version = [...versions.values()].find(version => version.status === 'activated' && version.runningStatus === 'running')!;
        // Subscribe before stopping so a short stopped state cannot be missed.
        // Event delivery avoids paying a polling interval on every stress cycle.
        let onVersion: (event: { versions: { versionId: string; runningStatus: string }[] }) => void;
        let timer: ReturnType<typeof setTimeout>;
        const stopped = new Promise<void>((resolve, reject) => {
          onVersion = event => {
            if (event.versions.some(item => item.versionId === version.versionId && item.runningStatus === 'stopped')) resolve();
          };
          client.on('ServiceWorker.workerVersionUpdated', onVersion);
          timer = setTimeout(() => reject(new Error(`Worker ${version.versionId} did not stop in round ${round}`)), 5000);
        });
        try {
          await Promise.all([client.send('ServiceWorker.stopWorker', { versionId: version.versionId }), stopped]);
          stops++;
        } finally {
          clearTimeout(timer!);
          client.off('ServiceWorker.workerVersionUpdated', onVersion!);
        }
      });
      const reply = await timed('wake', () => ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'snapshot' })));
      expect(reply.ok, `wake ${round}: ${JSON.stringify(errors)}`).toBe(true);
      await expect.poll(() => [...versions.values()].some(version => version.status === 'activated' && version.runningStatus === 'running')).toBe(true);
      wakes++;
      if (round % 5 === 4) {
        // runtime.reload() can return before the old extension page is torn down.
        // Do not start the next cycle against that still-unloading extension.
        await timed('reload', async () => {
          const previousUi = ui;
          await Promise.all([
            previousUi.waitForEvent('close', { timeout: 5000 }),
            previousUi.evaluate(() => chrome.runtime.reload()).catch(error => {
              if (!previousUi.isClosed()) throw error;
            }),
          ]);
          setUI(await context.newPage());
          watchPage(ui);
          await expect.poll(async () => {
            try { await ui.goto(popupUrl); return await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'snapshot' })).then(reply => reply.ok); }
            catch { return false; }
          }, { message: JSON.stringify(errors) }).toBe(true);
          reloads++;
        });
      }
    }
    expect({ stops, wakes, reloads }).toEqual({ stops: 100, wakes: 100, reloads: 20 });
    expect(errors).toEqual([]);
    completed = true;
  } finally {
    test.info().annotations.push({ type: 'worker-lifecycle-timing', description: JSON.stringify({
      stops, wakes, reloads, round, phase, loopMs: Math.round(performance.now() - started),
    }) });
    const diagnosticPath = test.info().outputPath('worker-lifecycle.json');
    await writeFile(diagnosticPath, JSON.stringify({ timings, events, versions: [...versions.values()], errors }, null, 2));
    await test.info().attach('worker-lifecycle', { path: diagnosticPath, contentType: 'application/json' });
    try { await client.detach(); }
    catch (error) {
      if (completed) throw error;
      test.info().annotations.push({ type: 'worker-cleanup-error', description: String(error) });
    }
  }
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English palette preserves query and settings while hidden but closes on a source tab switch', async () => {
    const page = await context.newPage(); await page.goto(`${origin}/App-switch-retention`); await page.bringToFront();
    const id = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, page.url());
    await worker.evaluate(async () => {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    });
    const surface = page.frameLocator('.justonehop-frame');
    const search = surface.getByRole('combobox');
    await expect(search).toBeFocused();
    await page.keyboard.type('settings');
    await expect(surface.getByRole('option').first().locator('.entry-title')).toHaveText('JustOneHop Settings');
    await expect(search).toHaveAttribute('aria-activedescendant', 'justonehop-command:settings');
    await page.keyboard.press('Enter');
    const settings = surface.getByRole('textbox', { name: 'Search settings' });
    await settings.fill('theme');
    // Inject the OS visibility signal in the content-script world; this proves
    // retention on occlusion, not a physical macOS application-switch gesture.
    await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    } }), id);
    await expect(settings).toHaveValue('theme');
    await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
      Reflect.deleteProperty(document, 'hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    } }), id);
    await surface.locator('.footer-back').click();
    await expect(search).toHaveValue('settings');
    await expect(search).toBeFocused();
    await worker.evaluate(async () => { await chrome.tabs.create({ url: 'about:blank', active: true }); });
    await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
    await page.bringToFront();
    await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
  });
  test('English palette keeps an unfocused overlay and offers click recovery', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Focus-boundary`);
  const id = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, page.url());
  await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }), id);
  // Headless Chrome emulates tab focus, so inject the observed native failure
  // at the isolated-world boundary. Native omnibox acceptance is separate.
  await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false });
  } }), id);
  await worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  const surface = page.frameLocator('.justonehop-frame');
  await expect(page.locator('#justonehop-command-palette')).toBeAttached();
  await expect(surface.locator('.search-focus-hint')).toHaveText('Click the search field to type');
  expect(context.pages().some(candidate => candidate.url().includes('popup.html#window='))).toBe(false);
  expect(await worker.evaluate(tabId => chrome.action.getPopup({ tabId }), id)).toBe('');
  const search = surface.getByRole('combobox');
  await search.evaluate(node => { node.ownerDocument.body.tabIndex = -1; node.ownerDocument.body.focus(); });
  await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
    Reflect.deleteProperty(document, 'hasFocus');
  } }), id);
  await surface.getByRole('button', { name: 'Focus search', exact: true }).click();
  await expect(search).toBeFocused();
  await expect(surface.locator('.search-focus-hint')).toHaveCount(0);
  await page.keyboard.type('settings');
  await expect(search).toHaveValue('settings');
  await page.keyboard.press('Escape');
  await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
});
});

test.describe('headed', { tag: '@headed' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true, headed: true, pageAccess: true } });
  test('English palette restricted fallback opens a source-bound window without toolbar popup', async () => {
    const page = await context.newPage();
    await page.goto('data:text/html,<title>Restricted source</title>');
    await page.bringToFront();
    const source = await worker.evaluate(async url => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
      await chrome.windows.update(tab.windowId, { focused: true });
      return { id: tab.id!, windowId: tab.windowId };
    }, page.url());
    await worker.evaluate(async () => {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    });
    await expect.poll(() => context.pages().some(page => page.url().includes('popup.html#window='))).toBe(true);
    const palette = context.pages().find(page => page.url().includes('popup.html#window='))!;
    const search = palette.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await expect(search).toBeFocused();
    expect(await worker.evaluate(tabId => chrome.action.getPopup({ tabId }), source.id)).toBe('');
    const bound = await palette.evaluate(async () => {
      const reply = await chrome.runtime.sendMessage({ source: 'justonehop', type: 'snapshot' });
      return { source: reply.data.currentTabId, window: reply.data.windowId, host: (await chrome.tabs.getCurrent())!.windowId };
    });
    expect(bound).toMatchObject({ source: source.id, window: source.windowId });
    expect(bound.host).not.toBe(source.windowId);
    await palette.locator('.settings-button').click();
    await expect(palette.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
    await palette.keyboard.press('Escape');
    await expect(search).toBeFocused();
    await search.fill('pin');
    await expect(palette.locator('[id="justonehop-command:pin"]')).toHaveAttribute('aria-selected', 'true');
    await expect(palette.locator('.palette-footer .primary-action')).toBeEnabled();
    await search.press('Enter');
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).pinned, source.id)).toBe(true);
    await expect(search).toHaveValue('pin');
    await palette.keyboard.press('Escape').catch(error => { if (!palette.isClosed()) throw error; });
    await expect.poll(() => palette.isClosed()).toBe(true);
    expect(await worker.evaluate(tabId => chrome.action.getPopup({ tabId }), source.id)).toBe('');
  });
});

for (const host of ['overlay', 'native'] as const) test.describe('headed', { tag: '@headed' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true, headed: true, pageAccess: true, shadow: 'open' } });
  test(`English manual search focus recovers from body and controls in ${host}`, async () => {
    const source = await context.newPage();
    await source.goto(host === 'overlay' ? `${origin}/Manual-focus-source` : 'chrome://version/');
    await source.bringToFront();
    // Bringing a page forward does not establish native window focus on macOS.
    const sourceTab = await worker.evaluate(async url => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
      await chrome.windows.update(tab.windowId, { focused: true });
      return { tabId: tab.id!, windowId: tab.windowId };
    }, source.url());
    await expect.poll(() => worker.evaluate(async ({ tabId, windowId }) => {
      const tab = await chrome.tabs.get(tabId);
      return tab.status === 'complete' && tab.active && (await chrome.windows.get(windowId)).focused;
    }, sourceTab)).toBe(true);
    await worker.evaluate(async () => {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    });
    if (host === 'native') await expect.poll(() => context.pages().some(page => page.url().includes('popup.html#window='))).toBe(true);
    const page = host === 'native' ? context.pages().find(page => page.url().includes('popup.html#window='))! : source;
    const surface = host === 'native' ? page : page.frameLocator('.justonehop-frame');
    const input = surface.locator('.search-bar input');
    await expect(input).toBeFocused();
    await input.fill('new tab');
    await expect(surface.locator('[id="justonehop-command:newTab"]')).toHaveAttribute('aria-selected', 'true');
    await input.evaluate((node: HTMLInputElement) => {
      node.setSelectionRange(1, 4);
      node.ownerDocument.body.tabIndex = -1; node.ownerDocument.body.focus();
    });
    await expect(input).not.toBeFocused();
    await expect(surface.locator('.search-focus-hint')).toHaveText('Press Tab to focus search');
    const expectCenteredHint = async () => {
      const geometry = await surface.locator('.search-focus-hint').evaluate(node => {
        const hint = node.getBoundingClientRect();
        const input = node.parentElement!.querySelector('input')!.getBoundingClientRect();
        const clear = node.parentElement!.querySelector('.search-clear')?.getBoundingClientRect();
        return { offset: Math.abs(hint.top + hint.height / 2 - input.top - input.height / 2), clearGap: clear ? clear.left - hint.right : null };
      });
      expect(geometry.offset).toBeLessThan(2);
      if (geometry.clearGap !== null) expect(geometry.clearGap).toBeGreaterThanOrEqual(4);
    };
    await expectCenteredHint();
    expect(await input.evaluate(node => ['Meta', 'Control'].map(modifier => {
      const view = node.ownerDocument.defaultView!;
      const event = new view.KeyboardEvent('keydown', { key: 'f', metaKey: modifier === 'Meta', ctrlKey: modifier === 'Control', bubbles: true, cancelable: true });
      node.ownerDocument.body.dispatchEvent(event);
      return event.defaultPrevented;
    }))).toEqual([false, false]);
    await page.keyboard.press('Tab');
    await expect(surface.locator('.search-focus-hint')).toHaveCount(0);
    await expect(input).toBeFocused();
    expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
    await surface.locator('.settings-button').focus();
    await surface.getByRole('button', { name: 'Focus search', exact: true }).click();
    await expect(input).toBeFocused(); await expect(input).toHaveValue('new tab');
    expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
    await input.press('Meta+k');
    const menu = surface.getByRole('combobox', { name: 'Search actions', exact: true });
    await expect(menu).toBeFocused();
    const menuButton = surface.locator('.action-menu [data-focus-search]');
    await menuButton.focus(); await page.keyboard.press('Enter');
    await expect(menu).toBeFocused();
    await menu.evaluate(node => node.ownerDocument.body.focus());
    await expect(surface.locator('.action-menu .search-focus-hint')).toBeVisible();
    await expectCenteredHint();
    await page.keyboard.press('Tab');
    await expect(menu).toBeFocused();
    await expect(surface.locator('.action-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(input).toHaveValue('new tab');
    await surface.locator('.settings-button').click();
    const settingsInput = surface.getByRole('textbox', { name: 'Search settings', exact: true });
    await expect(settingsInput).toBeVisible();
    await settingsInput.fill('theme');
    await settingsInput.evaluate(node => node.ownerDocument.body.focus());
    await expect(surface.locator('.search-focus-hint')).toBeVisible();
    await expectCenteredHint();
    await page.screenshot({ path: test.info().outputPath(`search-focus-hint-${host}.png`) });
    await page.keyboard.press('Tab');
    await expect(settingsInput).toBeFocused(); await expect(settingsInput).toHaveValue('theme');
    await page.keyboard.press('Shift+Tab');
    await expect(surface.getByRole('button', { name: 'Focus search', exact: true })).toBeFocused();
    await expect(surface.locator('.search-focus-hint')).toHaveCount(0);
    await page.keyboard.press('Tab'); await expect(settingsInput).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(input).toHaveValue('new tab');
    await page.keyboard.press('Escape').catch(error => { if (!page.isClosed()) throw error; });
  });
});

for (const layer of ['root', 'group'] as const) test.describe('headed', { tag: '@headed' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true, headed: true } });
  test(`English source close overlay ${layer} keeps other-tab management open then closes without a new window`, async () => {
    const sourcePage = await context.newPage();
    await sourcePage.goto(`${origin}/SourceClose-member-source`);
    const seeded = await worker.evaluate(async ({ origin, grouped }) => {
      const source = (await chrome.tabs.query({})).find(tab => tab.url === `${origin}/SourceClose-member-source`)!;
      // A native successor must not trigger an automatic standalone panel.
      const successor = await chrome.tabs.create({ windowId: source.windowId, index: source.index + 1, url: 'chrome://version/', active: false });
      // Chrome returns to the opener when the source closes.
      await chrome.tabs.update(source.id!, { openerTabId: successor.id! });
      const another = await chrome.tabs.create({ windowId: source.windowId, index: source.index + 2, url: `${origin}/SourceClose-member-another`, active: false });
      const last = await chrome.tabs.create({ windowId: source.windowId, index: source.index + 3, url: `${origin}/SourceClose-member-last`, active: false });
      const groupId = grouped ? await chrome.tabs.group({ tabIds: [source.id!, successor.id!, another.id!, last.id!] }) : undefined;
      if (groupId !== undefined) await chrome.tabGroups.update(groupId, { title: 'SourceClose Research', color: 'blue', collapsed: false });
      return { source: source.id!, windowId: source.windowId, successor: successor.id!, another: another.id!, last: last.id!, groupId };
    }, { origin, grouped: layer === 'group' });
    for (const id of [seeded.successor, seeded.another, seeded.last]) {
      await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).status, id)).toBe('complete');
    }
    await sourcePage.bringToFront();
    await expect.poll(() => sourcePage.evaluate(() => document.hasFocus())).toBe(true);
    await worker.evaluate(async () => {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    });
    const surface = sourcePage.frameLocator('.justonehop-frame');
    const root = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await expect(root).toBeFocused();
    await worker.evaluate(() => {
      const created: number[] = [];
      (globalThis as unknown as { __sourceCloseWindows: number[] }).__sourceCloseWindows = created;
      chrome.windows.onCreated.addListener(window => created.push(window.id!));
    });
    if (layer === 'group') {
      await root.fill('SourceClose Research');
      await surface.getByRole('option').filter({ hasText: 'Tab Group: SourceClose Research' }).click();
    }
    const input = layer === 'root' ? root : surface.getByRole('combobox', { name: 'Search tabs in this group…' });
    const query = layer === 'root' ? 'SourceClose member' : 'member';
    await input.fill(query);
    await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
    await surface.locator(`[id="${layer === 'root' ? 'justonehop' : 'group'}-tab:${seeded.another}"]`).click({ button: 'right' });
    await surface.locator(layer === 'root' ? '[id="justonehop-actions-action:close"]' : '#group-actions-close').click();
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(tab => tab.id === id), seeded.another)).toBe(false);
    await expect(input).toHaveValue(query); await expect(input).toBeFocused();
    expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
    await expect(surface.locator('.action-menu')).toHaveCount(0);
    await expect(sourcePage.locator('#justonehop-command-palette')).toBeAttached();
    expect(await worker.evaluate(id => chrome.tabs.get(id), seeded.source)).toMatchObject({ active: true });
    if (layer === 'root') {
      await input.fill('close tab');
      await expect(surface.locator('#justonehop-results [aria-selected="true"]')).toHaveAttribute('id', 'justonehop-command:close');
      await surface.locator('.palette-footer .primary-action').click().catch(error => { if (!sourcePage.isClosed()) throw error; });
    } else {
      await surface.locator(`[id="group-tab:${seeded.source}"]`).click({ button: 'right' });
      await surface.locator('#group-actions-close').click().catch(error => { if (!sourcePage.isClosed()) throw error; });
    }
    await expect.poll(() => sourcePage.isClosed()).toBe(true);
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(tab => tab.id === id), seeded.source)).toBe(false);
    await expect.poll(() => worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0]?.id, seeded.windowId)).toBe(seeded.successor);
    expect(await worker.evaluate(id => chrome.tabs.get(id), seeded.last)).toMatchObject({ windowId: seeded.windowId });
    expect(context.pages().filter(page => page.url().includes('popup.html#window='))).toHaveLength(0);
    expect(await worker.evaluate(() => (globalThis as unknown as { __sourceCloseWindows: number[] }).__sourceCloseWindows)).toEqual([]);
    expect(await worker.evaluate(() => chrome.storage.session.get('justonehopPaletteWindow'))).toEqual({});
  });
});

test.describe('headed', { tag: '@headed' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true, headed: true } });
  test('English source close native bound tab closes its panel without rebinding or creating a window', async () => {
    const successor = await worker.evaluate(async () => {
      const tab = await chrome.tabs.create({ url: 'chrome://downloads/', active: false });
      return tab.id!;
    });
    // This page is only the native successor; background WebUI load completion
    // is not required to close the source and observe Chrome's tab activation.
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).url, successor)).toBe('chrome://downloads/');
    const { source, palette } = await openNativePalette();
    const input = palette.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    const bound = await palette.evaluate(async () => {
      const reply = await chrome.runtime.sendMessage({ source: 'justonehop', type: 'snapshot' });
      return { currentTabId: reply.data.currentTabId, panelTabId: (await chrome.tabs.getCurrent())!.id };
    });
    expect(bound.currentTabId).toBe(source.tabId);
    expect(bound.panelTabId).not.toBe(source.tabId);
    await worker.evaluate(() => {
      const created: number[] = [];
      (globalThis as unknown as { __sourceCloseWindows: number[] }).__sourceCloseWindows = created;
      chrome.windows.onCreated.addListener(window => created.push(window.id!));
    });
    await input.fill('close tab');
    await expect(palette.locator('#justonehop-results [aria-selected="true"]')).toHaveAttribute('id', 'justonehop-command:close');
    await input.press('Enter').catch(error => { if (!palette.isClosed()) throw error; });
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(tab => tab.id === id), source.tabId)).toBe(false);
    await expect.poll(() => palette.isClosed()).toBe(true);
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).active, successor)).toBe(true);
    await expect.poll(() => worker.evaluate(() => chrome.storage.session.get('justonehopPaletteWindow'))).toEqual({});
    expect(context.pages().filter(page => page.url().includes('popup.html#window='))).toHaveLength(0);
    expect(await worker.evaluate(() => (globalThis as unknown as { __sourceCloseWindows: number[] }).__sourceCloseWindows)).toEqual([]);
    expect(ui.isClosed()).toBe(false);
  });

  test('English keep-open native other-tab close retains its binding and mouse Pin and Mute accept subsequent Enter', async () => {
    const other = await worker.evaluate(async () => (await chrome.tabs.create({ url: 'chrome://downloads/', active: false })).id!);
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).url, other)).toBe('chrome://downloads/');
    const { source, palette } = await openNativePalette();
    const input = palette.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await input.fill('chrome://downloads');
    await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 7));
    await palette.locator(`[id="justonehop-tab:${other}"]`).click({ button: 'right' });
    await palette.locator('[id="justonehop-actions-action:close"]').click();
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(tab => tab.id === id), other)).toBe(false);
    await expect(input).toHaveValue('chrome://downloads'); await expect(input).toBeFocused();
    expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 7]);
    expect(context.pages().filter(page => page.url().includes('popup.html#window='))).toEqual([palette]);
    expect(await palette.evaluate(async () => (await chrome.runtime.sendMessage({ source: 'justonehop', type: 'snapshot' })).data.currentTabId)).toBe(source.tabId);
    expect(await worker.evaluate(id => chrome.tabs.get(id), source.tabId)).toMatchObject({ active: true, pinned: false });
    for (const action of ['pin', 'mute'] as const) {
      await input.fill(action);
      const row = palette.locator(`[id="justonehop-command:${action}"]`);
      await row.click();
      const state = () => worker.evaluate(async ({ id, action }) => {
        const tab = await chrome.tabs.get(id); return action === 'pin' ? tab.pinned : tab.mutedInfo?.muted;
      }, { id: source.tabId, action });
      await expect.poll(state).toBe(true);
      await expect(row).toHaveAttribute('aria-selected', 'true');
      await expect(row.locator('.entry-title')).toContainText(action === 'pin' ? 'Unpin Tab' : 'Unmute Tab');
      await expect(palette.locator('.palette-footer .primary-action')).toBeEnabled();
      await expect(input).toBeFocused(); await expect(input).toHaveValue(action);
      await input.press('Enter');
      await expect.poll(state).toBe(false);
      await expect(row).toHaveAttribute('aria-selected', 'true');
      await expect(input).toBeFocused();
    }
  });

  test('English keep-open native external source close cancels only its own panel', async () => {
    const other = await worker.evaluate(async origin => {
      const window = await chrome.windows.create({ url: `${origin}/External-close-unrelated`, focused: false });
      return { windowId: window!.id!, tabId: window!.tabs![0].id! };
    }, origin);
    await ui.bringToFront();
    const { source, palette } = await openNativePalette();
    await palette.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' }).fill('close tab');
    await worker.evaluate(id => chrome.tabs.remove(id), source.tabId);
    await expect.poll(() => palette.isClosed()).toBe(true);
    await expect.poll(() => context.pages().filter(page => page.url().includes('popup.html#window=')).length).toBe(0);
    expect(ui.isClosed()).toBe(false);
    expect(await worker.evaluate(id => chrome.tabs.get(id), other.tabId)).toMatchObject({ windowId: other.windowId, url: `${origin}/External-close-unrelated` });
    expect((await worker.evaluate(id => chrome.windows.get(id), source.windowId)).type).toBe('normal');
  });
});

test.describe('headed', { tag: '@headed' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true, headed: true } });
  test('English source close delayed removal still completes after Escape without reopening a panel', async () => {
    const page = await context.newPage(); await page.goto(`${origin}/Cancelled-continuation-source`);
    const seeded = await worker.evaluate(async origin => {
      const source = (await chrome.tabs.query({})).find(tab => tab.url === `${origin}/Cancelled-continuation-source`)!;
      const successor = await chrome.tabs.create({ windowId: source.windowId, index: source.index + 1, url: 'chrome://version/', active: false });
      // Chrome returns to the opener when the source closes.
      await chrome.tabs.update(source.id!, { openerTabId: successor.id! });
      return { source: source.id!, successor: successor.id!, windowId: source.windowId };
    }, origin);
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).status, seeded.successor)).toBe('complete');
    await page.bringToFront();
    await worker.evaluate(async sourceId => {
      const original = chrome.tabs.remove.bind(chrome.tabs);
      const state = { release: undefined as (() => void) | undefined, settled: false, popups: [] as number[] };
      (globalThis as unknown as { __cancelledClose: typeof state }).__cancelledClose = state;
      chrome.windows.onCreated.addListener(window => { if (window.type === 'popup') state.popups.push(window.id!); });
      chrome.tabs.remove = (async (ids: number | number[]) => {
        const removesSource = (Array.isArray(ids) ? ids : [ids]).includes(sourceId);
        if (removesSource) await new Promise<void>(resolve => { state.release = resolve; });
        const result = await original(Array.isArray(ids) ? ids : [ids]);
        if (removesSource) state.settled = true;
        return result;
      }) as typeof chrome.tabs.remove;
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    }, seeded.source);
    const input = page.frameLocator('.justonehop-frame').getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await expect(input).toBeFocused(); await input.fill('close tab'); await input.press('Enter');
    await expect.poll(() => worker.evaluate(() => typeof (globalThis as unknown as { __cancelledClose: { release?: () => void } }).__cancelledClose.release)).toBe('function');
    await page.keyboard.press('Escape');
    await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
    expect(await worker.evaluate(async id => (await chrome.tabs.get(id)).active, seeded.source)).toBe(true);
    await worker.evaluate(() => (globalThis as unknown as { __cancelledClose: { release: () => void } }).__cancelledClose.release());
    await expect.poll(() => page.isClosed()).toBe(true);
    await expect.poll(() => worker.evaluate(() => (globalThis as unknown as { __cancelledClose: { settled: boolean } }).__cancelledClose.settled)).toBe(true);
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).active, seeded.successor)).toBe(true);
    expect(context.pages().filter(page => page.url().includes('popup.html#window='))).toHaveLength(0);
    expect(await worker.evaluate(() => (globalThis as unknown as { __cancelledClose: { popups: number[] } }).__cancelledClose.popups)).toEqual([]);
    expect(await worker.evaluate(() => chrome.storage.session.get('justonehopPaletteWindow'))).toEqual({});
    // Only an explicit new command may open a panel on the successor.
    await worker.evaluate(async () => {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    });
    await expect.poll(() => context.pages().filter(page => page.url().includes('popup.html#window=')).length).toBe(1);
    const reopened = context.pages().find(page => page.url().includes('popup.html#window='))!;
    await expect(reopened.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' })).toHaveValue('');
    await expect(reopened.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' })).toBeFocused();
    expect(await worker.evaluate(() => (globalThis as unknown as { __cancelledClose: { popups: number[] } }).__cancelledClose.popups)).toHaveLength(1);
    expect(await worker.evaluate(async () => (await chrome.storage.session.get<{ justonehopPaletteWindow: { sourceTabId: number } }>('justonehopPaletteWindow')).justonehopPaletteWindow.sourceTabId)).toBe(seeded.successor);
  });
});

test.describe('headed', { tag: '@headed' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true, headed: true } });
  test('English wheel back returns and closes the native palette', async () => {
    const { palette, source } = await openNativePalette();
    const search = palette.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await search.fill('settings'); await search.press('Enter');
    await expect(palette.getByRole('textbox', { name: 'Search settings' })).toBeFocused();
    await palette.locator('.palette-footer-title').hover(); await palette.mouse.wheel(-140, 0);
    await expect(search).toBeFocused(); await expect(search).toHaveValue('settings');
    await palette.waitForTimeout(300);
    await palette.locator('.palette-footer-title').hover(); await palette.mouse.wheel(-140, 0);
    await expect.poll(() => palette.isClosed()).toBe(true);
    expect((await worker.evaluate(id => chrome.tabs.get(id), source.tabId)).url).toBe('chrome://version/');
  });
  test('English palette launch native window closes on Escape shortcut and focus loss', async () => {
  let opened = await openNativePalette();
  await opened.palette.keyboard.press('Escape').catch(error => { if (!opened.palette.isClosed()) throw error; });
  await expect.poll(() => opened.palette.isClosed()).toBe(true);
  opened = await openNativePalette();
  await worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  await expect.poll(() => opened.palette.isClosed()).toBe(true);
  opened = await openNativePalette();
  await worker.evaluate(id => chrome.windows.update(id, { focused: true }), opened.source.windowId);
  await expect.poll(() => opened.palette.isClosed()).toBe(true);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English Undo Tuck restores keyboard focus after a command keeps the palette open', async () => {
  const target = await worker.evaluate(async origin => {
    const tab = await chrome.tabs.create({ url: `${origin}/Undo-focus`, active: false });
    return { tabId: tab.id!, windowId: tab.windowId };
  }, origin);
  expect(await ui.evaluate(payload => chrome.runtime.sendMessage({ source: 'justonehop', type: 'execute', payload }), { action: 'tuck', ...target })).toMatchObject({ ok: true });
  const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await input.fill('undo tuck');
  await expect(ui.locator('[id="justonehop-command:undoTuck"]')).toBeVisible();
  await expect(ui.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
  await input.press('Meta+ArrowUp');
  await expect(ui.locator('[id="justonehop-command:undoTuck"]')).toHaveAttribute('aria-selected', 'true');
  await input.press('Enter');
  await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).groupId, target.tabId)).toBe(-1);
  await expect(input).toBeEnabled();
  await expect(input).toBeFocused();
  await ui.keyboard.press('Meta+a'); await ui.keyboard.type('settings');
  await expect(input).toHaveValue('settings');
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English palette launch storage overlay Undo Tuck restores typing after footer and menu actions', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Undo-overlay-host`);
  const target = await worker.evaluate(async origin => {
    const tab = await chrome.tabs.create({ url: `${origin}/Undo-overlay-target`, active: false });
    return { tabId: tab.id!, windowId: tab.windowId };
  }, origin);
  await worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  const surface = page.frameLocator('.justonehop-frame');
  const input = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  for (const menu of [false, true]) {
    expect(await ui.evaluate(payload => chrome.runtime.sendMessage({ source: 'justonehop', type: 'execute', payload }), { action: 'tuck', ...target })).toMatchObject({ ok: true });
    await input.fill('undo tuck');
    await expect(surface.locator('[id="justonehop-command:undoTuck"]')).toBeVisible();
    await expect(surface.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
    await input.press('Meta+ArrowUp');
    await expect(surface.locator('[id="justonehop-command:undoTuck"]')).toHaveAttribute('aria-selected', 'true');
    if (menu) { await input.press('Meta+k'); await page.keyboard.press('Enter'); }
    else await surface.locator('.palette-footer .primary-action').click();
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).groupId, target.tabId)).toBe(-1);
    await expect(input).toBeFocused();
    await page.keyboard.press('Meta+a'); await page.keyboard.type('settings');
    await expect(input).toHaveValue('settings');
    await page.keyboard.press('Control+n');
    await expect(input).toBeFocused();
  }
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });

  async function seedManagementTabs(groupTitle?: string) {
    const seeded = await worker.evaluate(async ({ origin, groupTitle }) => {
      const first = await chrome.tabs.create({ url: `${origin}/Batch-fixture-Alpha`, active: false });
      const ids: [number, ...number[]] = [first.id!];
      for (const suffix of ['Beta', 'Gamma', 'Delta']) {
        const tab = await chrome.tabs.create({ url: `${origin}/Batch-fixture-${suffix}`, active: false });
        ids.push(tab.id!);
      }
      const groupId = groupTitle ? await chrome.tabs.group({ tabIds: ids }) : undefined;
      if (groupId !== undefined) await chrome.tabGroups.update(groupId, { title: groupTitle, color: 'blue' });
      return { ids, groupId };
    }, { origin, groupTitle });
    for (const id of seeded.ids) await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).status, id)).toBe('complete');
    await ui.reload();
    return seeded;
  }

  async function holdExecution() {
    await ui.evaluate(() => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      const state = { calls: 0, changes: 0, release: undefined as (() => void) | undefined };
      (globalThis as unknown as { __heldExecution: typeof state }).__heldExecution = state;
      const port = chrome.runtime.connect({ name: 'justonehop' });
      port.onMessage.addListener(message => { if (message.source === 'justonehop' && message.type === 'changed') state.changes++; });
      chrome.runtime.sendMessage = (async (request: { type?: string }) => {
        if (request.type === 'execute') {
          state.calls++;
          await new Promise<void>(resolve => { state.release = resolve; });
        }
        return original(request);
      }) as typeof chrome.runtime.sendMessage;
    });
  }
  const heldExecution = () => ui.evaluate(() => {
    const state = (globalThis as unknown as { __heldExecution: { calls: number; changes: number; release?: () => void } }).__heldExecution;
    return { calls: state.calls, changes: state.changes, held: !!state.release };
  });
  const releaseExecution = () => ui.evaluate(() => (globalThis as unknown as { __heldExecution: { release: () => void } }).__heldExecution.release());

  test('English keep-open failed mutation refreshes changes received while execution was pending', async () => {
    await seedManagementTabs();
    const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await input.fill('Batch fixture');
    const rows = ui.locator('#justonehop-results .result.tab');
    await expect(rows).toHaveCount(4);
    const order = await rows.evaluateAll(nodes => nodes.map(node => node.id));
    const target = Number(order[1].split(':')[1]);
    await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 7));
    await ui.clock.install(); await ui.clock.pauseAt(new Date());
    await holdExecution();
    await ui.locator(`[id="${order[1]}"]`).click({ button: 'right' });
    await ui.locator('[id="justonehop-actions-action:close"]').click();
    await expect.poll(heldExecution).toMatchObject({ calls: 1, held: true });
    const changes = (await heldExecution()).changes;
    await worker.evaluate(id => chrome.tabs.remove(id), target);
    await expect.poll(async () => (await heldExecution()).changes).toBeGreaterThan(changes);
    await ui.clock.runFor(150);
    await releaseExecution();
    await expect(ui.getByRole('alert')).toBeVisible();
    await expect(rows).toHaveCount(3);
    await expect(ui.locator(`[id="${order[1]}"]`)).toHaveCount(0);
    await expect(ui.getByRole('dialog')).toHaveCount(0);
    await expect(ui.locator('#justonehop-results [aria-selected="true"]')).toHaveAttribute('id', order[2]);
    await expect(input).toHaveValue('Batch fixture');
    await expect(input).toBeFocused();
    expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 7]);
    await ui.keyboard.type('X'); await expect(input).toHaveValue('BaXixture');
    expect((await heldExecution()).calls).toBe(1);
  });

  test('English keep-open initial Retry cannot replace a newer snapshot with stale tab data', async () => {
    const { ids } = await seedManagementTabs();
    const target = ids[1];
    await ui.addInitScript(() => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      const state = { reads: 0, release: undefined as (() => void) | undefined };
      (globalThis as unknown as { __retrySnapshot: typeof state }).__retrySnapshot = state;
      chrome.runtime.sendMessage = (async (request: { type?: string }) => {
        if (request.type !== 'snapshot') return original(request);
        const read = ++state.reads;
        if (read === 1) return { ok: false, error: 'Initial snapshot fixture failure' };
        const response = await original(request);
        // Read the real old state now, but deliver it after a newer refresh.
        if (read === 2) await new Promise<void>(resolve => { state.release = resolve; });
        return response;
      }) as typeof chrome.runtime.sendMessage;
    });
    await ui.reload();
    await expect(ui.getByRole('alert')).toBeVisible();
    await ui.locator('.error-banner button').click();
    await expect.poll(() => ui.evaluate(() => typeof (globalThis as unknown as { __retrySnapshot: { release?: () => void } }).__retrySnapshot.release)).toBe('function');
    await worker.evaluate(id => chrome.tabs.remove(id), target);
    const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await input.fill('Batch fixture');
    await expect(ui.locator('#justonehop-results .result.tab')).toHaveCount(3);
    await expect(ui.locator(`[id="justonehop-tab:${target}"]`)).toHaveCount(0);
    await ui.evaluate(() => (globalThis as unknown as { __retrySnapshot: { release: () => void } }).__retrySnapshot.release());
    // Flush promise continuations and React's next paint before checking stale delivery.
    await ui.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(ui.locator('#justonehop-results .result.tab')).toHaveCount(3);
    await expect(ui.locator(`[id="justonehop-tab:${target}"]`)).toHaveCount(0);
    await expect(input).toHaveValue('Batch fixture');
    await expect(input).toBeFocused();
    expect(await worker.evaluate(async ids => (await chrome.tabs.query({})).filter(tab => ids.includes(tab.id!)).length, ids)).toBe(3);
  });

  test('English keep-open pending group mutation stays busy after Escape returns to root', async () => {
    const { ids } = await seedManagementTabs('Batch Research');
    const root = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await root.fill('Batch Research');
    await root.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 7));
    await ui.getByRole('option').filter({ hasText: 'Tab Group: Batch Research' }).click();
    await holdExecution();
    await ui.locator(`[id="group-tab:${ids[1]}"]`).click({ button: 'right' });
    await ui.locator('#group-actions-close').click();
    await expect.poll(heldExecution).toMatchObject({ calls: 1, held: true });
    await ui.keyboard.press('Escape'); await ui.keyboard.press('Escape');
    await expect(root).toBeVisible();
    await expect(root).toBeDisabled();
    await expect(ui.locator('.palette-footer .primary-action')).toBeDisabled();
    await expect(ui.getByRole('button', { name: 'Open action menu' })).toBeDisabled();
    await ui.keyboard.press('Enter');
    await ui.locator(`[id="justonehop-tab:${ids[2]}"]`).click();
    expect((await heldExecution()).calls).toBe(1);
    expect(await worker.evaluate(async ids => (await chrome.tabs.query({})).filter(tab => ids.includes(tab.id!)).length, ids)).toBe(4);
    await releaseExecution();
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(tab => tab.id === id), ids[1])).toBe(false);
    await expect(root).toBeEnabled(); await expect(root).toBeFocused();
    await expect(root).toHaveValue('Batch Research');
    expect(await root.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 7]);
    expect((await heldExecution()).calls).toBe(1);
    expect(await worker.evaluate(async ids => (await chrome.tabs.query({})).filter(tab => ids.includes(tab.id!)).length, ids)).toBe(3);
  });

  test('English keep-open root mouse close preserves query and selects next then previous neighbor through empty results', async () => {
    const { ids } = await seedManagementTabs();
    const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    const rows = ui.locator('#justonehop-results .result.tab');
    await input.fill('Batch fixture');
    await expect(ui.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
    await expect(rows).toHaveCount(4);
    const order = await rows.evaluateAll(nodes => nodes.map(node => node.id));
    await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 7));
    // Close a middle row, then the last row, then drain the remaining results.
    // The expected neighbors come from the visible list before each mutation.
    const remaining = [...order];
    for (const index of [1, 2, 1, 0]) {
      const target = remaining[index];
      const visibleBefore = await ui.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id));
      const selectedIndex = visibleBefore.indexOf(target);
      const neighbors = visibleBefore.filter(id => id !== target);
      const nextSelected = neighbors[Math.min(selectedIndex, neighbors.length - 1)];
      await ui.locator(`[id="${target}"]`).click({ button: 'right' });
      await ui.locator('[id="justonehop-actions-action:close"]').click();
      remaining.splice(index, 1);
      await expect(rows).toHaveCount(remaining.length);
      await expect(ui.getByRole('dialog')).toHaveCount(0);
      await expect(input).toHaveValue('Batch fixture');
      await expect(input).toBeFocused();
      expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 7]);
      await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(tab => tab.id === id), Number(target.split(':')[1]))).toBe(false);
      await expect(ui.locator('#justonehop-results [aria-selected="true"]')).toHaveAttribute('id', nextSelected);
      if (!remaining.length) {
        // No matching tabs remain; unified search still offers history and Google.
        await expect(ui.locator('#justonehop-search-all-history')).toBeVisible();
        await expect(ui.locator('[id^="justonehop-google:"]')).toBeVisible();
        await expect(ui.locator('.palette-footer .primary-action')).toBeEnabled();
        await expect(ui.getByRole('button', { name: 'Open action menu' })).toBeEnabled();
      }
    }
    expect(await worker.evaluate(async ids => (await chrome.tabs.query({})).filter(tab => ids.includes(tab.id!)), ids)).toEqual([]);
  });

  test('English keep-open root keyboard menu close restores caret and accepts continued typing', async () => {
    await seedManagementTabs();
    const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await input.fill('Batch fixture');
    await expect(ui.locator('#justonehop-results .result.tab')).toHaveCount(4);
    const order = await ui.locator('#justonehop-results .result.tab').evaluateAll(nodes => nodes.map(node => node.id));
    await input.press('ArrowDown');
    await expect(ui.locator('#justonehop-results [aria-selected="true"]')).toHaveAttribute('id', order[1]);
    await input.press('ArrowLeft');
    await input.press('Shift+ArrowLeft');
    await input.press('Shift+ArrowLeft');
    const caret = await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd]);
    expect(caret).toEqual([10, 12]);
    await input.press('Meta+k');
    await expect(ui.getByRole('combobox', { name: 'Search actions' })).toBeFocused();
    await ui.keyboard.type('close tab');
    await expect(ui.locator('#justonehop-actions [aria-selected="true"]')).toHaveAttribute('id', 'justonehop-actions-action:close');
    await ui.keyboard.press('Enter');
    await expect(ui.getByRole('dialog')).toHaveCount(0);
    await expect(ui.locator('#justonehop-results .result.tab')).toHaveCount(3);
    await expect(ui.locator('#justonehop-results [aria-selected="true"]')).toHaveAttribute('id', order[2]);
    await expect(input).toHaveValue('Batch fixture');
    await expect(input).toBeFocused();
    expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual(caret);
    await ui.keyboard.type('X');
    await expect(input).toHaveValue('Batch fixture'.slice(0, 10) + 'X' + 'Batch fixture'.slice(12));
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(tab => tab.id === id), Number(order[1].split(':')[1]))).toBe(false);
  });

  test('English keep-open pin and mute refresh selected tab badges and inverse menu labels', async () => {
    const { ids } = await seedManagementTabs();
    const target = ids[1];
    const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    const row = ui.locator(`[id="justonehop-tab:${target}"]`);
    await input.fill('Batch fixture');
    await expect(ui.locator('#justonehop-results .result.tab')).toHaveCount(4);
    for (const operation of [
      { action: 'pin', title: 'Pin Tab', inverse: 'Unpin Tab', badge: 'Pinned', value: true },
      { action: 'pin', title: 'Unpin Tab', inverse: 'Pin Tab', badge: 'Pinned', value: false },
      { action: 'mute', title: 'Mute Tab', inverse: 'Unmute Tab', badge: 'Muted', value: true },
      { action: 'mute', title: 'Unmute Tab', inverse: 'Mute Tab', badge: 'Muted', value: false },
    ]) {
      await row.click({ button: 'right' });
      const action = ui.locator(`[id="justonehop-actions-action:${operation.action}"]`);
      await expect(action).toContainText(operation.title);
      await action.click();
      await expect.poll(() => worker.evaluate(async ({ id, action }) => {
        const tab = await chrome.tabs.get(id); return action === 'pin' ? tab.pinned : tab.mutedInfo?.muted;
      }, { id: target, action: operation.action })).toBe(operation.value);
      await expect(ui.getByRole('dialog')).toHaveCount(0);
      await expect(input).toHaveValue('Batch fixture');
      await expect(input).toBeFocused();
      await expect(row).toHaveAttribute('aria-selected', 'true');
      await expect(row.getByLabel(operation.badge, { exact: true })).toHaveCount(operation.value ? 1 : 0);
      await input.press('Meta+k');
      await expect(action).toContainText(operation.inverse);
      await ui.keyboard.press('Escape');
      await expect(input).toBeFocused();
    }
  });

  test('English keep-open group close and ungroup retain query caret and next or previous neighbor', async () => {
    const { groupId } = await seedManagementTabs('Batch Research');
    const root = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await root.fill('Batch Research');
    await ui.getByRole('option').filter({ hasText: 'Tab Group: Batch Research' }).click();
    const input = ui.getByRole('combobox', { name: 'Search tabs in this group…' });
    await input.fill('Batch fixture');
    const rows = ui.locator('#justonehop-group-tabs .result');
    await expect(rows).toHaveCount(4);
    const order = await rows.evaluateAll(nodes => nodes.map(node => node.id));
    await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 7));
    await ui.locator(`[id="${order[1]}"]`).click({ button: 'right' });
    await ui.locator('#group-actions-close').click();
    await expect(rows).toHaveCount(3);
    await expect(ui.locator('#justonehop-group-tabs [aria-selected="true"]')).toHaveAttribute('id', order[2]);
    await expect(input).toHaveValue('Batch fixture');
    await expect(input).toBeFocused();
    expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 7]);
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(tab => tab.id === id), Number(order[1].split(':')[1]))).toBe(false);
    await input.press('ArrowDown');
    await expect(ui.locator('#justonehop-group-tabs [aria-selected="true"]')).toHaveAttribute('id', order[3]);
    await input.press('Meta+k');
    await ui.keyboard.type('remove tab from group');
    await ui.keyboard.press('Enter');
    await expect(rows).toHaveCount(2);
    await expect(ui.getByRole('dialog')).toHaveCount(0);
    await expect(ui.locator('#justonehop-group-tabs [aria-selected="true"]')).toHaveAttribute('id', order[2]);
    await expect(input).toHaveValue('Batch fixture');
    await expect(input).toBeFocused();
    expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 7]);
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).groupId, Number(order[3].split(':')[1]))).toBe(-1);
    expect(await worker.evaluate(async id => (await chrome.tabs.query({ groupId: id })).length, groupId!)).toBe(2);
    await ui.keyboard.type('X');
    await expect(input).toHaveValue('BaXixture');
    await ui.keyboard.press('Escape');
    await expect(root).toHaveValue('Batch Research');
    await expect(root).toBeFocused();
  });

});
