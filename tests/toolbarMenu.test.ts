import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

const event = <T extends unknown[]>() => {
  const listeners: ((...args: T) => void)[] = [];
  return {
    addListener: (listener: (...args: T) => void) => { listeners.push(listener); },
    emit: (...args: T) => { for (const listener of listeners) listener(...args); },
  };
};
const clicked = event<[chrome.contextMenus.OnClickData, chrome.tabs.Tab?]>();
const storageChanged = event<[Record<string, chrome.storage.StorageChange>, string]>();
const activated = event<[chrome.tabs.OnActivatedInfo]>();
const focusChanged = event<[number]>();
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const shortcutId = 'justonehop-toolbar-shortcut';
const helpId = 'justonehop-toolbar-help';
const shortcutsUrl = 'chrome://extensions/shortcuts';
const binding = 'Alt+Shift+K';
const menus = new Map<string, Pick<chrome.contextMenus.CreateProperties, 'id' | 'title' | 'contexts'>>();
let calls: [string, ...unknown[]][] = [];
let commands: chrome.commands.Command[] = [
  { name: 'toggle-switcher', shortcut: 'Ctrl+Q' },
  { name: 'toggle-palette', shortcut: binding },
];
let commandError: Error | undefined;
let tabs: chrome.tabs.Tab[] = [];

globalThis.chrome = {
  runtime: {
    getURL: (path: string) => `chrome-extension://justonehop-test/${path}`,
    onInstalled: event<[]>(), onStartup: event<[]>(),
  },
  storage: {
    local: { get: async () => ({ preferences: { language: 'en' } }) },
    onChanged: storageChanged,
  },
  i18n: { getUILanguage: () => 'en-US' },
  commands: {
    getAll: async () => {
      calls.push(['commands']);
      if (commandError) throw commandError;
      return structuredClone(commands);
    },
  },
  contextMenus: {
    onClicked: clicked,
    update: async (id: string, properties: Omit<chrome.contextMenus.CreateProperties, 'id'>) => {
      calls.push(['menu-update', id, properties]);
      const existing = menus.get(id);
      if (!existing) throw new Error('Cannot find menu item');
      menus.set(id, { ...existing, ...properties });
    },
    create: (properties: chrome.contextMenus.CreateProperties, callback: () => void) => {
      calls.push(['menu-create', properties]);
      assert.ok(properties.id);
      assert.equal(menus.has(properties.id), false, 'menu IDs must not be created twice');
      menus.set(properties.id, structuredClone(properties));
      callback();
      return properties.id;
    },
  },
  windows: {
    WINDOW_ID_NONE: -1,
    onFocusChanged: focusChanged,
    getCurrent: async () => { calls.push(['current-window']); return { id: 20 }; },
  },
  tabs: {
    onActivated: activated, onUpdated: event<[number, chrome.tabs.OnUpdatedInfo, chrome.tabs.Tab]>(),
    query: async (query: chrome.tabs.QueryInfo) => {
      calls.push(['tab-query', query]);
      return tabs.filter(tab => tab.windowId === query.windowId);
    },
    get: async (id: number) => {
      calls.push(['tab-get', id]);
      const tab = tabs.find(tab => tab.id === id);
      if (!tab) throw new Error('No tab');
      return { ...tab };
    },
    update: async (id: number, properties: chrome.tabs.UpdateProperties) => { calls.push(['tab-update', id, properties]); },
    create: async (properties: chrome.tabs.CreateProperties) => { calls.push(['tab-create', properties]); },
  },
} as unknown as typeof chrome;

const toolbar = await import('../src/toolbarMenu.ts');
toolbar.startToolbarMenu();
await tick();
const startupCreates = calls.filter(([name]) => name === 'menu-create');
const menuWrites = () => calls.filter(([name]) => name === 'menu-create' || name === 'menu-update');
const navigationCalls = () => calls.filter(([name]) => name.startsWith('tab-') || name === 'current-window');
async function click(menuItemId: string, windowId?: number) {
  clicked.emit({ menuItemId } as chrome.contextMenus.OnClickData,
    windowId === undefined ? undefined : { id: 7, windowId } as chrome.tabs.Tab);
  await tick();
}

beforeEach(async () => {
  commandError = undefined;
  commands = [{ name: 'toggle-switcher', shortcut: 'Ctrl+Q' }, { name: 'toggle-palette', shortcut: binding }];
  tabs = [];
  storageChanged.emit({ preferences: { newValue: { language: 'en' } } }, 'local');
  await toolbar.refreshToolbarMenu();
  calls = [];
});

test('toolbar menu shows the actual palette binding and only uses action contexts', async () => {
  assert.deepEqual(startupCreates, [
    ['menu-create', { id: shortcutId, title: 'Open JustOneHop: Alt+Shift+K · Change shortcut', contexts: ['action'] }],
    ['menu-create', { id: helpId, title: 'Help', contexts: ['action'] }],
  ]);
  commands[1].shortcut = 'Ctrl+Shift+9';
  await toolbar.refreshToolbarMenu();
  assert.deepEqual(menus.get(shortcutId), {
    id: shortcutId, title: 'Open JustOneHop: Ctrl+Shift+9 · Change shortcut', contexts: ['action'],
  });
  assert.deepEqual(menus.get(helpId), { id: helpId, title: 'Help', contexts: ['action'] });
});

test('an empty or missing palette binding shows Not assigned instead of another command', async () => {
  for (const palette of [{ name: 'toggle-palette', shortcut: '' }, undefined]) {
    commands = [{ name: 'toggle-switcher', shortcut: 'Ctrl+Q' }, ...(palette ? [palette] : [])];
    await toolbar.refreshToolbarMenu();
    assert.equal(menus.get(shortcutId)?.title, 'Open JustOneHop: Not assigned · Change shortcut');
  }
});

test('repeated and overlapping activity refreshes do not create duplicate menu items', async () => {
  activated.emit({ tabId: 7, windowId: 10 });
  focusChanged.emit(10);
  await Promise.all([toolbar.refreshToolbarMenu(), toolbar.refreshToolbarMenu(), toolbar.refreshToolbarMenu()]);
  assert.equal(calls.filter(([name]) => name === 'commands').length, 5);
  assert.deepEqual(menuWrites(), []);
  assert.deepEqual([...menus.keys()], [shortcutId, helpId]);
});

test('a fresh module updates persisted menu items without recreating them', async () => {
  menus.set(shortcutId, { id: shortcutId, title: 'Old shortcut', contexts: ['page'] });
  menus.set(helpId, { id: helpId, title: 'Old help', contexts: ['page'] });
  const restarted = await import(new URL('../src/toolbarMenu.ts?persisted-menu', import.meta.url).href);
  await restarted.refreshToolbarMenu();
  assert.deepEqual(menuWrites(), [
    ['menu-update', shortcutId, { title: 'Open JustOneHop: Alt+Shift+K · Change shortcut', contexts: ['action'] }],
    ['menu-update', helpId, { title: 'Help', contexts: ['action'] }],
  ]);
  assert.equal(menus.get(shortcutId)?.title, 'Open JustOneHop: Alt+Shift+K · Change shortcut');
  assert.equal(menus.get(helpId)?.title, 'Help');
});

test('a language preference change refreshes both menu labels', async () => {
  storageChanged.emit({ preferences: { newValue: { language: 'zh' } } }, 'local');
  await tick();
  assert.equal(menus.get(shortcutId)?.title, '打开小范围瞬移：Alt+Shift+K · 修改快捷键');
  assert.equal(menus.get(helpId)?.title, '使用帮助');
  assert.deepEqual(menuWrites().map(([, id]) => id), [shortcutId, helpId]);
  assert.equal(calls.some(([name]) => name === 'menu-create'), false);
});

test('failed command reads preserve existing menus and the next refresh recovers', async context => {
  const warn = context.mock.method(console, 'warn', (..._args: unknown[]) => {});
  const previous = structuredClone([...menus]);
  commandError = new Error('Commands temporarily unavailable');
  commands[1].shortcut = 'Ctrl+Shift+8';
  await toolbar.refreshToolbarMenu();
  assert.deepEqual([...menus], previous);
  assert.deepEqual(menuWrites(), []);
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(warn.mock.calls[0].arguments[1], commandError);

  commandError = undefined;
  await toolbar.refreshToolbarMenu();
  assert.equal(menus.get(shortcutId)?.title, 'Open JustOneHop: Ctrl+Shift+8 · Change shortcut');
  assert.equal(menus.get(helpId)?.title, 'Help');
  assert.equal(calls.some(([name]) => name === 'menu-create'), false);
  assert.equal(warn.mock.callCount(), 1);
});

test('Help opens the bundled page in the clicked tab window', async () => {
  await click(helpId, 10);
  assert.deepEqual(navigationCalls(), [
    ['tab-create', { windowId: 10, url: 'chrome-extension://justonehop-test/help.html' }],
  ]);
});

test('the shortcut menu reuses the existing shortcuts page in the clicked window', async () => {
  tabs = [
    { id: 30, windowId: 20, index: 0, active: true, url: shortcutsUrl },
    { id: 11, windowId: 10, index: 0, active: false, url: 'chrome://extensions/' },
    { id: 12, windowId: 10, index: 1, active: false, url: shortcutsUrl },
  ] as chrome.tabs.Tab[];
  await click(shortcutId, 10);
  assert.deepEqual(navigationCalls(), [
    ['tab-query', { windowId: 10 }], ['tab-get', 12], ['tab-update', 12, { active: true }],
  ]);
});

test('clicks without a tab use the current window for Help and shortcut creation', async () => {
  await click(helpId);
  await click(shortcutId);
  assert.deepEqual(navigationCalls(), [
    ['current-window'], ['tab-create', { windowId: 20, url: 'chrome-extension://justonehop-test/help.html' }],
    ['current-window'], ['tab-query', { windowId: 20 }], ['tab-create', { windowId: 20, url: shortcutsUrl }],
  ]);
});

test('unrelated menu clicks do not navigate or refresh toolbar menus', async () => {
  await click('another-menu-item');
  assert.deepEqual(calls, []);
});
