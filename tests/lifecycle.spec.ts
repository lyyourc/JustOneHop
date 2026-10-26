import { expect } from '@playwright/test';
import { test, defaults, origin, context, ui, worker, setWorker } from './support/paletteFixture';
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
  await page.bringToFront();
  await worker.evaluate(id => chrome.tabs.sendMessage(id, { source: 'justonehop', type: 'toggle' }), tabId);
  await expect(page.locator('#justonehop-command-palette')).toBeAttached();
  await worker.evaluate(async () => { await chrome.tabs.create({ url: 'about:blank', active: true }); });
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
            node.properties?.some(property => property.name === 'selected' && propValue(property)));
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

function propValue(property: { value: { value?: unknown } }) { return property.value.value === true; }

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, commands: true } });
  test('English wheel back and Backspace navigation work in the closed iframe', async () => {
    await test.step('wheel back closes settings then palette', async () => {
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
      await page.close();
    });

    await test.step('Backspace respects fields inside the closed keyboard frame', async () => {
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
      await cdp.detach();
      await page.close();
    });
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true, pageAccess: true, shadow: 'closed' } });
  test('English reload justonehop extension via keyboard preserves pages and reopens the palette', async () => {
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
    await page.keyboard.type('JustOneHop：重新加载');
    const nextWorker = context.waitForEvent('serviceworker', candidate => candidate.url() === worker.url());
    const oldWorker = worker;
    const stopped = oldWorker.waitForEvent('close');
    await page.keyboard.press('Shift+Enter');
    await expect(page.locator('#justonehop-command-palette')).toBeAttached();
    await page.keyboard.press('Enter');
    await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
    await stopped;
    setWorker(await nextWorker);
    await expect(page.getByRole('textbox', { name: 'Page input' })).toHaveValue('keep this text');
    await expect(page.getByRole('textbox', { name: 'Page input' })).toBeFocused();
    expect(await worker.evaluate(async () => (await chrome.storage.local.get('reloadFixture')).reloadFixture)).toBe('kept');
    await expect.poll(() => ui.isClosed()).toBe(true);
    await launch();
    await page.keyboard.type('settings');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
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

test.describe('headed', { tag: '@headed' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true, headed: true } });
  test('English source close overlay root and group keep other-tab management open then close without a new window', async () => {
    for (const layer of ['root', 'group'] as const) await test.step(layer, async () => {
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
      await worker.evaluate(ids => chrome.tabs.remove(ids), [seeded.successor, seeded.last]);
    });
  });
});

test.describe('headed', { tag: '@headed' }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true, headed: true } });
  test('English native panel source close and keep-open management', async () => {
    await test.step('source close native bound tab closes its panel without rebinding or creating a window', async () => {
      const successor = await worker.evaluate(async () => {
        const tab = await chrome.tabs.create({ url: 'chrome://downloads/', active: false });
        return tab.id!;
      });
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
      await worker.evaluate(id => chrome.tabs.remove(id), successor);
    });

    await test.step('keep-open native other-tab close retains its binding and mouse Pin and Mute accept subsequent Enter', async () => {
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
      await palette.close();
      await worker.evaluate(id => chrome.tabs.remove(id), source.tabId);
    });

    await test.step('keep-open native external source close cancels only its own panel', async () => {
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
      await worker.evaluate(id => chrome.windows.remove(id), other.windowId);
    });
  });

  test('English wheel back, Escape, shortcut, and focus loss close the native palette', async () => {
    await test.step('wheel back returns and closes the native palette', async () => {
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
      await worker.evaluate(id => chrome.tabs.remove(id), source.tabId);
    });

    await test.step('native window closes on Escape, shortcut, and focus loss', async () => {
      let opened = await openNativePalette();
      await opened.palette.keyboard.press('Escape').catch(error => { if (!opened.palette.isClosed()) throw error; });
      await expect.poll(() => opened.palette.isClosed()).toBe(true);
      await worker.evaluate(id => chrome.tabs.remove(id), opened.source.tabId);
      opened = await openNativePalette();
      await worker.evaluate(async () => {
        const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
        await Promise.all(callbacks.map(callback => callback('toggle-palette')));
      });
      await expect.poll(() => opened.palette.isClosed()).toBe(true);
      await worker.evaluate(id => chrome.tabs.remove(id), opened.source.tabId);
      opened = await openNativePalette();
      await worker.evaluate(id => chrome.windows.update(id, { focused: true }), opened.source.windowId);
      await expect.poll(() => opened.palette.isClosed()).toBe(true);
      await worker.evaluate(id => chrome.tabs.remove(id), opened.source.tabId);
    });
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English Undo Tuck restores keyboard focus in popup and overlay after footer and menu actions', async () => {
    await test.step('popup Undo Tuck focus restoration', async () => {
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
      await worker.evaluate(id => chrome.tabs.remove(id), target.tabId);
    });

    await test.step('overlay Undo Tuck focus restoration after footer and menu actions', async () => {
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
      await page.close();
      await worker.evaluate(id => chrome.tabs.remove(id), target.tabId);
    });
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

  async function clearSeededTabs(ids: number[]) {
    await worker.evaluate(async ids => {
      const existing = (await chrome.tabs.query({})).filter(tab => ids.includes(tab.id!)).map(tab => tab.id!);
      if (existing.length) await chrome.tabs.remove(existing);
    }, ids);
  }

  test('English keep-open root and group tab management preserves query, caret, badges, and neighbor selection', async () => {
    await test.step('root mouse close preserves query and selects next then previous neighbor through empty results', async () => {
      const { ids } = await seedManagementTabs();
      const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
      const rows = ui.locator('#justonehop-results .result.tab');
      await input.fill('Batch fixture');
      await expect(ui.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
      await expect(rows).toHaveCount(4);
      const order = await rows.evaluateAll(nodes => nodes.map(node => node.id));
      await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 7));
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
          await expect(ui.locator('#justonehop-search-all-history')).toBeVisible();
          await expect(ui.locator('[id^="justonehop-google:"]')).toBeVisible();
          await expect(ui.locator('.palette-footer .primary-action')).toBeEnabled();
          await expect(ui.getByRole('button', { name: 'Open action menu' })).toBeEnabled();
        }
      }
      expect(await worker.evaluate(async ids => (await chrome.tabs.query({})).filter(tab => ids.includes(tab.id!)), ids)).toEqual([]);
    });

    await test.step('root keyboard menu close restores caret and accepts continued typing', async () => {
      const { ids } = await seedManagementTabs();
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
      await clearSeededTabs(ids);
    });

    await test.step('pin and mute refresh selected tab badges and inverse menu labels', async () => {
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
      await clearSeededTabs(ids);
    });

    await test.step('group close and ungroup retain query caret and next or previous neighbor', async () => {
      const { ids, groupId } = await seedManagementTabs('Batch Research');
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
      await clearSeededTabs(ids);
    });
  });
});
