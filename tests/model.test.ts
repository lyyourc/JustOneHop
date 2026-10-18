import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionsFor, bookmarkTabAction, closeTargets, entries, homeEntries, homeRecommendations, matchingAlias, search } from '../src/model.ts';
import type { BookmarkItem, Snapshot, TabItem } from '../src/types.ts';
import { t } from '../src/i18n.ts';
import { entryTitle } from '../src/entryPresentation.ts';
import { usageTarget } from '../src/usage.ts';

const tab = (id: number, index: number, pinned = false, windowId = 1): TabItem => ({
  id, index, windowId, pinned, title: `Page ${id}`, url: `https://example.com/${id}`,
  active: id === 2, muted: false, audible: false,
});
const data: Snapshot = { windowId: 1, currentTabId: 2, shortcut: '⌘⇧P',
  tabs: [tab(1, 0, true), tab(2, 1), tab(3, 2)],
  bookmarks: [{ id: 'b', title: 'GitHub Docs', url: 'https://docs.github.com', folder: '开发' }],
};

test('one search index contains every source while cold home contains only eight safe defaults', () => {
  const items = entries(data);
  assert.equal(items.length, 33);
  assert.equal(items.filter(entry => entry.kind === 'command').length, 29);
  const home = homeEntries(items);
  assert.deepEqual(home.map(entry => entry.action), ['settings', 'help', 'tabSwitcher', 'newTab', 'reload', 'pin', 'localStorage', 'cookies']);
  assert.ok(home.every(entry => entry.kind === 'command' && !entry.danger && !entry.searchOnly));
  assert.deepEqual(home.slice(0, 2).map(entryTitle), ['zing Settings', 'Zing: Help']);
  const learned = homeEntries(items, new Map([['command:pin', 10]]));
  assert.deepEqual(learned.slice(0, 3).map(entry => entry.id), ['command:pin', 'command:settings', 'command:help']);
  const many = entries({ ...data, tabs: Array.from({ length: 12 }, (_, i) => tab(i + 1, i)) });
  assert.deepEqual(homeEntries(many).map(entry => entry.id), home.map(entry => entry.id));
  assert.equal(search(many, 'Page 12')[0].tabId, 12);
  assert.equal(search(items, 'GitHub Docs')[0].bookmarkId, 'b');
});

test('home excludes the source tab and its exact URL even when another tab or bookmark learned it', () => {
  const url = 'https://example.com/current?q=one#section';
  const items = entries({ ...data, currentTabId: 10,
    tabs: [{ ...tab(10, 0), url }, { ...tab(1, 1), url }, { ...tab(3, 2), url: `${url}-other` }],
    bookmarks: [{ id: 'same', title: 'Current bookmark', url, folder: '' }] });
  const scores = new Map([[`tab:${url}`, 100], ['bookmark:same', 100], [`tab:${url}-other`, 1]]);
  assert.deepEqual(items.filter(item => item.kind === 'tab' && item.active).map(item => item.tabId), [10]);
  assert.deepEqual(homeEntries(items, scores).filter(item => item.kind !== 'command').map(item => item.id), ['tab:3']);
});

test('home mixes learned pages and commands in a single list capped at ten without padding', () => {
  const items = entries({ ...data, tabs: Array.from({ length: 12 }, (_, i) => tab(i + 1, i)) });
  const scores = new Map(items.filter(item => item.kind === 'tab').map(item => [usageTarget(item), 3]));
  scores.set('command:pin', 4);
  scores.set('bookmark:b', 5);
  const result = homeEntries(items, scores);
  assert.equal(result.length, 10);
  assert.deepEqual(result.slice(0, 3).map(item => item.id), ['bookmark:b', 'command:pin', 'tab:1']);
  assert.equal(homeEntries(items, new Map([['bookmark:b', 1]])).length, 9);
  assert.ok(!result.some(item => item.active));
  assert.equal(homeRecommendations(items, scores).results.length, 20);
});

test('home deduplicates exact full URLs, preferring open tabs and counting each learned identity once', () => {
  const url = 'https://example.com/docs?q=one#section';
  const items = entries({ ...data,
    tabs: [{ ...tab(9, 0), url }, { ...tab(3, 1), url }, tab(2, 2)],
    bookmarks: [
      { id: 'a', title: 'Docs A', url, folder: '' }, { id: 'b', title: 'Docs B', url, folder: '' },
      { id: 'query', title: 'Other query', url: url.replace('one', 'two'), folder: '' },
      { id: 'hash', title: 'Other fragment', url: url.replace('section', 'other'), folder: '' },
    ] });
  const usage = new Map([[`tab:${url}`, 2], ['bookmark:a', 3], ['bookmark:b', 4], ['bookmark:query', 1], ['bookmark:hash', 1]]);
  const home = homeRecommendations(items, usage);
  assert.deepEqual(home.results.filter(item => item.url === url).map(item => item.id), ['tab:3']);
  assert.equal(home.scores.get(`tab:${url}`), 9);
  assert.deepEqual(home.targets.get('tab:3'), ['bookmark:a', 'bookmark:b', `tab:${url}`]);
  assert.equal(home.results.filter(item => item.kind !== 'command').length, 3);
  assert.equal(homeEntries(items, new Map([['bookmark:b', 1]]))[0].id, 'tab:3');
  const bookmarksOnly = items.filter(item => item.kind !== 'tab' || item.active);
  assert.equal(homeEntries(bookmarksOnly, new Map([[`tab:${url}`, 1]]))[0].id, 'bookmark:a');
  assert.deepEqual(homeRecommendations(bookmarksOnly, new Map([['bookmark:a', 1]])).targets.get('bookmark:a'), ['bookmark:a', `tab:${url}`]);
});

test('home ties and duplicate representatives remain stable when snapshot MRU order changes', () => {
  const tabs = [tab(9, 0), tab(3, 1), tab(2, 2), { ...tab(5, 3), url: 'https://example.com/3' }];
  const scores = new Map(tabs.map(item => [`tab:${item.url}`, 1]));
  const first = homeEntries(entries({ ...data, tabs }), scores);
  const reversed = homeEntries(entries({ ...data, tabs: [...tabs].reverse() }), scores);
  assert.deepEqual(first.map(item => item.id), reversed.map(item => item.id));
  assert.deepEqual(first.filter(item => item.kind === 'tab').map(item => item.id), ['tab:3', 'tab:9']);
});

test('learned history-only pages and unavailable targets never create home candidates', () => {
  const items = entries(data);
  const history = { ...items[0], id: 'history:1', kind: 'history' as const, action: 'openHistoryPage' as const, url: 'https://history.example/' };
  const scores = new Map([['tab:https://history.example/', 100], ['tab:https://missing.example/', 100], ['bookmark:missing', 100]]);
  assert.deepEqual(homeEntries([...items, history], scores), homeEntries(items));
});

test('less-used commands stay searchable and out of home even with learned preferences', () => {
  const scores = new Map(['mute', 'restore', 'sessionStorage'].map(action => [`command:${action}`, 1e9]));
  for (const muted of [false, true]) {
    const snapshot = { ...data, tabs: data.tabs.map(tab => ({ ...tab, muted })) };
    const items = entries(snapshot);
    assert.deepEqual(homeEntries(items, scores).filter(item => item.kind === 'command').map(item => item.action),
      ['settings', 'help', 'tabSwitcher', 'newTab', 'reload', 'pin', 'localStorage', 'cookies']);
    for (const [action, queries] of [
      ['mute', muted ? ['unmute', '取消静音'] : ['mute', '静音']],
      ['restore', ['reopen closed tab', '恢复关闭的标签页']],
      ['sessionStorage', ['session storage', '会话存储']],
    ] as const) {
      for (const query of queries) assert.equal(search(items, query, scores)[0]?.action, action, query);
    }
    const selected = items.find(item => item.id === 'tab:3')!;
    const menu = actionsFor(selected, snapshot);
    assert.equal(menu.find(item => item.action === 'mute')?.tabId, 3);
    assert.equal(search(menu, muted ? 'unmute' : 'mute')[0]?.action, 'mute');
  }
});

test('Chinese and English command terms are searchable', () => {
  assert.equal(search(entries(data), '刷新')[0].action, 'reload');
  assert.equal(search(entries(data), 'reload')[0].action, 'reload');
  assert.equal(search(entries(data), 'close right')[0].action, 'closeRight');
});
test('extension reload requires an extension query and stays out of learned home commands', () => {
  const items = entries(data);
  const scores = new Map([['command:reloadExtension', 1e9]]);
  for (const query of ['reload zing', 'reload extension', 'reload zing extention', '重新加载扩展', '重载扩展']) {
    assert.equal(search(items, query)[0].action, 'reloadExtension', query);
  }
  for (const query of ['reload', 'refresh', '刷新']) {
    assert.equal(search(items, query, scores)[0].action, 'reload', query);
    assert.ok(!search(items, query, scores).some(item => item.action === 'reloadExtension'));
  }
  assert.ok(!homeEntries(items, scores).some(item => item.action === 'reloadExtension'));
  const command = items.find(item => item.action === 'reloadExtension')!;
  assert.equal(command.tabId, undefined);
  assert.equal(command.shortcut, undefined);
});

test('zing commands use shared category titles and bilingual colon searches', () => {
  const original = globalThis.chrome;
  try {
    for (const locale of ['en-US', 'zh-CN']) {
      globalThis.chrome = { i18n: { getUILanguage: () => locale } } as typeof chrome;
      const items = entries(data);
      const command = items.find(item => item.action === 'reloadExtension')!;
      assert.equal(command.category, 'zing');
      assert.equal(entryTitle(command), locale === 'en-US' ? 'Zing: Reload' : 'Zing: 重新加载');
      assert.equal(entryTitle(actionsFor(command, data)[0]), entryTitle(command));
      for (const query of ['Zing: Reload', 'zing:reload', 'Zing：重新加载', 'reload zing', '重新加载扩展']) {
        assert.equal(search(items, query)[0]?.action, 'reloadExtension', `${locale}: ${query}`);
      }
    }
  } finally { globalThis.chrome = original; }
});

test('search finds bookmark folders and URLs', () => {
  assert.equal(search(entries(data), '开发')[0].bookmarkId, 'b');
  assert.equal(search(entries(data), 'docs.github')[0].bookmarkId, 'b');
});
test('actions target the selected tab, not the active tab', () => {
  const selected = entries(data).find(entry => entry.tabId === 3)!;
  assert.ok(actionsFor(selected, data).every(action => action.tabId === 3));
  assert.equal(actionsFor(selected, data).length, 9);
});
test('bookmark actions use exact complete URLs and include every duplicate, including managed bookmarks', () => {
  const current = { ...tab(2, 1), url: 'https://example.com/docs?q=one#section' };
  const bookmarks: BookmarkItem[] = [
    { id: 'first', title: 'First', url: current.url, folder: '' },
    { id: 'managed', title: 'Managed', url: current.url, folder: '', unmodifiable: 'managed' },
    { id: 'query', title: 'Query', url: 'https://example.com/docs?q=two#section', folder: '' },
    { id: 'hash', title: 'Hash', url: 'https://example.com/docs?q=one#other', folder: '' },
  ];
  const remove = bookmarkTabAction(current, bookmarks)!;
  assert.equal(remove.action, 'unbookmarkTab');
  assert.equal(remove.title, t('unbookmarkTab'));
  assert.equal(remove.tabId, current.id);
  assert.equal(remove.expectedUrl, current.url);
  assert.equal(remove.subtitle, current.title);
  assert.equal(remove.icon, 'bookmark');
  assert.equal(remove.category, 'tab');
  assert.equal(remove.searchOnly, true);
  assert.equal(remove.danger, true);
  assert.equal(remove.shortcut, undefined);
  assert.deepEqual(remove.bookmarkIds, ['first', 'managed']);
  const add = bookmarkTabAction(current, bookmarks.slice(2))!;
  assert.equal(add.action, 'bookmarkTab');
  assert.equal(add.title, t('bookmarkTab'));
  assert.equal(add.expectedUrl, current.url);
  assert.equal(add.shortcut, 'Mod+D');
  assert.deepEqual(add.bookmarkIds, []);
  assert.ok(!add.danger);
});

test('bookmark discovery targets the source while menus target the selected tab and keep switching as default', () => {
  const snapshot = { ...data, bookmarks: [{ id: 'selected', title: 'Selected', url: data.tabs[2].url, folder: '' }] };
  const items = entries(snapshot);
  const source = items.find(item => item.action === 'bookmarkTab')!;
  assert.equal(source.tabId, 2);
  assert.equal(source.expectedUrl, data.tabs[1].url);
  assert.ok(!items.some(item => item.action === 'unbookmarkTab'));
  const selected = items.find(item => item.id === 'tab:3')!;
  assert.equal(selected.action, 'switch');
  const menu = actionsFor(selected, snapshot);
  assert.equal(menu[0].action, 'switch');
  const remove = menu.find(item => item.action === 'unbookmarkTab')!;
  assert.equal(remove.tabId, 3);
  assert.equal(remove.expectedUrl, data.tabs[2].url);
  assert.deepEqual(remove.bookmarkIds, ['selected']);
  assert.ok(!menu.some(item => item.action === 'bookmarkTab'));
  assert.ok(search(menu, '').includes(remove));
  assert.ok(search(menu, '  ').includes(remove));
  assert.equal(new Set(menu.map(item => item.id)).size, menu.length);
  assert.ok(actionsFor(items.find(item => item.id === 'tab:2')!, snapshot).some(item => item.action === 'bookmarkTab'));
  const refreshed = { ...snapshot, bookmarks: [] };
  assert.ok(actionsFor(selected, refreshed).some(item => item.action === 'bookmarkTab'));
  assert.ok(!entries({ ...snapshot, currentTabId: 999 }).some(item => ['bookmarkTab', 'unbookmarkTab'].includes(item.action)));
});

test('unsupported or missing tab URLs never offer bookmark mutations', () => {
  assert.equal(bookmarkTabAction(undefined, []), undefined);
  for (const url of ['', 'invalid URL', 'javascript:alert(1)', 'data:text/html,hello', 'about:blank', 'chrome-extension://test/popup.html']) {
    const current = { ...tab(2, 0), url };
    assert.equal(bookmarkTabAction(current, [{ id: 'unsafe', title: 'Unsafe', url, folder: '' }]), undefined, url);
    const snapshot = { ...data, tabs: [current] };
    const items = entries(snapshot);
    const menu = actionsFor(items.find(item => item.kind === 'tab')!, snapshot);
    for (const candidates of [items, menu]) {
      assert.ok(!candidates.some(item => ['bookmarkTab', 'unbookmarkTab'].includes(item.action)), url);
    }
  }
  for (const url of ['http://example.com/', 'https://example.com/', 'file:///tmp/page.html', 'ftp://example.com/page', 'chrome://settings/']) {
    assert.equal(bookmarkTabAction({ ...tab(2, 0), url }, [])?.expectedUrl, url);
  }
});

test('bookmark queries show the current state in both languages and menus without exposing removal for unrelated queries', () => {
  const original = globalThis.chrome;
  try {
    for (const locale of ['en-US', 'zh-CN']) {
      globalThis.chrome = { i18n: { getUILanguage: () => locale } } as typeof chrome;
      for (const saved of [false, true]) {
        const snapshot = { ...data, bookmarks: saved ? [{ id: 'source', title: 'Source', url: data.tabs[1].url, folder: '' }] : [] };
        const items = entries(snapshot);
        const menu = actionsFor(items.find(item => item.id === 'tab:2')!, snapshot);
        const action = saved ? 'unbookmarkTab' : 'bookmarkTab';
        assert.equal(items.find(item => item.action === action)?.title, t(action));
        assert.ok(!homeEntries(items, new Map([[`command:${action}`, 1e9]])).some(item => item.action === action));
        for (const candidates of [items, menu]) {
          for (const query of ['unbook', 'UNBOOKM', 'Tab: unbook', 'unbookmark', 'UNBOOKMARK', 'unbookmark tab', 'remove bookmark', 'bookmark remove', 'delete bookmarks', '取消收藏', '取消 收藏', '删除书签', '删除 书签', 'Tab: unbookmark', '标签页：取消收藏']) {
            const found = search(candidates, query);
            assert.ok(!found.some(item => item.action === 'bookmarkTab'), `${locale}: ${query}`);
            if (saved) assert.equal(found[0]?.action, 'unbookmarkTab', `${locale}: ${query}`);
          }
          for (const query of ['书签', 'close', '关闭', 'tab', 'remove', 'delete', 'boo', 'unboo', 'books', 'bookcase', 'book guide', 'unbookmrak', 'bookmrak', 'close bookmark']) {
            assert.ok(!search(candidates, query).some(item => item.action === 'unbookmarkTab'), `${locale}: ${query}`);
          }
          for (const query of ['book', 'BOOKM', 'bookma', 'bookmar', 'Tab: book', 'bookmark', 'BOOKMARK', 'bookmark tab', '收藏', '收藏标签页', 'Tab: bookmark', '标签页：收藏标签页']) {
            assert.equal(search(candidates, query)[0]?.action, action, `${locale}: ${query}, saved=${saved}`);
          }
          for (const query of ['add bookmark', 'save bookmark', '添加书签', 'Tab: add bookmark', '标签页：添加书签', 'bookmark add']) {
            const found = search(candidates, query);
            assert.ok(!found.some(item => item.danger), `${locale}: ${query}`);
            assert.equal(found[0]?.action, 'bookmarkTab');
            assert.equal(!!found[0]?.disabled, saved);
            assert.equal(found[0]?.title, t(saved ? 'alreadyBookmarked' : 'bookmarkTab'));
          }
          if (!saved) assert.ok(search(candidates, '书签').some(item => item.action === 'bookmarkTab'));
          const command = candidates.find(item => item.action === action)!;
          const alias = matchingAlias(command, locale === 'en-US' ? (saved ? '取消收藏' : '收藏') : (saved ? 'unbookmark' : 'bookmark'));
          assert.ok(alias, `${locale}: ${action}`);
        }
      }
    }
  } finally { globalThis.chrome = original; }
});

test('bookmark prefixes rank the current state above page names and learned page matches', () => {
  for (const saved of [false, true]) {
    const snapshot = { ...data, bookmarks: [
      ...(saved ? [{ id: 'source', title: 'Source', url: data.tabs[1].url, folder: '' }] : []),
      { id: 'book', title: 'Book', url: 'https://example.com/books', folder: '' },
      { id: 'guide', title: 'Book guide', url: 'https://example.com/book-guide', folder: '' },
    ] };
    const items = entries(snapshot);
    const scores = new Map([['bookmark:book', 1e9], ['bookmark:guide', 1e9]]);
    assert.equal(search(items, 'book', scores)[0]?.action, saved ? 'unbookmarkTab' : 'bookmarkTab');
    assert.equal(search(items, 'book guide', scores)[0]?.id, 'bookmark:guide');
    assert.ok(!search(items, 'book guide', scores).some(item => item.action === 'unbookmarkTab'));
  }
});

test('bookmark result menus offer removal of that bookmark, preserving open as the default action', () => {
  const snapshot = { ...data, bookmarks: [
    { id: 'one', title: 'First', url: 'https://example.com/path?q=1#two', folder: 'Folder' },
    { id: 'two', title: 'Second', url: 'https://example.com/path?q=1#two', folder: 'Other' },
  ] };
  const bookmark = entries(snapshot).find(entry => entry.id === 'bookmark:one')!;
  const menu = actionsFor(bookmark, snapshot);
  assert.equal(menu[0].action, 'openBookmark');
  const remove = menu.find(entry => entry.action === 'removeBookmark')!;
  assert.equal(remove.kind, 'command');
  assert.equal(remove.bookmarkId, 'one');
  assert.equal(remove.expectedUrl, snapshot.bookmarks[0].url);
  assert.equal(remove.tabId, undefined);
  assert.equal(remove.bookmarkIds, undefined);
  assert.equal(remove.danger, true);
  assert.equal(usageTarget(remove), 'command:removeBookmark');
  for (const query of ['', 'book', 'bookm', 'unbook', 'bookmark', 'unbookmark', 'remove bookmark', '取消收藏', '收藏', '删除书签']) {
    assert.ok(search(menu, query).some(entry => entry.action === 'removeBookmark'), query);
  }
  for (const query of ['close', 'tab', 'bookmrak']) assert.ok(!search(menu, query).some(entry => entry.action === 'removeBookmark'), query);
  assert.ok(!entries(snapshot).some(entry => entry.action === 'removeBookmark'));
});

test('URL actions preserve the selected URL and never inherit shortcuts or learning identity', () => {
  const snapshot = { ...data, tabs: [{ ...tab(3, 0), url: 'chrome://settings/content?search=test#cookies' }],
    bookmarks: [{ id: 'url', title: 'Docs', url: 'https://example.com/docs?q=one%20two#section', folder: 'Folder' }] };
  const targets = entries(snapshot).filter(entry => entry.kind === 'tab' || entry.kind === 'bookmark');
  for (const entry of targets) {
    const actions = actionsFor({ ...entry, shortcut: 'Mod+W' }, snapshot);
    const copy = actions.find(action => action.action === 'copyUrl')!;
    assert.ok(copy);
    assert.equal(copy.url, entry.url);
    assert.notEqual(copy.url, entry.subtitle);
    assert.equal(copy.icon, 'copy');
    assert.equal(copy.shortcut, undefined);
    assert.equal(usageTarget(copy), '');
    assert.equal(new Set(actions.map(action => action.id)).size, actions.length);
    for (const query of ['copy URL', 'copy link', '复制', '网址', '链接']) {
      assert.equal(search(actions, query)[0]?.action, 'copyUrl', query);
    }
    assert.ok(!actionsFor({ ...entry, url: undefined }, snapshot).some(action => action.action === 'copyUrl'));
    assert.ok(!actionsFor({ ...entry, url: '' }, snapshot).some(action => action.action === 'copyUrl'));
  }
  assert.ok(!entries(snapshot).some(entry => entry.action === 'copyUrl'));
});
test('close others protects pinned tabs and other windows', () => {
  const tabs = [...data.tabs, tab(4, 2, false, 2)];
  assert.deepEqual(closeTargets(tabs, tabs[1], 'closeOthers').map(tab => tab.id), [3]);
});
test('close right uses current index and protects pinned tabs', () => {
  const tabs = [...data.tabs, tab(4, 3, true), tab(5, 4), tab(6, 5, false, 2)];
  assert.deepEqual(closeTargets(tabs, tabs[1], 'closeRight').map(tab => tab.id), [3, 5]);
  assert.deepEqual(closeTargets(tabs, tabs[4], 'closeRight'), []);
});
test('pin and mute actions reflect current browser state', () => {
  const changed = { ...data, tabs: data.tabs.map(tab => ({ ...tab, pinned: true, muted: true })) };
  assert.ok(entries(changed).find(entry => entry.action === 'pin')!.title.startsWith('Un'));
  assert.ok(entries(changed).find(entry => entry.action === 'mute')!.title.startsWith('Un'));
});

test('mixed ranking prefers exact titles and literal matches over fuzzy matches', () => {
  const items = entries({ ...data, tabs: [{ ...tab(1, 0), title: 'Settings Guide' }, { ...tab(2, 1), title: 'Cloud Notes' }],
    bookmarks: [{ id: 'guide', title: 'Settings', url: 'https://guide.example', folder: '' }] });
  assert.equal(search(items, 'Settings')[0].title, 'Settings');
  assert.ok(search(items, 'Settings').findIndex(item => item.action === 'settings') < search(items, 'Settings').findIndex(item => item.title === 'Settings Guide'));
  assert.equal(search(items, 'Cloud Notes')[0].kind, 'tab');
});

test('close commands require explicit intent and never match through the active page title', () => {
  const items = entries({ ...data, tabs: [{ ...tab(2, 0), title: 'Claude' }] });
  for (const query of ['Claude', 'clsoe', 'tab', 'cl', 'cloud', 'closed', 'disclose', 'clothes', 'guang', '关', 'close missing']) {
    assert.ok(!search(items, query).some(item => item.danger), query);
  }
  assert.equal(search(items, 'Claude')[0].kind, 'tab');
  assert.ok(!search(items, 'Claude').some(item => item.kind === 'command'));
  for (const query of ['close right', '关闭右侧', 'guanbi youce']) {
    assert.equal(search(items, query)[0].action, 'closeRight', query);
  }
});

test('partial actions and reordered words stay discoverable in either language and tab menus', () => {
  const original = globalThis.chrome;
  try {
    for (const locale of ['en-US', 'zh-CN']) {
      globalThis.chrome = { i18n: { getUILanguage: () => locale } } as typeof chrome;
      const items = entries(data);
      const actions = actionsFor(items.find(item => item.id === 'tab:3')!, data);
      for (const candidates of [items, actions]) {
        for (const query of ['clo', 'clos', 'close', ' CLO ', 'clo tab', 'tab clo', 'Tab: clo', 'guan', 'guanb', 'guanbi', '关闭']) {
          assert.equal(search(candidates, query)[0]?.action, 'close', `${locale}: ${query}`);
          assert.ok(search(candidates, query).some(item => item.action === 'closeRight'), query);
        }
        for (const [query, action] of [['clo oth', 'closeOthers'], ['tab clo ri', 'closeRight'], ['关闭 右侧', 'closeRight'], ['guan you', 'closeRight']]) {
          assert.equal(search(candidates, query)[0]?.action, action, `${locale}: ${query}`);
        }
      }
      for (const query of ['reload ext', 'ext reload', 'restart exte']) {
        assert.equal(search(items, query)[0]?.action, 'reloadExtension', `${locale}: ${query}`);
      }
      for (const query of ['reload ex', 'reload external', 'reload extract']) {
        assert.ok(!search(items, query).some(item => item.action === 'reloadExtension'), query);
      }
      assert.ok(!homeEntries(items).some(item => item.danger));
    }
  } finally { globalThis.chrome = original; }
});

test('word prefixes in any order beat incidental substrings and metadata', () => {
  const items = entries({ ...data, tabs: [
    { ...tab(1, 0), title: 'Redesign Notebook' },
    { ...tab(2, 1), title: 'Design Notes' },
    { ...tab(3, 2), title: 'Workspace', url: 'https://example.com/des/not' },
  ], bookmarks: [] });
  for (const query of ['des not', 'not des']) {
    assert.deepEqual(search(items, query).map(item => item.id), ['tab:2', 'tab:1', 'tab:3'], query);
  }
});

test('greater-than is ordinary text and no longer selects a mode', () => {
  const items = entries({ ...data, tabs: [{ ...tab(1, 0), title: '> Example' }] });
  assert.equal(search(items, '> Example')[0].tabId, 1);
});

test('explicit command names and aliases outrank same-name pages in either UI language', () => {
  const original = globalThis.chrome;
  try {
    for (const locale of ['zh-CN', 'en-US']) {
      globalThis.chrome = { i18n: { getUILanguage: () => locale } } as typeof chrome;
      const items = entries({ ...data, tabs: [
        { ...tab(1, 0), title: 'New Tab' }, { ...tab(2, 1), title: 'New Tab Guide' },
        { ...tab(3, 2), title: '新建标签页' },
      ], bookmarks: [{ id: 'new', title: 'New Tab', url: 'https://new.example', folder: '' }] });
      for (const query of ['new tab', ' NEW   TAB ', 'open new tab', '新建标签页', '新建', 'xinjian']) {
        assert.equal(search(items, query)[0].action, 'newTab', `${locale}: ${query}`);
      }
      assert.equal(search(items, 'New Tab Guide')[0].tabId, 2);
      assert.equal(search(items, 'new t')[0].action, 'newTab');
      for (const [query, action] of [['refresh', 'reload'], ['preferences', 'settings'], ['reopen closed tab', 'restore']]) {
        const page = { ...items[0], title: query };
        assert.equal(search([page, ...items.slice(1)], query)[0].action, action, `${locale}: ${query}`);
      }
    }
  } finally { globalThis.chrome = original; }
});

test('title prefixes and word boundaries beat substrings, metadata and fuzzy matches', () => {
  const items = entries({ ...data, tabs: [
    { ...tab(1, 0), title: 'Notion Guide', url: 'https://example.com/design' },
    { ...tab(2, 1), title: 'Redesign Notes' },
    { ...tab(3, 2), title: 'Team Design Notes' },
    { ...tab(4, 3), title: 'Design Notes' },
    { ...tab(5, 4), title: 'Design' },
    { ...tab(6, 5), title: 'Desgin Notes' },
  ], bookmarks: [] });
  assert.deepEqual(search(items, 'design').map(item => item.tabId), [5, 4, 3, 2, 1, 6]);
  assert.equal(search(items, 'design notes')[0].tabId, 4);
  assert.equal(search(items, 'notion guide')[0].tabId, 1);
});

test('broad queries do not always boost commands and tied tabs retain recency order', () => {
  const items = entries({ ...data, tabs: [
    { ...tab(3, 2), title: 'Tab' }, { ...tab(1, 0), title: 'Tab' },
  ], bookmarks: [{ id: 'tab', title: 'Tab', url: 'https://tab.example', folder: '' }] });
  assert.deepEqual(search(items, 'tab').slice(0, 3).map(item => item.id), ['tab:3', 'tab:1', 'bookmark:tab']);
  assert.ok(!search(items, 'new tba').some(item => item.action === 'newTab')); // Short tokens are literal, even in multi-word queries.
});

test('short queries exclude unrelated pages and pinyin commands in both languages', () => {
  const original = globalThis.chrome;
  try {
    for (const locale of ['zh-CN', 'en-US']) {
      globalThis.chrome = { i18n: { getUILanguage: () => locale } } as typeof chrome;
      const items = entries({ ...data, tabs: [
        { ...tab(1, 0), title: 'EchoTech IAM', url: 'https://iam.example/guide' },
        { ...tab(2, 1), title: 'Example Domain' },
        { ...tab(3, 2), title: 'WebSequenceDiagrams' },
        { ...tab(4, 3), title: 'New Tab' },
        { ...tab(5, 4), title: 'Programming Library' },
      ], bookmarks: [{ id: 'iam', title: 'Account Console', url: 'https://iam.example/login', folder: '' }] });
      for (const query of ['iam', 'IAM', ' iam ']) {
        assert.deepEqual(new Set(search(items, query).map(item => item.id)), new Set(['tab:1', 'bookmark:iam']), `${locale}: ${query}`);
      }
      assert.deepEqual(search(items, 'iam guide').map(item => item.id), ['tab:1']);
      assert.deepEqual(search(items, 'iam missing'), []);
      assert.equal(search(items, 'xinjian')[0].action, 'newTab');
      assert.ok(!search(items, 'xinjiam').some(item => item.action === 'newTab'));
      assert.ok(!search(items, '设直').some(item => item.action === 'settings'));
    }
  } finally { globalThis.chrome = original; }
});

test('long English names tolerate limited typos while URLs and auxiliary keywords stay literal', () => {
  const items = entries({ ...data, tabs: [
    { ...tab(1, 0), title: 'Design Notes', url: 'https://example.com/engineering' },
    { ...tab(2, 1), title: 'Programming Library', url: 'https://settings.example' },
  ], bookmarks: [{ id: 'reference', title: 'Handbook', url: 'https://example.com', folder: 'Engineering' }] });
  assert.equal(search(items, 'desgin')[0].tabId, 1);
  assert.equal(search(items, 'reloda')[0].action, 'reload');
  assert.equal(search(items, 'setings')[0].action, 'settings');
  assert.ok(!search(items, 'setings').some(item => item.tabId === 2 && item.kind === 'tab'));
  assert.deepEqual(search(items, 'engineerimg'), []);
  assert.deepEqual(new Set(search(items, 'engineering').map(item => item.id)), new Set(['tab:1', 'bookmark:reference']));
  assert.deepEqual(search(items, 'granm'), []); // Not a typo of an arbitrary fragment inside Programming.
  assert.deepEqual(search(items, 'zzzzzz'), []);
});

test('Tab Switcher describes VSCode style switching and displays only the actual binding', () => {
  const original = globalThis.chrome;
  try {
    for (const locale of ['en-US', 'zh-CN']) {
      globalThis.chrome = { i18n: { getUILanguage: () => locale } } as typeof chrome;
      const items = entries({ ...data, tabSwitcherShortcut: 'Alt+Shift+Y' });
      const command = items.find(item => item.action === 'tabSwitcher')!;
      assert.equal(entryTitle(command), 'Zing: Tab Switcher');
      assert.equal(command.subtitle, 'Switch tabs like in VS Code');
      assert.equal(command.shortcut, 'Alt+Shift+Y');
      for (const query of ['VSCode', 'Switch tabs like in VS Code', 'VSCode style tab switching', 'VSCode 风格标签切换']) {
        assert.equal(search(items, query)[0]?.action, 'tabSwitcher', `${locale}: ${query}`);
      }
      for (const tabSwitcherShortcut of ['', undefined]) {
        assert.equal(entries({ ...data, tabSwitcherShortcut }).find(item => item.action === 'tabSwitcher')?.shortcut, undefined);
      }
    }
  } finally { globalThis.chrome = original; }
});

test('settings command titles identify zing in both languages and remain searchable', () => {
  const original = globalThis.chrome;
  try {
    for (const locale of ['en-US', 'zh-CN']) {
      globalThis.chrome = { i18n: { getUILanguage: () => locale } } as typeof chrome;
      const items = entries(data);
      for (const [section, english, chinese] of [
        ['', 'zing Settings', 'zing 设置'],
        ['theme', 'zing Settings: Theme', 'zing 设置：主题'],
        ['language', 'zing Settings: Language', 'zing 设置：语言'],
        ['keyboard', 'zing Settings: Keyboard Shortcuts', 'zing 设置：快捷键'],
        ['ranking', 'zing Settings: Search Ranking', 'zing 设置：搜索排序'],
        ['tabs', 'zing Settings: Auto Tuck Tabs', 'zing 设置：自动收起标签页'],
        ['binding', 'zing Settings: Set Up Ctrl+Tab', 'zing 设置：配置 Ctrl+Tab'],
      ]) {
        const id = `command:settings${section ? `:${section}` : ''}`;
        assert.equal(entryTitle(items.find(item => item.id === id)!), locale === 'en-US' ? english : chinese);
        assert.equal(search(items, locale === 'en-US' ? english : chinese)[0]?.id, id);
        for (const query of [english, chinese]) assert.ok(search(items, query).some(item => item.id === id), `${locale}: ${query}`);
      }
    }
  } finally { globalThis.chrome = original; }
});

test('feature commands are discoverable by intent and help is available on home', () => {
  const items = entries(data);
  for (const [query, id] of [
    ['help', 'command:help'], ['帮助', 'command:help'], ['使用说明', 'command:help'],
    ['tab switcher', 'command:tabSwitcher'], ['recent tabs', 'command:tabSwitcher'], ['最近标签页', 'command:tabSwitcher'], ['标签切换器', 'command:tabSwitcher'],
    ['Zing: Help', 'command:help'], ['Zing: Settings', 'command:settings'],
    ['Settings: Theme', 'command:settings:theme'], ['change theme', 'command:settings:theme'],
    ['Settings: Language', 'command:settings:language'], ['change language', 'command:settings:language'],
    ['ctrl tab', 'command:settings:binding'], ['设置 Ctrl+Tab', 'command:settings:binding'],
    ['language', 'command:settings:language'], ['语言', 'command:settings:language'],
    ['theme', 'command:settings:theme'], ['主题', 'command:settings:theme'],
    ['hotkey', 'command:settings:keyboard'], ['快捷键', 'command:settings:keyboard'],
    ['reset search ranking', 'command:settings:ranking'], ['重置搜索排序', 'command:settings:ranking'],
    ['auto tuck', 'command:settings:tabs'], ['自动收起', 'command:settings:tabs'],
  ]) assert.equal(search(items, query)[0]?.id, id, query);
  assert.equal(homeEntries(items).filter(item => item.kind === 'command').length, 8);
});

test('Chrome Pages have bilingual intent, independent identities and search-only discovery', () => {
  const original = globalThis.chrome;
  try {
    for (const locale of ['zh-CN', 'en-US']) {
      globalThis.chrome = { i18n: { getUILanguage: () => locale } } as typeof chrome;
      const items = entries({ ...data, tabs: [{ ...tab(1, 0), title: 'Extensions' }, { ...tab(2, 1), title: 'Password' }],
        bookmarks: [{ id: 'extension', title: 'Extensions', url: 'chrome://extensions/', folder: '' }] });
      for (const [action, queries] of [
        ['openExtensions', ['extension', 'extensions', '扩展', '插件', 'chrome://extensions/']],
        ['openPasswords', ['password', 'passwords', 'password manager', '密码']],
        ['openDownloads', ['download', 'downloads', '下载']],
        ['openHistory', ['history', '历史记录']],
        ['openBookmarks', ['bookmark manager', '管理书签']],
        ['openChromeSettings', ['chrome settings', '浏览器设置']],
        ['openExtensionShortcuts', ['extension shortcuts', '扩展快捷键']],
      ] as const) {
        for (const query of queries) assert.equal(search(items, query)[0]?.action, action, `${locale}: ${query}`);
        const entry = items.find(item => item.action === action)!;
        assert.equal(entry.id, `command:${action}`);
        assert.equal(entry.category, 'chromePages');
        assert.equal(entry.searchOnly, true);
        assert.deepEqual(actionsFor(entry, data), [entry]);
      }
      for (const query of ['chrome pages', 'Chrome 内置页面', 'browser', '浏览器']) {
        assert.equal(search(items, query).filter(item => item.category === 'chromePages').length, 7);
      }
      for (const query of ['Chrome Pages:password', 'Chrome 内置页面：密码']) {
        assert.equal(search(items, query)[0]?.action, 'openPasswords', `${locale}: ${query}`);
      }
      for (const query of ['settings', '设置']) assert.equal(search(items, query)[0]?.id, 'command:settings');
      for (const query of ['shortcut', '快捷键']) assert.equal(search(items, query)[0]?.id, 'command:settings:keyboard');
      const scores = new Map(items.filter(item => item.category === 'chromePages').map(item => [item.id, 100]));
      assert.ok(homeEntries(items, scores).every(item => item.category !== 'chromePages'));
      assert.equal(homeEntries(items, scores).filter(item => item.kind === 'command').length, 8);
    }
  } finally { globalThis.chrome = original; }
});

test('tucking appears only for eligible targets and stays out of the empty-search home', () => {
  const snapshot = { ...data, tabs: data.tabs.map(item => ({ ...item, canTuck: !item.pinned })) };
  const items = entries(snapshot);
  for (const query of ['tuck tab', 'Tab: Tuck Away Tab', '收起标签页']) {
    assert.equal(search(items, query)[0]?.action, 'tuck', query);
  }
  assert.equal(items.find(item => item.action === 'tuck')?.tabId, snapshot.currentTabId);
  assert.equal(homeEntries(items).filter(item => item.kind === 'command').length, 8);
  assert.ok(!homeEntries(items).some(item => item.action === 'tuck'));
  const pinned = items.find(item => item.id === 'tab:1')!;
  const eligible = items.find(item => item.id === 'tab:3')!;
  assert.ok(!actionsFor(pinned, snapshot).some(item => item.action === 'tuck'));
  assert.equal(actionsFor(eligible, snapshot).find(item => item.action === 'tuck')?.tabId, 3);
});

test('tucked pages keep their titles, favicons and switch action; undo exists only for an available batch', () => {
  const snapshot = { ...data, canUndoTuck: true, tabs: data.tabs.map(item => item.id === 3 ? { ...item, tucked: true, canTuck: false } : item) };
  const items = entries(snapshot);
  const tucked = items.find(item => item.id === 'tab:3')!;
  assert.equal(tucked.title, 'Page 3');
  assert.equal(tucked.faviconPageUrl, data.tabs[2].url);
  assert.equal(tucked.tucked, true);
  assert.equal(tucked.action, 'switch');
  assert.ok(search(items, '已收起').some(item => item.id === tucked.id));
  assert.ok(!actionsFor(tucked, snapshot).some(item => item.action === 'tuck'));
  assert.equal(search(items, 'undo tuck')[0]?.action, 'undoTuck');
  assert.ok(homeEntries(items).some(item => item.action === 'undoTuck'));
  assert.ok(!entries({ ...snapshot, canUndoTuck: false }).some(item => item.action === 'undoTuck'));
});

test('category prefixes are searchable without changing titles, IDs or exact command intent', () => {
  const items = entries({ ...data, tabs: [{ ...tab(1, 0), title: 'New Tab' }, { ...tab(2, 1), title: 'Website storage documentation' }] });
  assert.equal(search(items, 'new tab')[0].id, 'command:newTab');
  assert.equal(search(items, 'Storage: Local Storage')[0].id, 'command:localStorage');
  assert.equal(search(items, 'Storage:local')[0].id, 'command:localStorage');
  assert.equal(search(items, '存储：local')[0].id, 'command:localStorage');
  assert.ok(search(items, 'Storage: cookie').some(item => item.action === 'cookies'));
  assert.ok(search(items, 'Settings: theme').some(item => item.settingsSection === 'theme'));
  assert.ok(search(items, 'iam').every(item => item.action !== 'newTab'));
  assert.equal(items.find(item => item.id === 'command:localStorage')?.title, 'View Local Storage');
  assert.equal(items.find(item => item.id === 'command:localStorage')?.category, 'storage');
  const site = items.find(item => item.id === 'tab:1')!;
  assert.equal(site.title, 'New Tab'); assert.equal(site.category, undefined);
  assert.equal(site.faviconPageUrl, data.tabs[0].url);
});

test('tab action shortcuts are only advertised for the active target', () => {
  const items = entries(data);
  const inactive = actionsFor(items.find(item => item.id === 'tab:1')!, data);
  const active = actionsFor(items.find(item => item.id === 'tab:2')!, data);
  assert.equal(inactive.find(item => item.action === 'close')?.shortcut, undefined);
  assert.equal(inactive.find(item => item.action === 'reload')?.shortcut, undefined);
  assert.equal(active.find(item => item.action === 'close')?.shortcut, 'Mod+W');
  assert.equal(active.find(item => item.action === 'reload')?.shortcut, 'Mod+R');
  assert.equal(items.find(item => item.action === 'bookmarkTab')?.shortcut, 'Mod+D');
  assert.equal(inactive.find(item => item.action === 'bookmarkTab')?.shortcut, undefined);
  assert.equal(active.find(item => item.action === 'bookmarkTab')?.shortcut, 'Mod+D');
});

test('tab groups are searchable entries and their names find member tabs', () => {
  const items = entries({ ...data, groups: [{ id: 9, windowId: 1, title: 'Research', color: 'blue', collapsed: true }],
    tabs: [{ ...tab(1, 0), groupId: 9 }, tab(2, 1)] });
  const found = search(items, 'Research');
  assert.equal(found[0].action, 'manageGroup');
  assert.equal(found[0].category, 'tabGroup');
  assert.ok(found.some(entry => entry.tabId === 1));
  assert.ok(!found.some(entry => entry.tabId === 2));
  assert.equal(items.find(entry => entry.tabId === 1)?.groupTitle, 'Research');
  assert.equal(search(items, 'Tab Group: Research')[0].groupId, 9);
});

test('pinned service tab outranks prefix bookmarks when the service name matches its hostname', () => {
  const items = entries({ ...data, tabs: [{ ...tab(1, 0, true), title: '日志服务-阿里云控制台', url: 'https://sls.console.aliyun.com/lognext/project/k8s-log' }],
    bookmarks: ['api', 'dev', 'k8s prod'].map((name, index) => ({ id: String(index), title: `sls ${name}`, url: `https://sls.console.aliyun.com/lognext/project/${index}`, folder: '' })) });
  assert.equal(search(items, 'sls')[0].id, 'tab:1');
});

test('pin and open-tab preference break relevance ties without overriding precise intent or learned choices', () => {
  const items = entries({ ...data, tabs: [
    { ...tab(1, 0), title: 'Service dashboard', url: 'https://sls.console.aliyun.com/short' },
    { ...tab(2, 1, true), title: 'Localized dashboard', url: 'https://sls.console.aliyun.com/longer/path' },
    { ...tab(3, 2, true), title: 'Unrelated', url: 'https://unrelated.example/path/sls' },
    { ...tab(4, 3, true), title: 'Settings guide', url: 'https://other.example' },
  ], bookmarks: [
    { id: 'service', title: 'sls dev', url: 'https://sls.console.aliyun.com/dev', folder: '' },
    { id: 'precise', title: 'sls api', url: 'https://api.example', folder: '' },
  ] });
  assert.deepEqual(search(items, 'sls').slice(0, 3).map(item => item.id), ['tab:2', 'tab:1', 'bookmark:service']);
  assert.equal(search(items, 'sls api')[0].id, 'bookmark:precise');
  assert.equal(search(items, 'sls', new Map([['bookmark:service', 4]]))[0].id, 'bookmark:service');
  assert.equal(search(items, 'settings')[0].action, 'settings');
  assert.ok(!search(items, 'iam').some(item => item.pinned));
  assert.ok(!search(items, 'slx').some(item => item.id === 'tab:2'));
  assert.equal(search(items, 'sls missing').length, 0);
});

test('hostname ranking handles www and inner domain labels without promoting path-only pinned hits', () => {
  const items = entries({ ...data, tabs: [
    { ...tab(1, 0, true), title: 'Console', url: 'https://tools.example/sls' },
    { ...tab(2, 1), title: 'Console', url: 'https://www.sls.example' },
    { ...tab(3, 2, true), title: 'Console', url: 'https://console.sls.example' },
  ], bookmarks: [] });
  assert.deepEqual(search(items, 'sls').map(item => item.id), ['tab:2', 'tab:3', 'tab:1']);
});

test('retired script commands are absent from search while Ctrl+Tab setup remains discoverable', () => {
  const items = entries(data);
  for (const query of ['scripts', 'script library', 'new script', 'run script', 'userscript', '脚本', '管理脚本', '新建脚本']) {
    assert.deepEqual(search(items, query), [], query);
  }
  const binding = search(items, 'Ctrl+Tab')[0];
  assert.equal(binding.id, 'command:settings:binding');
  assert.equal(binding.settingsSection, 'binding');
  assert.equal(binding.searchOnly, true);
});
