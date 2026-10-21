import { test, expect } from './support/ui';
import type { Preferences } from '../src/preferences';
import type { Request, Snapshot, TuckStatus } from '../src/types';

test.use({ locale: 'en-US', viewport: { width: 1100, height: 760 }, reducedMotion: 'reduce' });

type StorageRequest = { operation: 'get'; keys: string | string[] | Record<string, unknown> | null }
  | { operation: 'set'; items: Record<string, unknown> };

test('Chinese preset auto tuck duration supports keyboard saving and narrow settings', async ({ context, page: ui }) => {
  // Owned by this test/context, so storage survives reload without leaking to another test.
  const store: Record<string, unknown> = {
    preferences: { language: 'zh', theme: 'light', autoTuck: false, autoTuckAfterHours: 168 } satisfies Preferences,
  };
  await context.exposeBinding('__tuckSettingsStorage', (_source, request: StorageRequest) => {
    if (request.operation === 'get') {
      if (request.keys === null) return structuredClone(store);
      const defaults = typeof request.keys === 'string' ? { [request.keys]: undefined }
        : Array.isArray(request.keys) ? Object.fromEntries(request.keys.map(key => [key, undefined])) : request.keys;
      return structuredClone(Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, key in store ? store[key] : fallback])));
    }
    const changes: Record<string, chrome.storage.StorageChange> = {};
    for (const [key, value] of Object.entries(request.items)) {
      changes[key] = { oldValue: structuredClone(store[key]), newValue: structuredClone(value) };
      store[key] = structuredClone(value);
    }
    return changes;
  });
  const unexpectedRequests: Request[] = [];
  await context.exposeBinding('__unexpectedTuckRequest', (_source, request: Request) => { unexpectedRequests.push(request); });
  const snapshot: Snapshot = { windowId: 1, currentTabId: 1, tabs: [], bookmarks: [], shortcut: '' };
  await context.addInitScript(snapshot => {
    const bridge = (globalThis as unknown as {
      __tuckSettingsStorage: (request: StorageRequest) => Promise<Record<string, unknown>>;
    }).__tuckSettingsStorage;
    const listeners = new Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>();
    const local = {
      get: (keys: string | string[] | Record<string, unknown> | null = null) => bridge({ operation: 'get', keys }),
      set: async (items: Record<string, unknown>) => {
        const changes = await bridge({ operation: 'set', items }) as Record<string, chrome.storage.StorageChange>;
        // Each reload installs fresh listeners in the current page; the backing store stays in Node.
        listeners.forEach(listener => listener(changes, 'local'));
      },
    };
    Object.assign(globalThis, { chrome: {
      i18n: { getUILanguage: () => 'en-US' },
      storage: { local, onChanged: {
        addListener: (listener: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) => { listeners.add(listener); },
        removeListener: (listener: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) => { listeners.delete(listener); },
      } },
      runtime: {
        connect: () => ({ onMessage: { addListener: () => {} }, disconnect: () => {} }),
        sendMessage: async (request: Request) => {
          if (request.source !== 'justonehop') throw new Error('Unexpected UI fixture message source');
          if (request.type === 'snapshot') return { ok: true, data: snapshot };
          if (request.type === 'search-history') return { ok: true, data: { items: [], limited: false } };
          if (request.type === 'execute' && request.payload.action === 'settings') return { ok: true, data: undefined };
          if (request.type === 'tuck-status') {
            const { preferences } = await bridge({ operation: 'get', keys: 'preferences' });
            // Display-only status: no alarm scheduling, worker scan or native grouping is simulated.
            const status: TuckStatus = {
              enabled: (preferences as Preferences).autoTuck,
              eligibleCount: 0, blockedCount: 0, checkedAt: Date.now(),
            };
            return { ok: true, data: status };
          }
          await (globalThis as unknown as { __unexpectedTuckRequest: (request: Request) => Promise<void> }).__unexpectedTuckRequest(request);
          throw new Error(`Unexpected UI fixture request: ${JSON.stringify(request)}`);
        },
      },
    } });
  }, snapshot);
  await ui.goto('https://justonehop.test/popup.html');
  await ui.getByRole('combobox').fill('自动收起');
  await expect(ui.getByRole('option').first()).toContainText('自动收起');
  await expect(ui.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
  await ui.getByRole('combobox').press('Enter');
  await ui.setViewportSize({ width: 390, height: 516 });
  // The standalone popup defaults to 750px; preserve the original narrow overlay layout fixture.
  await ui.locator('.justonehop-app').evaluate(node => { node.classList.replace('popup', 'overlay'); document.body.style.width = '390px'; });
  const filter = ui.getByRole('textbox', { name: '搜索设置' });
  await filter.fill('自动收起');
  await filter.press('Tab');
  await expect(ui.locator('.settings-search .search-dismiss')).toBeFocused();
  await expect(ui.locator('.settings-search .search-dismiss')).toHaveAccessibleName('清空搜索');
  await ui.keyboard.press('Tab'); // Rules follow the shared clear/dismiss button.
  const rules = ui.getByRole('button', { name: '了解规则' });
  await expect(rules).toBeFocused();
  await rules.press('Space');
  await expect(ui.locator('.tuck-rules-copy')).toContainText('所有已收起的标签页都会恢复到标签栏');
  await rules.press('Space');
  await expect(ui.locator('.tuck-rules-copy')).toBeHidden();
  await ui.keyboard.press('Tab'); // Auto tuck switch
  const toggle = ui.getByRole('switch', { name: '自动收起标签页' });
  await expect(toggle).toBeFocused();
  await expect(ui.locator('.tuck-settings')).toHaveCount(0);
  await toggle.press('Space');
  await expect(toggle).toBeChecked();
  const duration = ui.getByRole('combobox', { name: '闲置时长' });
  await expect(duration).toBeEnabled();
  await expect(toggle).toBeFocused();
  await toggle.press('Tab');
  await expect(ui.getByRole('button', { name: '刷新状态' })).toBeFocused();
  await ui.keyboard.press('Tab');
  await expect(duration).toBeFocused();
  await duration.press('Enter');
  await expect(ui.getByRole('listbox').getByRole('option')).toHaveText(['1 小时', '3 小时', '12 小时', '1 天', '3 天', '7 天']);
  await duration.press('Home'); await duration.press('Enter');
  await expect(ui.getByRole('spinbutton')).toHaveCount(0);
  await ui.keyboard.press('Escape');
  const search = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
  await search.fill('自动收起'); await search.press('Enter');
  await expect(ui.getByRole('button', { name: '保存时长', exact: true })).toHaveCount(0);
  await expect.poll(() => (store.preferences as Preferences).autoTuckAfterHours).toBe(1);
  await expect(duration).toHaveText('1 小时');
  await expect(duration).toBeEnabled();
  await expect(ui.locator('.tuck-status-copy')).toContainText('目前没有符合条件');
  expect(await ui.locator('.settings-view').evaluate(node => {
    const box = node.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth && node.scrollWidth <= node.clientWidth;
  })).toBe(true);
  await ui.screenshot({ path: test.info().outputPath('auto-tuck-presets-zh-narrow.png') });
  await ui.reload();
  await ui.getByRole('combobox').fill('自动收起');
  await expect(ui.getByRole('option').first()).toContainText('自动收起');
  await expect(ui.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
  await ui.getByRole('combobox').press('Enter');
  await expect(ui.getByRole('combobox', { name: '闲置时长' })).toHaveText('1 小时');
  // Older saved durations remain honest until replaced by a preset.
  await ui.evaluate(() => chrome.storage.local.set({ preferences: { language: 'zh', theme: 'light', autoTuck: true, autoTuckAfterHours: 48 } }));
  await expect(duration).toHaveText('2 天');
  await duration.click();
  await expect(ui.getByRole('listbox').getByRole('option')).toHaveCount(7);
  await ui.getByRole('option', { name: '3 天', exact: true }).click();
  await expect.poll(() => (store.preferences as Preferences).autoTuckAfterHours).toBe(72);
  await expect(duration).toBeEnabled();
  await duration.click();
  await expect(ui.getByRole('listbox').getByRole('option')).toHaveCount(6);
  await expect(ui.getByRole('option', { name: '2 天', exact: true })).toHaveCount(0);
  expect(unexpectedRequests).toEqual([]);
});
