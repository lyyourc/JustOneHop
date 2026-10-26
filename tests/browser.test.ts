import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { historyWindow, perform, searchHistory, snapshot } from '../src/browser.ts';
import { queryUsage, rankingInfo, type UsageRecord, USAGE_STORAGE_KEY } from '../src/usage.ts';
import { entries, search } from '../src/model.ts';
import { safeBookmarkUrl } from '../src/bookmarks.ts';
import { t } from '../src/i18n.ts';
import type { Execution } from '../src/types.ts';

let calls: [string, ...unknown[]][];
let tabs: chrome.tabs.Tab[];
let bookmarkUrl: string;
let usage: UsageRecord[];
const record = (name: string) => async (...args: unknown[]) => { calls.push([name, ...args]); };
beforeEach(() => {
  calls = []; bookmarkUrl = 'https://example.com'; usage = [];
  tabs = [
    { id: 1, index: 0, windowId: 10, pinned: true, active: false, title: 'Pinned', url: 'https://pinned.example' },
    { id: 2, index: 1, windowId: 10, pinned: false, active: true, mutedInfo: { muted: false }, title: 'Active', url: 'https://source.example/' },
    { id: 3, index: 2, windowId: 10, pinned: false, active: false, title: 'Right' },
    { id: 4, index: 0, windowId: 20, pinned: false, active: true, title: 'Other window' },
  ] as chrome.tabs.Tab[];
  globalThis.chrome = {
    runtime: { id: 'justonehop', getURL: (path: string) => `chrome-extension://justonehop/${path}` },
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
    tabGroups: { query: async () => [], get: async (id: number) => ({ id, windowId: 10 }) },
    commands: { getAll: async () => [{ name: 'toggle-palette', shortcut: '⌘⇧P' }] },
    sessions: { getRecentlyClosed: async () => [{ tab: { sessionId: 'session' } }], restore: record('restore') },
  } as unknown as typeof chrome;
});
test('ungroupGroup removes the group and keeps every tab without learning', async () => {
  tabs[1].groupId = tabs[2].groupId = 7;
  chrome.tabs.ungroup = record('ungroup');
  await perform({ action: 'ungroupGroup', windowId: 10, groupId: 7, query: 'Research' });
  assert.deepEqual(calls, [['ungroup', [2, 3]]]);
  assert.deepEqual(usage, []);
});

test('closeGroup closes only confirmed members and protects pinned tabs without learning', async () => {
  for (const tab of tabs.slice(0, 3)) tab.groupId = 7;
  const outcome = await perform({ action: 'closeGroup', windowId: 10, groupId: 7, groupTabIds: [3, 1, 2], query: 'Research' });
  assert.equal(outcome?.message, 'Tabs closed: 2 · Pinned tabs kept: 1');
  assert.deepEqual(calls, [['remove', 2], ['remove', 3]]);
  assert.deepEqual(usage, []);
});

test('closeGroup rejects changed membership, invalid confirmation and foreign groups before deleting', async () => {
  tabs[1].groupId = tabs[2].groupId = 7;
  for (const groupTabIds of [undefined, [], [2], [2, 3, 99], [2, 2], [2, NaN]]) {
    await assert.rejects(perform({ action: 'closeGroup', windowId: 10, groupId: 7, groupTabIds }));
  }
  for (const action of ['closeGroup', 'ungroupGroup'] as const) {
    await assert.rejects(perform({ action, windowId: 20, groupId: 7, groupTabIds: [2, 3] }), { message: t('errorGroup') });
  }
  assert.deepEqual(calls, []);
});

test('closeGroup rechecks each member and reports partial completion if a later tab moves', async () => {
  tabs[1].groupId = tabs[2].groupId = 7;
  chrome.tabs.remove = async ids => { calls.push(['remove', ids]); tabs[2].groupId = 8; };
  await assert.rejects(perform({ action: 'closeGroup', windowId: 10, groupId: 7, groupTabIds: [2, 3] }), { message: t('errorGroupPartialCount', ['1', '1']) });
  assert.deepEqual(calls, [['remove', 2]]);
});

test('closeGroup protects a member pinned after the initial membership check', async () => {
  tabs[1].groupId = tabs[2].groupId = 7;
  const get = chrome.tabs.get;
  chrome.tabs.get = async id => ({ ...await get(id), pinned: id === 3 });
  await perform({ action: 'closeGroup', windowId: 10, groupId: 7, groupTabIds: [2, 3] });
  assert.deepEqual(calls, [['remove', 2]]);
});

const historySender = (): chrome.runtime.MessageSender => ({ id: 'justonehop', url: 'chrome-extension://justonehop/popup.html' });

function bookmarkStore(initial: Partial<chrome.bookmarks.BookmarkTreeNode>[] = []) {
  const nodes = structuredClone(initial) as chrome.bookmarks.BookmarkTreeNode[];
  const find = (items: chrome.bookmarks.BookmarkTreeNode[], id: string): chrome.bookmarks.BookmarkTreeNode | undefined => {
    for (const item of items) {
      if (item.id === id) return item;
      const child = find(item.children || [], id);
      if (child) return child;
    }
  };
  chrome.bookmarks.getTree = async () => structuredClone(nodes);
  chrome.bookmarks.get = (async (id: string) => {
    const node = find(nodes, id);
    return node ? [structuredClone(node)] : [];
  }) as typeof chrome.bookmarks.get;
  chrome.bookmarks.create = async details => {
    calls.push(['bookmarkCreate', details]);
    const node = { ...details, id: `new-${nodes.length}`, syncing: false } as chrome.bookmarks.BookmarkTreeNode;
    nodes.push(node);
    return structuredClone(node);
  };
  chrome.bookmarks.remove = async id => {
    calls.push(['bookmarkRemove', id]);
    const remove = (items: chrome.bookmarks.BookmarkTreeNode[]) => {
      const index = items.findIndex(item => item.id === id);
      if (index >= 0) items.splice(index, 1);
      else for (const item of items) remove(item.children || []);
    };
    remove(nodes);
  };
  tabs[1].url = 'https://example.com';
  return nodes;
}
const bookmarkExecution = (action: 'bookmarkTab' | 'unbookmarkTab', bookmarkIds?: string[]): Execution => ({
  action, tabId: 2, windowId: 10, expectedUrl: 'https://example.com', ...(bookmarkIds ? { bookmarkIds } : {}),
});
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

const addressExecution = (action: 'navigateAddress' | 'openAddressNewTab'): Execution => ({
  action, tabId: 2, windowId: 10, expectedUrl: 'https://source.example/', url: 'https://destination.example/path?q=one#two', query: 'destination.example',
});

for (const action of ['navigateAddress', 'openAddressNewTab'] as const) {
  test(`${action} uses the exact source and destination and remembers only the query`, async () => {
    tabs[1].url = 'https://source.example/';
    tabs[1].pendingUrl = tabs[1].url;
    let acknowledged = 0;
    await perform(addressExecution(action), () => { acknowledged++; });
    assert.deepEqual(calls, action === 'navigateAddress'
      ? [['update', 2, { url: 'https://destination.example/path?q=one#two' }]]
      : [['create', { windowId: 10, url: 'https://destination.example/path?q=one#two', active: true }]]);
    assert.equal(acknowledged, 1);
    assert.equal(usage.length, 1);
    assert.equal(usage[0].query, 'destination.example');
    assert.equal(usage[0].target, 'query:navigation');
  });

  test(`${action} rejects malformed requests without acknowledgement or learning`, async () => {
    tabs[1].url = 'https://source.example/';
    const patches: Partial<Execution>[] = [
      ...[undefined, '', 'destination.example', 'https://destination.example', 'HTTPS://destination.example/',
        ' https://destination.example/', 'https://destination.example/ ', 'https://user:secret@destination.example/',
        'https://destination.example/a\nb', 'https://destination.example/\\\\bad', 'http://', 'https://bad_host/',
        'javascript:alert(1)', 'data:text/html,hello', 'chrome://settings/', 'file:///tmp/a', 'ftp://example.com/']
        .map(url => ({ url })),
      ...[undefined, NaN, 2.5, '2' as unknown as number].map(tabId => ({ tabId })),
      ...[undefined, '', 42 as unknown as string].map(expectedUrl => ({ expectedUrl })),
    ];
    let acknowledged = 0;
    for (const patch of patches) {
      await assert.rejects(perform({ ...addressExecution(action), ...patch }, () => { acknowledged++; }), { message: t('errorInvalidRequest') });
    }
    assert.deepEqual(calls, []);
    assert.equal(acknowledged, 0);
    assert.deepEqual(usage, []);
  });

  test(`${action} rejects stale, inactive, moved, missing and mismatched sources`, async () => {
    const original = { ...tabs[1], url: 'https://source.example/' };
    let acknowledged = 0;
    for (const patch of [{ active: false }, { windowId: 20 }, { url: 'https://changed.example/' },
      { url: undefined }, { pendingUrl: 'https://pending.example/' }]) {
      tabs[1] = { ...original, ...patch };
      await assert.rejects(perform(addressExecution(action), () => { acknowledged++; }), { message: t('errorTabChanged') });
    }
    tabs[1] = original;
    await assert.rejects(perform({ ...addressExecution(action), tabId: 999 }, () => { acknowledged++; }), /No tab/);
    chrome.tabs.get = async () => ({ ...original, id: 99 });
    await assert.rejects(perform(addressExecution(action), () => { acknowledged++; }), { message: t('errorTabChanged') });
    assert.deepEqual(calls, []);
    assert.equal(acknowledged, 0);
    assert.deepEqual(usage, []);
  });

  test(`${action} does not acknowledge or learn when Chrome navigation fails`, async () => {
    tabs[1].url = 'https://source.example/';
    const failure = async () => { throw new Error('Navigation failed'); };
    chrome.tabs.update = failure;
    chrome.tabs.create = failure;
    let acknowledged = 0;
    await assert.rejects(perform(addressExecution(action), () => { acknowledged++; }), /Navigation failed/);
    assert.equal(acknowledged, 0);
    assert.deepEqual(usage, []);
  });
}

for (const action of ['openBookmark', 'openHistoryPage'] as const) {
  test(`${action} opens a new active tab and learns its original identity`, async () => {
    await perform({ ...addressExecution('navigateAddress'), action, bookmarkId: 'b', newTab: true });
    const url = action === 'openBookmark' ? bookmarkUrl : addressExecution('navigateAddress').url;
    assert.deepEqual(calls, [['create', { windowId: 10, url, active: true }]]);
    assert.equal(usage[0].target, action === 'openBookmark' ? 'bookmark:b' : `tab:${url}`);
  });

  test(`${action} protects pinned and changed sources in both opening modes`, async () => {
    const payload = { ...addressExecution('navigateAddress'), action, bookmarkId: 'b' };
    tabs[1].pinned = true;
    await assert.rejects(perform(payload), { message: t('errorPinned') });
    await perform({ ...payload, newTab: true });
    calls = []; usage = [];
    const original = { ...tabs[1], pinned: false };
    for (const newTab of [false, true]) {
      for (const patch of [{ active: false }, { windowId: 20 }, { url: 'https://changed.example/' }, { pendingUrl: 'https://pending.example/' }]) {
        tabs[1] = { ...original, ...patch };
        await assert.rejects(perform({ ...payload, newTab }), { message: t('errorTabChanged') });
      }
      tabs[1] = original;
      await assert.rejects(perform({ ...payload, newTab, tabId: undefined }));
      await assert.rejects(perform({ ...payload, newTab, expectedUrl: undefined }));
    }
    assert.deepEqual(calls, []);
    assert.deepEqual(usage, []);
  });
}

test('successful web searches supply completion records but incognito and omitted queries do not', async () => {
  await perform({ ...addressExecution('openAddressNewTab'), query: 'react hooks', url: 'https://www.google.com/search?q=react+hooks' });
  assert.equal(usage[0].query, 'react hooks');
  assert.equal(usage[0].target, 'query:navigation');
  usage = [];
  await perform({ ...addressExecution('openAddressNewTab'), query: undefined });
  assert.deepEqual(usage, []);
  chrome.windows.get = (async (id: number) => ({ id, incognito: true })) as typeof chrome.windows.get;
  await perform(addressExecution('openAddressNewTab'));
  assert.deepEqual(usage, []);
});

test('address navigation protects pinned sources while allowing an active new tab', async () => {
  Object.assign(tabs[1], { url: 'https://source.example/', pinned: true });
  await assert.rejects(perform(addressExecution('navigateAddress')), { message: t('errorPinned') });
  assert.deepEqual(calls, []);
  assert.equal(usage.length, 0);
  await perform({ ...addressExecution('openAddressNewTab'), url: 'http://localhost:3000/' });
  assert.deepEqual(calls, [['create', { windowId: 10, url: 'http://localhost:3000/', active: true }]]);
  assert.equal(usage.length, 1);
  assert.equal(usage[0].target, 'query:navigation');
});

test('bookmark item removal deletes only the selected ID without requiring an open tab', async () => {
  bookmarkStore([
    { id: 'selected', title: 'Selected', url: 'https://example.com' },
    { id: 'duplicate', title: 'Managed duplicate', url: 'https://example.com', unmodifiable: 'managed' },
  ]);
  await snapshot(tabs[1]);
  chrome.tabs.get = async () => { throw new Error('No open tab required'); };
  await perform({ action: 'removeBookmark', windowId: 10, bookmarkId: 'selected', expectedUrl: 'https://example.com' });
  assert.deepEqual(calls, [['bookmarkRemove', 'selected']]);
  assert.deepEqual((await chrome.bookmarks.getTree()).map(item => item.id), ['duplicate']);
  assert.ok(usage.some(item => item.target === 'command:removeBookmark'));
  assert.ok(!usage.some(item => item.target === 'bookmark:selected'));
});

test('bookmark item removal refuses stale IDs, changed URLs and managed ancestors', async () => {
  const nodes = bookmarkStore([
    { id: 'selected', title: 'Selected', url: 'https://changed.example' },
    { id: 'managed', unmodifiable: 'managed', children: [{ id: 'child', title: 'Managed child', url: 'https://example.com' } as chrome.bookmarks.BookmarkTreeNode] },
  ]);
  for (const bookmarkId of ['selected', 'missing', 'managed', '']) {
    await assert.rejects(perform({ action: 'removeBookmark', windowId: 10, bookmarkId, expectedUrl: 'https://example.com' }), { message: t('errorBookmarkChanged') });
  }
  await assert.rejects(perform({ action: 'removeBookmark', windowId: 10, bookmarkId: 'child', expectedUrl: 'https://example.com' }), { message: t('errorBookmarkItemManaged') });
  assert.equal(nodes.length, 2);
  assert.deepEqual(calls, []);
  assert.deepEqual(usage, []);
});

test('bookmark item removal failures do not learn and private removal leaves duplicates intact', async () => {
  bookmarkStore([{ id: 'selected', title: 'Selected', url: 'https://example.com' }, { id: 'other', title: 'Other', url: 'https://example.com' }]);
  const remove = chrome.bookmarks.remove;
  chrome.bookmarks.remove = async () => { throw new Error('Write failed'); };
  const request: Execution = { action: 'removeBookmark', windowId: 10, bookmarkId: 'selected', expectedUrl: 'https://example.com' };
  await assert.rejects(perform(request), { message: t('errorBookmarkWrite') });
  assert.deepEqual(usage, []);
  chrome.bookmarks.remove = remove;
  chrome.windows.get = (async () => ({ id: 10, incognito: true, focused: true, alwaysOnTop: false })) as typeof chrome.windows.get;
  await perform(request);
  assert.deepEqual((await chrome.bookmarks.getTree()).map(item => item.id), ['other']);
  assert.deepEqual(usage, []);
});

test('bookmark URL validation shares the opening protocol policy and rejects malformed input', async () => {
  for (const url of ['https://example.com', 'http://example.com', 'file:///tmp/a', 'ftp://example.com', 'chrome://settings/']) assert.equal(safeBookmarkUrl(url), true);
  for (const url of [undefined, '', 'invalid', 'javascript:alert(1)', 'data:text/html,a', ' https://example.com', 'https://exa\nmple.com']) {
    assert.equal(safeBookmarkUrl(url), false);
    bookmarkUrl = url as string;
    await assert.rejects(perform({ action: 'openBookmark', windowId: 10, tabId: 2, expectedUrl: 'https://source.example/', bookmarkId: 'b' }), { message: t('errorBookmarkUrl') });
  }
});

test('bookmark creation uses live title, native destination and exact live URL deduplication', async () => {
  bookmarkStore([{ id: 'different', title: 'Other', url: 'https://example.com/' }]);
  await snapshot(tabs[1]);
  tabs[1].title = 'Live title';
  assert.equal((await perform(bookmarkExecution('bookmarkTab')))?.message, 'Bookmark added');
  assert.deepEqual(calls, [['bookmarkCreate', { title: 'Live title', url: 'https://example.com' }]]);
  assert.equal((await snapshot(tabs[1])).bookmarks.length, 2);
  assert.equal((await perform(bookmarkExecution('bookmarkTab')))?.message, 'Page already bookmarked');
  assert.equal(calls.length, 1);
  assert.ok(usage.some(item => item.target === 'command:bookmarkTab'));
});

test('concurrent bookmark requests serialize before live reads and cannot create duplicates', async () => {
  bookmarkStore();
  const started = gate(); const blocked = gate();
  const create = chrome.bookmarks.create;
  chrome.bookmarks.create = async details => { started.release(); await blocked.promise; return create(details); };
  const first = perform(bookmarkExecution('bookmarkTab'));
  await started.promise;
  const second = perform(bookmarkExecution('bookmarkTab'));
  blocked.release();
  await Promise.all([first, second]);
  assert.equal(calls.filter(([name]) => name === 'bookmarkCreate').length, 1);
});

test('queued bookmark writes reread navigation, window and group context after the preceding write', async () => {
  for (const patch of [{ url: 'https://changed.example' }, { pendingUrl: 'https://changed.example' }, { windowId: 20 }, { groupId: 9 }]) {
    bookmarkStore(); Object.assign(tabs[1], { url: 'https://example.com', pendingUrl: undefined, windowId: 10, groupId: 7 });
    const started = gate(); const blocked = gate();
    const create = chrome.bookmarks.create;
    chrome.bookmarks.create = async details => { started.release(); await blocked.promise; return create(details); };
    const first = perform(bookmarkExecution('bookmarkTab'));
    await started.promise;
    const second = assert.rejects(perform({ ...bookmarkExecution('bookmarkTab'), groupId: 7 }));
    Object.assign(tabs[1], patch);
    blocked.release(); await Promise.all([first, second]);
  }
  assert.equal(calls.filter(([name]) => name === 'bookmarkCreate').length, 4);
});

test('bookmark queue is isolated by API instance and a failed write does not poison it', async () => {
  bookmarkStore();
  const started = gate(); const blocked = gate();
  chrome.bookmarks.create = async () => { started.release(); await blocked.promise; throw new Error('sensitive backend detail'); };
  const first = assert.rejects(perform(bookmarkExecution('bookmarkTab')), { message: t('errorBookmarkWrite') });
  await started.promise;
  chrome.bookmarks = {} as typeof chrome.bookmarks;
  bookmarkStore();
  await perform(bookmarkExecution('bookmarkTab'));
  blocked.release(); await first;
  const nodes = bookmarkStore();
  const create = chrome.bookmarks.create;
  chrome.bookmarks.create = async () => { throw new Error('backend detail'); };
  await assert.rejects(perform(bookmarkExecution('bookmarkTab')), { message: t('errorBookmarkWrite') });
  chrome.bookmarks.create = create;
  await perform(bookmarkExecution('bookmarkTab'));
  assert.equal(nodes.length, 1);
});

test('bookmark cancellation removes the complete observed set and repeated cancellation is idempotent', async () => {
  bookmarkStore([{ id: 'a', url: 'https://example.com' }, { id: 'b', url: 'https://example.com' }, { id: 'other', url: 'https://example.com/' }]);
  await snapshot(tabs[1]);
  assert.equal((await perform(bookmarkExecution('unbookmarkTab', ['b', 'a'])))?.message, 'Bookmarks removed: 2');
  assert.deepEqual(calls, [['bookmarkRemove', 'b'], ['bookmarkRemove', 'a']]);
  assert.deepEqual((await snapshot(tabs[1])).bookmarks.map(item => item.id), ['other']);
  assert.equal((await perform(bookmarkExecution('unbookmarkTab', ['b', 'a'])))?.message, 'Page is no longer bookmarked');
  assert.equal(calls.length, 2);
  assert.ok(usage.some(item => item.target === 'command:unbookmarkTab'));
});

test('bookmark cancellation refuses added, missing, retargeted or malformed observed IDs', async () => {
  for (const nodes of [
    [{ id: 'a', url: 'https://example.com' }, { id: 'b', url: 'https://example.com' }, { id: 'new', url: 'https://example.com' }],
    [{ id: 'a', url: 'https://example.com' }],
    [{ id: 'a', url: 'https://other.example' }],
    [{ id: 'a', children: [] }],
  ]) {
    bookmarkStore(nodes);
    await assert.rejects(perform(bookmarkExecution('unbookmarkTab', ['a', 'b'])), { message: t('errorBookmarkChanged') });
  }
  bookmarkStore([{ id: 'a', url: 'https://example.com' }]);
  for (const bookmarkIds of [undefined, [], ['a', 'a'], [''], [42]]) {
    await assert.rejects(perform({ ...bookmarkExecution('unbookmarkTab'), bookmarkIds } as Execution), { message: t('errorBookmarkChanged') });
  }
  assert.deepEqual(calls, []); assert.deepEqual(usage, []);
});

test('managed bookmarks and managed ancestors reject the entire cancellation and propagate to snapshots', async () => {
  for (const managed of [
    { id: 'managed', url: 'https://example.com', unmodifiable: 'managed' as const },
    { id: 'folder', title: 'Policy', unmodifiable: 'managed' as const, children: [{ id: 'managed', title: 'Managed', url: 'https://example.com', syncing: false }] },
  ]) {
    bookmarkStore([{ id: 'editable', url: 'https://example.com' }, managed]);
    await assert.rejects(perform(bookmarkExecution('unbookmarkTab', ['editable', 'managed'])), { message: t('errorBookmarkManaged') });
    assert.equal((await snapshot(tabs[1])).bookmarks.find(item => item.id === 'managed')?.unmodifiable, 'managed');
  }
  assert.deepEqual(calls, []);
});

test('bookmark cancellation rereads individual URLs before remove and stops on partial failure', async () => {
  bookmarkStore([{ id: 'a', url: 'https://example.com' }]);
  chrome.bookmarks.get = async () => [{ id: 'a', title: 'Changed', url: 'https://elsewhere.example', syncing: false }];
  await assert.rejects(perform(bookmarkExecution('unbookmarkTab', ['a'])), { message: t('errorBookmarkChanged') });
  assert.deepEqual(calls, []);
  bookmarkStore([{ id: 'a', url: 'https://example.com' }, { id: 'b', url: 'https://example.com' }, { id: 'c', url: 'https://example.com' }]);
  const remove = chrome.bookmarks.remove;
  chrome.bookmarks.remove = async id => {
    if (id === 'b') throw new Error('private failure detail');
    await remove(id);
  };
  await assert.rejects(perform(bookmarkExecution('unbookmarkTab', ['a', 'b', 'c'])), { message: t('errorBookmarkPartialCount', '1') });
  assert.deepEqual(calls, [['bookmarkRemove', 'a']]);
  assert.deepEqual(usage, []);
});

test('bookmark cancellation stops when a new duplicate appears between removals', async () => {
  const nodes = bookmarkStore([{ id: 'a', url: 'https://example.com' }, { id: 'b', url: 'https://example.com' }]);
  const remove = chrome.bookmarks.remove;
  chrome.bookmarks.remove = async id => {
    await remove(id);
    nodes.push({ id: 'new', title: 'New duplicate', url: 'https://example.com', syncing: false });
  };
  await assert.rejects(perform(bookmarkExecution('unbookmarkTab', ['a', 'b'])), { message: t('errorBookmarkPartialCount', '1') });
  assert.deepEqual(calls, [['bookmarkRemove', 'a']]);
});

test('bookmark writes revalidate optional group and navigation after live tree reads', async () => {
  bookmarkStore(); tabs[1].groupId = 7;
  chrome.tabGroups.get = async () => ({ id: 7, windowId: 20 }) as chrome.tabGroups.TabGroup;
  await assert.rejects(perform({ ...bookmarkExecution('bookmarkTab'), groupId: 7 }), { message: t('errorGroup') });
  chrome.tabGroups.get = async () => ({ id: 7, windowId: 10 }) as chrome.tabGroups.TabGroup;
  chrome.bookmarks.getTree = async () => { tabs[1].pendingUrl = 'https://away.example'; return []; };
  await assert.rejects(perform({ ...bookmarkExecution('bookmarkTab'), groupId: 7 }), { message: t('errorBookmarkChanged') });
  assert.deepEqual(calls, []);
});

test('bookmark cancellation reports a final concurrent duplicate as partial and invalidates cached snapshots', async () => {
  const nodes = bookmarkStore([{ id: 'a', url: 'https://example.com' }]);
  await snapshot(tabs[1]);
  const remove = chrome.bookmarks.remove;
  chrome.bookmarks.remove = async id => {
    await remove(id);
    nodes.push({ id: 'new', title: 'New duplicate', url: 'https://example.com', syncing: false });
  };
  await assert.rejects(perform(bookmarkExecution('unbookmarkTab', ['a'])), { message: t('errorBookmarkPartialCount', '1') });
  assert.deepEqual((await snapshot(tabs[1])).bookmarks.map(item => item.id), ['new']);
  assert.deepEqual(usage, []);
});

test('queued bookmark writes reread the originating window and preserve fixed errors', async () => {
  bookmarkStore();
  const started = gate(); const blocked = gate();
  const create = chrome.bookmarks.create;
  chrome.bookmarks.create = async details => { started.release(); await blocked.promise; return create(details); };
  const first = perform(bookmarkExecution('bookmarkTab'));
  await started.promise;
  const second = assert.rejects(perform(bookmarkExecution('bookmarkTab')), { message: t('errorWindow') });
  chrome.windows.get = async () => { throw new Error('private window detail'); };
  blocked.release(); await Promise.all([first, second]);
  assert.equal(calls.length, 1);
});

test('bookmark writes reject stale or unsafe URLs and never learn failed or private actions', async () => {
  bookmarkStore();
  for (const expectedUrl of [undefined, 'javascript:alert(1)', 'https://stale.example']) {
    await assert.rejects(perform({ ...bookmarkExecution('bookmarkTab'), expectedUrl }));
  }
  tabs[1].pendingUrl = 'https://away.example';
  await assert.rejects(perform(bookmarkExecution('bookmarkTab')), { message: t('errorBookmarkChanged') });
  assert.deepEqual(calls, []); assert.deepEqual(usage, []);
  tabs[1].pendingUrl = tabs[1].url;
  tabs[1].incognito = true;
  await perform(bookmarkExecution('bookmarkTab'));
  assert.equal(calls.length, 1); assert.deepEqual(usage, []);
  tabs[1].incognito = false;
  chrome.windows.get = async () => ({ id: 10, incognito: true }) as chrome.windows.Window;
  await perform(bookmarkExecution('unbookmarkTab', ['new-0']));
  assert.deepEqual(usage, []);
});

test('literal history reads are uncached, bounded to 100 and use explicit week/all start times', async () => {
  const searches: chrome.history.HistoryQuery[] = [];
  chrome.history.search = async query => { searches.push(query); return []; };
  const before = Date.now() - 7 * 24 * 60 * 60 * 1000;
  assert.deepEqual(await searchHistory({ query: 'guide', scope: 'week' }, historySender()), { items: [], limited: false });
  const after = Date.now() - 7 * 24 * 60 * 60 * 1000;
  await searchHistory({ query: 'guide', scope: 'week' }, historySender());
  await searchHistory({ query: 'guide', scope: 'all' }, historySender());
  assert.equal(searches.length, 6);
  assert.equal(searches[0].text, 'guide');
  assert.equal(searches[0].maxResults, 100);
  assert.ok(searches[0].startTime! >= before && searches[0].startTime! <= after);
  assert.deepEqual(searches[1], { text: '', startTime: searches[0].startTime, maxResults: 1000 });
  assert.deepEqual(searches[4], { text: 'guide', startTime: 0, maxResults: 100 });
  assert.deepEqual(searches[5], { text: '', startTime: 0, maxResults: 1000 });
  assert.deepEqual(usage, []);
});

test('history supplements native literal hits with bounded pinyin recall and ranks before truncation', async () => {
  const literal = { id: 'literal', title: 'CPLXT', url: 'https://literal.example', lastVisitTime: 1 };
  const chinese = { id: 'chinese', title: '产品路线图', url: 'https://chinese.example', lastVisitTime: 2 };
  const searches: chrome.history.HistoryQuery[] = [];
  chrome.history.search = async query => {
    searches.push(query);
    return query.text ? [literal] : [literal, chinese,
      ...Array.from({ length: 998 }, (_, i) => ({ id: `other-${i}`, title: 'Unrelated', url: `https://example.com/${i}` }))];
  };
  const result = await searchHistory({ query: 'cplxt', scope: 'all' }, historySender());
  assert.deepEqual(result.items.map(item => item.id), ['literal', 'chinese']);
  assert.equal(result.limited, true);
  assert.deepEqual(searches, [{ text: 'cplxt', startTime: 0, maxResults: 100 }, { text: '', startTime: 0, maxResults: 1000 }]);
  chrome.history.search = async query => query.text ? [] : [chinese];
  assert.deepEqual((await searchHistory({ query: 'chanpinluxiantu', scope: 'week' }, historySender())).items.map(item => item.id), ['chinese']);
  assert.deepEqual((await searchHistory({ query: 'chanpin missing', scope: 'all' }, historySender())).items, []);
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
  const overlay = { id: 'justonehop', tab: { ...tabs[1] }, url: tabs[1].url, frameId: 0 };
  assert.equal(await historyWindow(overlay), 10);
  for (const sender of [
    { ...historySender(), id: 'other-extension' },
    { ...historySender(), url: 'chrome-extension://justonehop/help.html' },
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
  await perform({ action: 'openHistoryPage', windowId: 10, tabId: 2, expectedUrl: 'https://source.example/', url: 'https://g.echo.tech/c2c-web?q=one#two', query: ' C2C-web ' });
  assert.deepEqual(calls, [['update', 2, { url: 'https://g.echo.tech/c2c-web?q=one#two' }]]);
  assert.equal(usage.length, 1);
  assert.equal(usage[0].query, 'c2c-web');
  assert.equal(usage[0].target, 'tab:https://g.echo.tech/c2c-web?q=one#two');
  assert.equal(usage[0].weight, 1);
});

test('history failures and blank queries do not create preferences', async () => {
  await perform({ action: 'openHistoryPage', windowId: 10, tabId: 2, expectedUrl: 'https://source.example/', url: 'https://example.com/', query: ' ' });
  chrome.tabs.update = async () => { throw new Error('Cannot navigate tab'); };
  await assert.rejects(perform({ action: 'openHistoryPage', windowId: 10, tabId: 2, expectedUrl: 'https://source.example/', url: 'https://example.com/', query: 'example' }));
  assert.deepEqual(usage, []);
});

test('history opening rejects unsafe URLs, malformed requests and private windows', async () => {
  for (const url of [undefined, 42, '', 'not a url', 'javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/test', 'chrome://history/', ' https://example.com', 'https://exa\nmple.com']) {
    await assert.rejects(perform({ action: 'openHistoryPage', windowId: 10, tabId: 2, expectedUrl: 'https://source.example/', url } as never));
  }
  await assert.rejects(perform({ action: 'openHistoryPage', windowId: '10', url: 'https://example.com/' } as never));
  chrome.windows.get = async () => ({ id: 10, incognito: true }) as chrome.windows.Window;
  await assert.rejects(perform({ action: 'openHistoryPage', windowId: 10, tabId: 2, expectedUrl: 'https://source.example/', url: 'https://example.com/' }));
  chrome.windows.get = async () => { throw new Error('No window'); };
  await assert.rejects(perform({ action: 'openHistoryPage', windowId: 10, tabId: 2, expectedUrl: 'https://source.example/', url: 'https://example.com/' }));
  assert.deepEqual(calls, []);
  assert.deepEqual(usage, []);
});

test('snapshot reads the actual forward switcher binding on each refresh and never invents one', async () => {
  for (const shortcut of ['Ctrl+J', 'Alt+Shift+Y', '']) {
    chrome.commands.getAll = async () => [
      { name: 'toggle-palette', shortcut: 'Ctrl+Shift+P' },
      { name: 'switch-recent-back', shortcut: 'Ctrl+Shift+J' },
      { name: 'switch-recent', shortcut },
    ];
    const value = await snapshot();
    assert.equal(value.shortcut, 'Ctrl+Shift+P');
    assert.equal(value.tabSwitcherShortcut, shortcut);
  }
  chrome.commands.getAll = async () => [{ name: 'switch-recent-back', shortcut: 'Ctrl+Shift+J' }];
  assert.equal((await snapshot()).tabSwitcherShortcut, '');
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
test('close right and others re-read live tabs and report closed and protected counts', async () => {
  assert.equal((await perform({ action: 'closeRight', windowId: 10, tabId: 2 }))?.message, 'Tabs closed: 1');
  assert.deepEqual(calls, [['remove', [3]]]);
  calls = [];
  assert.equal((await perform({ action: 'closeOthers', windowId: 10, tabId: 3 }))?.message, 'Tabs closed: 1 · Pinned tabs kept: 1');
  assert.deepEqual(calls, [['remove', [2]]]);
  calls = [];
  assert.equal((await perform({ action: 'closeRight', windowId: 10, tabId: 3 }))?.message, 'No tabs to close');
  tabs[2].pinned = true;
  assert.equal((await perform({ action: 'closeOthers', windowId: 10, tabId: 2 }))?.message, 'Tabs closed: 0 · Pinned tabs kept: 2');
  assert.deepEqual(calls, []);
});
test('failed batch close reports confirmed closures without counting moved tabs as closed', async () => {
  tabs.push({ ...tabs[2], id: 5, index: 3 });
  chrome.tabs.query = async query => tabs.filter(tab => query.windowId === undefined || tab.windowId === query.windowId);
  chrome.tabs.remove = async () => {
    tabs = tabs.filter(tab => tab.id !== 3);
    tabs.find(tab => tab.id === 5)!.windowId = 20;
    throw new Error('native failure');
  };
  await assert.rejects(perform({ action: 'closeRight', windowId: 10, tabId: 2 }), {
    message: 'Tabs closed: 1 · Tabs not closed: 1. The operation stopped; review the remaining tabs.',
  });
  assert.deepEqual(usage, []);
});
test('pin and mute report both directions from live state through callback and result', async () => {
  const outcomes: unknown[] = [];
  assert.equal((await perform({ action: 'pin', windowId: 10, tabId: 1 }, result => outcomes.push(result)))?.message, 'Tab unpinned');
  assert.equal((await perform({ action: 'mute', windowId: 10, tabId: 2 }, result => outcomes.push(result)))?.message, 'Tab muted');
  assert.deepEqual(calls, [['update', 1, { pinned: false }], ['update', 2, { muted: true }]]);
  assert.deepEqual(outcomes, [{ message: 'Tab unpinned' }, { message: 'Tab muted' }]);
  tabs[1].mutedInfo = { muted: true };
  assert.equal((await perform({ action: 'pin', windowId: 10, tabId: 2 }))?.message, 'Tab pinned');
  assert.equal((await perform({ action: 'mute', windowId: 10, tabId: 2 }))?.message, 'Tab unmuted');
});
test('bookmark URL is resolved by ID and scripts are not executed', async () => {
  bookmarkUrl = 'javascript:alert(1)';
  await assert.rejects(perform({ action: 'openBookmark', windowId: 10, tabId: 2, expectedUrl: 'https://source.example/', bookmarkId: 'b' }), /Script bookmarks/);
  assert.equal(calls.length, 0);
});
test('bookmark navigates the source tab using its live bookmarked URL', async () => {
  await perform({ action: 'openBookmark', windowId: 10, tabId: 2, expectedUrl: 'https://source.example/', bookmarkId: 'b' });
  assert.deepEqual(calls, [['update', 2, { url: 'https://example.com' }]]);
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
  for (const url of ['chrome://extensions/shortcuts', 'chrome://extensions/?id=justonehop', 'chrome://extensions/?q=justonehop', 'chrome://extensions/#detail']) {
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
  chrome.runtime = { getURL: path => `chrome-extension://justonehop/${path}`, reload: () => { calls.push(['extensionReload']); } } as typeof chrome.runtime;
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
  await perform({ action: 'openBookmark', windowId: 10, tabId: 2, expectedUrl: 'https://source.example/', bookmarkId: 'b', query: 'guide' });
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
  for (const settingsSection of ['language', 'theme', 'keyboard', 'binding', 'ranking', 'tabs'] as const) {
    await perform({ action: 'settings', windowId: 10, settingsSection, query: ' Preferences ' });
    await perform({ action: 'settings', windowId: 10, settingsSection });
  }
  await perform({ action: 'settings', windowId: 10, query: 'preferences' });
  await perform({ action: 'settings', windowId: 10 });
  assert.equal(usage.length, 14);
  for (const target of ['command:settings', 'command:settings:language', 'command:settings:theme', 'command:settings:keyboard', 'command:settings:binding', 'command:settings:ranking', 'command:settings:tabs']) {
    assert.deepEqual(usage.filter(record => record.target === target).map(({ query, weight }) => ({ query, weight }))
      .sort((a, b) => a.query.localeCompare(b.query)), [{ query: '', weight: 1 }, { query: 'preferences', weight: 1 }]);
  }
  assert.deepEqual(calls, []);
});

test('settings reject unknown sections at runtime without recording or acknowledging success', async () => {
  let acknowledged = false;
  for (const settingsSection of ['', 'Language', 'unknown']) {
    await assert.rejects(perform({ action: 'settings', windowId: 10, settingsSection: settingsSection as never },
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

test('home page choices train while unqueried navigation and private windows do not', async () => {
  await perform({ action: 'switch', windowId: 10, tabId: 1 });
  await perform({ action: 'openBookmark', windowId: 10, tabId: 2, expectedUrl: 'https://source.example/', bookmarkId: 'b' });
  assert.equal(usage.length, 0);
  await perform({ action: 'switch', windowId: 10, tabId: 1, query: '' });
  assert.ok(usage.some(record => record.query === '' && record.target === `tab:${tabs[0].url}`));
  await perform({ action: 'openBookmark', windowId: 10, tabId: 2, expectedUrl: 'https://source.example/', bookmarkId: 'b', query: '' });
  assert.ok(usage.some(record => record.query === '' && record.target === 'bookmark:b'));
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
