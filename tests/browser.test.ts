import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { historyWindow, perform, searchHistory, snapshot } from '../src/browser.ts';
import { queryUsage, rankingInfo, type UsageRecord, USAGE_STORAGE_KEY } from '../src/usage.ts';
import { entries, search } from '../src/model.ts';

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
    runtime: { id: 'zing', getURL: (path: string) => `chrome-extension://zing/${path}` },
    history: { search: async () => [] },
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
const historySender = (): chrome.runtime.MessageSender => ({ id: 'zing', url: 'chrome-extension://zing/popup.html' });

test('history reads are uncached, bounded to 100 and use explicit week/all start times', async () => {
  const searches: chrome.history.HistoryQuery[] = [];
  chrome.history.search = async query => { searches.push(query); return []; };
  const before = Date.now() - 7 * 24 * 60 * 60 * 1000;
  assert.deepEqual(await searchHistory({ query: 'guide', scope: 'week' }, historySender()), { items: [], limited: false });
  const after = Date.now() - 7 * 24 * 60 * 60 * 1000;
  await searchHistory({ query: 'guide', scope: 'week' }, historySender());
  await searchHistory({ query: 'guide', scope: 'all' }, historySender());
  assert.equal(searches.length, 3);
  assert.equal(searches[0].text, 'guide');
  assert.equal(searches[0].maxResults, 100);
  assert.ok(searches[0].startTime! >= before && searches[0].startTime! <= after);
  assert.deepEqual(searches[2], { text: 'guide', startTime: 0, maxResults: 100 });
  assert.deepEqual(usage, []);
});

test('history reads sanitize result fields and report the raw API cap', async () => {
  chrome.history.search = async () => [
    { id: 'good', url: 'https://example.com/path?q=one#two', title: 'Guide', lastVisitTime: 12 },
    { id: 'fallback', url: 'http://example.com/', lastVisitTime: NaN },
    ...Array.from({ length: 98 }, (_, i) => ({ id: String(i), url: 'javascript:alert(1)', title: 'Unsafe' })),
  ];
  assert.deepEqual(await searchHistory({ query: '', scope: 'all' }, historySender()), {
    items: [
      { id: 'good', url: 'https://example.com/path?q=one#two', title: 'Guide', lastVisitTime: 12 },
      { id: 'fallback', url: 'http://example.com/', title: 'http://example.com/', lastVisitTime: 0 },
    ], limited: true,
  });
});

test('history refuses malformed payloads and untrusted or non-palette senders before reading', async () => {
  chrome.history.search = async () => { calls.push(['history']); return []; };
  for (const request of [null, {}, { query: 4, scope: 'week' }, { query: '', scope: 'forever' }]) {
    await assert.rejects(searchHistory(request as never, historySender()));
  }
  tabs[1].url = 'https://source.example/';
  const overlay = { id: 'zing', tab: { ...tabs[1] }, url: tabs[1].url, frameId: 0 };
  assert.equal(await historyWindow(overlay), 10);
  for (const sender of [
    { ...historySender(), id: 'other-extension' },
    { ...historySender(), url: 'chrome-extension://zing/help.html' },
    { ...historySender(), frameId: 1 },
    { ...overlay, frameId: 1 },
    { ...overlay, url: 'https://unrelated.example/' },
    { ...overlay, tab: { ...tabs[1], windowId: 20 } },
    { ...overlay, tab: undefined },
  ]) await assert.rejects(searchHistory({ query: 'guide', scope: 'week' }, sender));
  await assert.rejects(historyWindow(overlay, 20));
  assert.deepEqual(calls, []);
});

test('history rejects incognito, inactive and vanished source contexts', async () => {
  chrome.history.search = async () => { calls.push(['history']); return []; };
  for (const patch of [{ incognito: true }, { active: false }]) {
    Object.assign(tabs[1], patch);
    await assert.rejects(searchHistory({ query: 'guide', scope: 'week' }, historySender()));
    tabs[1].incognito = false; tabs[1].active = true;
  }
  chrome.windows.get = async () => ({ id: 10, incognito: true }) as chrome.windows.Window;
  await assert.rejects(searchHistory({ query: 'guide', scope: 'week' }, historySender()));
  assert.equal((await snapshot(tabs[1])).incognito, true);
  chrome.windows.get = async () => { throw new Error('No window'); };
  await assert.rejects(searchHistory({ query: 'guide', scope: 'week' }, historySender()));
  await assert.rejects(historyWindow({ ...historySender(), tab: { ...tabs[1], id: 99 } }));
  assert.deepEqual(calls, []);
});

test('successful history selections learn the query and share the full URL identity with tabs', async () => {
  await perform({ action: 'openHistoryPage', windowId: 10, url: 'https://g.echo.tech/c2c-web?q=one#two', query: ' C2C-web ' });
  assert.deepEqual(calls, [['create', { windowId: 10, url: 'https://g.echo.tech/c2c-web?q=one#two' }]]);
  assert.equal(usage.length, 1);
  assert.equal(usage[0].query, 'c2c-web');
  assert.equal(usage[0].target, 'tab:https://g.echo.tech/c2c-web?q=one#two');
  assert.equal(usage[0].weight, 1);
});

test('history failures and blank queries do not create preferences', async () => {
  await perform({ action: 'openHistoryPage', windowId: 10, url: 'https://example.com/', query: ' ' });
  chrome.tabs.create = async () => { throw new Error('Cannot create tab'); };
  await assert.rejects(perform({ action: 'openHistoryPage', windowId: 10, url: 'https://example.com/', query: 'example' }));
  assert.deepEqual(usage, []);
});

test('history opening rejects unsafe URLs, malformed requests and private windows', async () => {
  for (const url of [undefined, 42, '', 'not a url', 'javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/test', 'chrome://history/', ' https://example.com', 'https://exa\nmple.com']) {
    await assert.rejects(perform({ action: 'openHistoryPage', windowId: 10, url } as never));
  }
  await assert.rejects(perform({ action: 'openHistoryPage', windowId: '10', url: 'https://example.com/' } as never));
  chrome.windows.get = async () => ({ id: 10, incognito: true }) as chrome.windows.Window;
  await assert.rejects(perform({ action: 'openHistoryPage', windowId: 10, url: 'https://example.com/' }));
  chrome.windows.get = async () => { throw new Error('No window'); };
  await assert.rejects(perform({ action: 'openHistoryPage', windowId: 10, url: 'https://example.com/' }));
  assert.deepEqual(calls, []);
  assert.deepEqual(usage, []);
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
const chromePageTargets = [
  ['openExtensions', 'chrome://extensions/'], ['openPasswords', 'chrome://password-manager/passwords'],
  ['openDownloads', 'chrome://downloads/'], ['openHistory', 'chrome://history/'],
  ['openBookmarks', 'chrome://bookmarks/'], ['openChromeSettings', 'chrome://settings/'],
  ['openExtensionShortcuts', 'chrome://extensions/shortcuts'],
] as const;

test('Chrome Pages create in the source window and learn each destination separately', async () => {
  chrome.tabs.query = (async query => {
    assert.deepEqual(query, { windowId: 10 });
    return tabs.filter(tab => tab.windowId === query.windowId);
  }) as typeof chrome.tabs.query;
  for (const [action, url] of chromePageTargets) {
    tabs[3].url = url;
    await perform({ action, windowId: 10, query: 'chrome pages' });
  }
  assert.deepEqual(calls, chromePageTargets.map(([, url]) => ['create', { windowId: 10, url }]));
  assert.deepEqual(new Set(usage.map(record => record.target)), new Set(chromePageTargets.map(([action]) => `command:${action}`)));
});

test('Chrome Pages reuse the exact destination in the source window, including pending navigation', async () => {
  for (const [action, url] of chromePageTargets) {
    tabs[0].url = url;
    await perform({ action, windowId: 10 });
    assert.deepEqual(calls.pop(), ['update', 1, { active: true }]);
    tabs[0].url = 'chrome://version/'; tabs[0].pendingUrl = url;
    await perform({ action, windowId: 10 });
    assert.deepEqual(calls.pop(), ['update', 1, { active: true }]);
    delete tabs[0].pendingUrl;
  }
  assert.equal(calls.length, 0);
  tabs[0].url = 'chrome://extensions';
  await perform({ action: 'openExtensions', windowId: 10 });
  assert.deepEqual(calls, [['update', 1, { active: true }]]);
});

test('Chrome Pages preserve subpages, searches, details and tabs navigating away', async () => {
  for (const url of ['chrome://extensions/shortcuts', 'chrome://extensions/?id=zing', 'chrome://extensions/?q=zing', 'chrome://extensions/#detail']) {
    tabs[0].url = url;
    await perform({ action: 'openExtensions', windowId: 10 });
    assert.deepEqual(calls.pop(), ['create', { windowId: 10, url: 'chrome://extensions/' }]);
  }
  tabs[0].url = 'chrome://extensions/'; tabs[0].pendingUrl = 'https://example.com/';
  await perform({ action: 'openExtensions', windowId: 10 });
  assert.deepEqual(calls, [['create', { windowId: 10, url: 'chrome://extensions/' }]]);
});

test('Chrome Pages revalidate candidates that closed, moved or navigated after the query', async () => {
  tabs[0].url = 'chrome://extensions/';
  for (const state of ['closed', 'moved', 'navigated']) {
    chrome.tabs.get = (async () => {
      if (state === 'closed') throw new Error('No tab');
      return { ...tabs[0], ...(state === 'moved' ? { windowId: 20 } : { url: 'chrome://extensions/shortcuts' }) };
    }) as typeof chrome.tabs.get;
    await perform({ action: 'openExtensions', windowId: 10 });
    assert.deepEqual(calls.pop(), ['create', { windowId: 10, url: 'chrome://extensions/' }]);
  }
});

test('Chrome Pages prefer an already active exact match and do not train on failure or private windows', async () => {
  tabs[0].url = tabs[1].url = 'chrome://extensions/';
  await perform({ action: 'openExtensions', windowId: 10 });
  assert.deepEqual(calls, [['update', 2, { active: true }]]);
  usage = []; calls = [];
  chrome.tabs.update = async () => { throw new Error('Cannot activate tab'); };
  await assert.rejects(perform({ action: 'openExtensions', windowId: 10 }), /Cannot activate/);
  chrome.tabs.create = async () => { throw new Error('Cannot create tab'); };
  await assert.rejects(perform({ action: 'openPasswords', windowId: 10 }), /Cannot create/);
  assert.deepEqual(usage, []);
  assert.deepEqual(calls, []);
  chrome.tabs.update = (async id => { calls.push(['update', id]); return tabs[1]; }) as typeof chrome.tabs.update;
  chrome.windows.get = async () => ({ id: 10, incognito: true }) as chrome.windows.Window;
  await perform({ action: 'openExtensions', windowId: 10 });
  assert.deepEqual(usage, []);
});

test('restore uses the latest session and reports an empty session list', async () => {
  await perform({ action: 'restore', windowId: 10 });
  assert.deepEqual(calls, [['restore', 'session']]);
  chrome.sessions.getRecentlyClosed = async () => [];
  await assert.rejects(perform({ action: 'restore', windowId: 10 }), /No recently closed/);
});
test('extension reload validates the window and needs no target tab', async () => {
  chrome.runtime = { getURL: path => `chrome-extension://zing/${path}`, reload: () => { calls.push(['extensionReload']); } } as typeof chrome.runtime;
  chrome.tabs.query = async () => [];
  await perform({ action: 'reloadExtension', windowId: 10 }, () => { calls.push(['ack']); });
  assert.deepEqual(calls, [['ack'], ['extensionReload']]);
  assert.deepEqual(usage, []);
  calls = [];
  chrome.windows.get = async () => { throw new Error('Invalid window'); };
  await assert.rejects(perform({ action: 'reloadExtension', windowId: 10 }), /Invalid window/);
  assert.deepEqual(calls, []);
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

test('searching zed again after switching tabs retains its learned marker, including the now active tab', async () => {
  Object.assign(tabs[0], { title: 'Zed', url: 'https://zed.example/' });
  chrome.tabs.update = (async (id: number, changes: chrome.tabs.UpdateProperties) => {
    calls.push(['update', id, changes]);
    const selected = tabs.find(tab => tab.id === id)!;
    if (changes.active) for (const tab of tabs.filter(tab => tab.windowId === selected.windowId)) tab.active = tab.id === id;
    return { ...selected };
  }) as typeof chrome.tabs.update;
  const selected = search(entries(await snapshot(tabs[1])), 'zed')[0];
  assert.equal(selected.tabId, 1);
  assert.equal(selected.action, 'switch');
  await perform({ action: 'switch', tabId: selected.tabId, url: selected.url, windowId: 10, query: 'zed' });
  assert.equal(tabs[0].active, true);
  assert.equal(tabs[1].active, false);
  assert.deepEqual(usage.map(({ query, target, weight }) => ({ query, target, weight })),
    [{ query: 'zed', target: 'tab:https://zed.example/', weight: 1 }]);

  const reopened = entries(await snapshot(tabs[0]));
  const scores = queryUsage(usage, 'zed');
  const baseline = search(reopened, 'zed');
  const ranked = search(reopened, 'zed', scores);
  assert.equal(ranked[0].tabId, 1);
  assert.equal(ranked[0].active, true);
  // A sole result still displays a learned marker even when its position cannot improve.
  assert.deepEqual(rankingInfo(ranked, baseline, scores).get('tab:1'), { learned: true, promoted: false });
});

test('settings sections learn independently and preserve the generic settings target', async () => {
  for (const settingsSection of ['language', 'theme', 'keyboard', 'ranking', 'tabs'] as const) {
    await perform({ action: 'settings', windowId: 10, settingsSection, query: ' Preferences ' });
    await perform({ action: 'settings', windowId: 10, settingsSection });
  }
  await perform({ action: 'settings', windowId: 10, query: 'preferences' });
  await perform({ action: 'settings', windowId: 10 });
  assert.equal(usage.length, 12);
  for (const target of ['command:settings', 'command:settings:language', 'command:settings:theme', 'command:settings:keyboard', 'command:settings:ranking', 'command:settings:tabs']) {
    assert.deepEqual(usage.filter(record => record.target === target).map(({ query, weight }) => ({ query, weight }))
      .sort((a, b) => a.query.localeCompare(b.query)), [{ query: '', weight: 1 }, { query: 'preferences', weight: 1 }]);
  }
  assert.deepEqual(calls, []);
});

test('settings reject unknown sections at runtime without recording or acknowledging success', async () => {
  let acknowledged = false;
  for (const settingsSection of ['', 'Language', 'unknown', null, 42, false, [], {}, ['theme']]) {
    await assert.rejects(perform({ action: 'settings', windowId: 10, settingsSection } as never,
      () => { acknowledged = true; }), /Unsupported/);
  }
  assert.equal(acknowledged, false);
  assert.deepEqual(usage, []);
  assert.deepEqual(calls, []);
});

test('settings do not learn in private or unavailable windows', async () => {
  chrome.windows.get = async () => ({ id: 10, incognito: true }) as chrome.windows.Window;
  await perform({ action: 'settings', windowId: 10, settingsSection: 'theme', query: 'theme' });
  await perform({ action: 'settings', windowId: 10 });
  chrome.windows.get = async () => { throw new Error('No window'); };
  await assert.rejects(perform({ action: 'settings', windowId: 10, settingsSection: 'theme' }), /No window/);
  assert.deepEqual(usage, []);
});

test('ranking deletion cannot execute or train through perform', async () => {
  await assert.rejects(perform({ action: 'forgetUsage', windowId: 10, tabId: 2 } as never), /Unsupported/);
  assert.deepEqual(usage, []);
  assert.deepEqual(calls, []);
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
