import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { perform, snapshot } from '../src/browser.ts';
import { type UsageRecord, USAGE_STORAGE_KEY } from '../src/usage.ts';

let calls: [string, ...unknown[]][];
let tabs: chrome.tabs.Tab[];
let bookmarkUrl: string;
let usage: UsageRecord[];
const record = (name: string) => async (...args: unknown[]) => { calls.push([name, ...args]); };
beforeEach(() => {
  calls = []; bookmarkUrl = 'https://example.com'; usage = [];
  tabs = [
    { id: 1, index: 0, windowId: 10, pinned: true, active: false, title: 'Pinned', url: 'https://pinned.example' },
    { id: 2, index: 1, windowId: 10, pinned: false, active: true, mutedInfo: { muted: false }, title: 'Active' },
    { id: 3, index: 2, windowId: 10, pinned: false, active: false, title: 'Right' },
    { id: 4, index: 0, windowId: 20, pinned: false, active: true, title: 'Other window' },
  ] as chrome.tabs.Tab[];
  globalThis.chrome = {
    storage: { local: {
      get: async () => ({ [USAGE_STORAGE_KEY]: structuredClone(usage) }),
      set: async (value: Record<string, UsageRecord[]>) => { usage = structuredClone(value[USAGE_STORAGE_KEY]); },
    } },
    windows: { get: async (id: number) => ({ id }) },
    tabs: {
      get: async (id: number) => { const tab = tabs.find(t => t.id === id); if (!tab) throw new Error('No tab'); return tab; },
      query: async (query: chrome.tabs.QueryInfo) => query.currentWindow ? [tabs[1]] : tabs.filter(t => t.windowId === query.windowId),
      update: record('update'), remove: record('remove'), create: record('create'), reload: record('reload'),
    },
    bookmarks: { get: async () => [{ id: 'b', title: 'Bookmark', url: bookmarkUrl }], getTree: async () => [{ title: 'Folder', children: [{ id: 'b', title: 'Bookmark', url: bookmarkUrl }] }] },
    tabGroups: { query: async () => [] },
    commands: { getAll: async () => [{ name: 'toggle-palette', shortcut: '⌘⇧P' }] },
    sessions: { getRecentlyClosed: async () => [{ tab: { sessionId: 'session' } }], restore: record('restore') },
  } as unknown as typeof chrome;
});
test('snapshot only queries the source window and flattens bookmark folders', async () => {
  const data = await snapshot(tabs[1]);
  assert.deepEqual(data.tabs.map(t => t.id), [1, 3, 2]);
  assert.equal(data.bookmarks[0].folder, 'Folder');
  assert.equal(data.currentTabId, 2);
});
test('refuses to operate on a tab that moved to another window', async () => {
  await assert.rejects(perform({ action: 'close', windowId: 10, tabId: 4 }), /another window/);
  assert.equal(calls.length, 0);
});
test('close right and others re-read live tabs and retain pinned tabs', async () => {
  await perform({ action: 'closeRight', windowId: 10, tabId: 2 });
  assert.deepEqual(calls, [['remove', [3]]]);
  calls = [];
  await perform({ action: 'closeOthers', windowId: 10, tabId: 3 });
  assert.deepEqual(calls, [['remove', [2]]]);
});
test('pin and mute toggle the live state', async () => {
  await perform({ action: 'pin', windowId: 10, tabId: 1 });
  await perform({ action: 'mute', windowId: 10, tabId: 2 });
  assert.deepEqual(calls, [['update', 1, { pinned: false }], ['update', 2, { muted: true }]]);
});
test('bookmark URL is resolved by ID and scripts are not executed', async () => {
  bookmarkUrl = 'javascript:alert(1)';
  await assert.rejects(perform({ action: 'openBookmark', windowId: 10, bookmarkId: 'b' }), /Script bookmarks/);
  assert.equal(calls.length, 0);
});
test('bookmark opens in the original window', async () => {
  await perform({ action: 'openBookmark', windowId: 10, bookmarkId: 'b' });
  assert.deepEqual(calls, [['create', { windowId: 10, url: 'https://example.com' }]]);
});
test('restore uses the latest session and reports an empty session list', async () => {
  await perform({ action: 'restore', windowId: 10 });
  assert.deepEqual(calls, [['restore', 'session']]);
  chrome.sessions.getRecentlyClosed = async () => [];
  await assert.rejects(perform({ action: 'restore', windowId: 10 }), /No recently closed/);
});
test('invalid commands cannot trigger another action', async () => {
  await assert.rejects(perform({ action: 'unknown' as never, windowId: 10, tabId: 2 }), /Unsupported/);
  assert.equal(calls.length, 0);
});

test('snapshot orders previously used tabs by last access while preserving strip indexes', async () => {
  tabs[0].lastAccessed = 100;
  tabs[2].lastAccessed = 300;
  tabs[1].lastAccessed = 500;
  const data = await snapshot(tabs[1]);
  assert.deepEqual(data.tabs.map(tab => tab.id), [3, 1, 2]);
  assert.deepEqual(data.tabs.map(tab => tab.index), [2, 0, 1]);
});

test('only successful actions learn; tab identities use their live URL', async () => {
  await assert.rejects(perform({ action: 'switch', windowId: 10, tabId: 99, query: 'iam' }));
  assert.equal(usage.length, 0);
  await perform({ action: 'switch', windowId: 10, tabId: 1, query: ' IAM ' });
  assert.equal(usage[0].query, 'iam');
  assert.equal(usage[0].target, 'tab:https://pinned.example');
  await perform({ action: 'openBookmark', windowId: 10, bookmarkId: 'b', query: 'guide' });
  assert.ok(usage.some(record => record.target === 'bookmark:b'));
  await perform({ action: 'settings', windowId: 10, query: 'language' });
  assert.ok(usage.some(record => record.target === 'command:settings'));
});

test('failed browser operations never train, and failed learning never retries successful actions', async () => {
  chrome.tabs.create = async () => { throw new Error('Cannot create tab'); };
  await assert.rejects(perform({ action: 'newTab', windowId: 10, query: 'new' }));
  assert.equal(usage.length, 0);
  chrome.tabs.create = async properties => { calls.push(['create', properties]); return tabs[1]; };
  chrome.storage.local.set = async () => { throw new Error('Disk unavailable'); };
  await perform({ action: 'newTab', windowId: 10, query: 'new' });
  assert.deepEqual(calls, [['create', { windowId: 10 }]]);
});

test('empty searches train commands but not tabs or bookmarks; private windows never train', async () => {
  await perform({ action: 'switch', windowId: 10, tabId: 1, query: '' });
  await perform({ action: 'openBookmark', windowId: 10, bookmarkId: 'b' });
  assert.equal(usage.length, 0);
  await perform({ action: 'newTab', windowId: 10, query: '' });
  assert.equal(usage[0].target, 'command:newTab');
  assert.equal(usage[0].query, '');
  await perform({ action: 'mute', windowId: 10, tabId: 1 });
  assert.ok(usage.some(record => record.query === '' && record.target === 'command:mute'));
  const saved = structuredClone(usage);
  chrome.windows.get = async () => ({ id: 10, incognito: true }) as chrome.windows.Window;
  await perform({ action: 'newTab', windowId: 10, query: 'new' });
  await perform({ action: 'mute', windowId: 10, tabId: 1, query: '' });
  assert.deepEqual(usage, saved);
});

test('snapshot coalesces bookmark reads and invalidates a tree changed while loading', async () => {
  let invalidate!: () => void;
  Object.assign(chrome.bookmarks, { onChanged: { addListener: (listener: () => void) => { invalidate = listener; } } });
  let release!: (nodes: chrome.bookmarks.BookmarkTreeNode[]) => void;
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  let reads = 0;
  chrome.bookmarks.getTree = async () => {
    reads++;
    if (reads === 1) { started(); return new Promise<chrome.bookmarks.BookmarkTreeNode[]>(resolve => { release = resolve; }); }
    return [{ id: 'fresh', syncing: false, title: 'Fresh bookmark', url: 'https://fresh.example' }];
  };
  const first = snapshot(tabs[1]);
  const second = snapshot(tabs[1]);
  await reading;
  invalidate();
  release([{ id: 'old', syncing: false, title: 'Stale bookmark', url: 'https://old.example' }]);
  for (const result of await Promise.all([first, second])) assert.equal(result.bookmarks[0].id, 'fresh');
  assert.equal(reads, 2);
  tabs[2].title = 'Changed live title';
  const next = await snapshot(tabs[1]);
  assert.equal(reads, 2);
  assert.equal(next.tabs.find(tab => tab.id === 3)?.title, 'Changed live title');
});

test('operation acknowledgement does not wait for learning but the worker promise still does', async () => {
  let release!: () => void;
  let started!: () => void;
  const writing = new Promise<void>(resolve => { started = resolve; });
  const write = chrome.storage.local.set.bind(chrome.storage.local);
  chrome.storage.local.set = (async data => {
    started(); await new Promise<void>(resolve => { release = resolve; }); await write(data);
  }) as typeof chrome.storage.local.set;
  let acknowledged = false;
  let completed = false;
  const action = perform({ action: 'switch', windowId: 10, tabId: 1, query: 'pinned' }, () => {
    assert.deepEqual(calls, [['update', 1, { active: true }]]);
    acknowledged = true;
  }).then(() => { completed = true; });
  await writing;
  assert.equal(acknowledged, true);
  assert.equal(completed, false);
  release(); await action;
  assert.equal(completed, true);
  assert.equal(usage[0].query, 'pinned');
  let failedAcknowledgement = false;
  await assert.rejects(perform({ action: 'switch', windowId: 10, tabId: 99 }, () => { failedAcknowledgement = true; }));
  assert.equal(failedAcknowledgement, false);
});

test('group snapshot is scoped to the source window and includes membership', async () => {
  tabs[0].groupId = 7;
  chrome.tabGroups.query = (async query => {
    assert.deepEqual(query, { windowId: 10 });
    return [{ id: 7, windowId: 10, title: 'Work', color: 'blue', collapsed: true, shared: false }];
  }) as typeof chrome.tabGroups.query;
  const data = await snapshot(tabs[1]);
  assert.equal(data.tabs.find(tab => tab.id === 1)?.groupId, 7);
  assert.equal(data.groups?.[0].title, 'Work');
});

test('group actions reject moved members and groups from another window', async () => {
  tabs[2].groupId = 8;
  for (const action of ['close', 'switch', 'ungroupTab'] as const) {
    await assert.rejects(perform({ action, tabId: 3, groupId: 7, windowId: 10 }));
  }
  chrome.tabGroups.get = (async () => ({ id: 7, windowId: 20, color: 'blue' as const, collapsed: false, shared: false })) as typeof chrome.tabGroups.get;
  await assert.rejects(perform({ action: 'updateGroup', groupId: 7, windowId: 10, groupChanges: { title: 'Changed' } }));
  assert.equal(calls.length, 0);
});
