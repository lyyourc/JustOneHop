import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionsFor, closeTargets, entries, homeEntries, search } from '../src/model.ts';
import type { Snapshot, TabItem } from '../src/types.ts';
import { entryTitle } from '../src/entryPresentation.ts';

const tab = (id: number, index: number, pinned = false, windowId = 1): TabItem => ({
  id, index, windowId, pinned, title: `Page ${id}`, url: `https://example.com/${id}`,
  active: id === 2, muted: false, audible: false,
});
const data: Snapshot = { windowId: 1, currentTabId: 2, shortcut: '⌘⇧P',
  tabs: [tab(1, 0, true), tab(2, 1), tab(3, 2)],
  bookmarks: [{ id: 'b', title: 'GitHub Docs', url: 'https://docs.github.com', folder: '开发' }],
};

test('one index contains tabs, bookmarks and commands; home prioritizes recent tabs', () => {
  const items = entries(data);
  assert.equal(items.length, 33);
  assert.equal(items.filter(entry => entry.kind === 'command').length, 29);
  const home = homeEntries(items);
  assert.deepEqual(home.slice(0, 3).map(entry => entry.kind), ['tab', 'tab', 'tab']);
  assert.ok(home.slice(3).every(entry => entry.kind === 'command' && !entry.danger));
  assert.ok(!home.some(entry => entry.kind === 'bookmark'));
  const many = entries({ ...data, tabs: Array.from({ length: 12 }, (_, i) => tab(i + 1, i)) });
  assert.equal(homeEntries(many).filter(entry => entry.kind === 'tab').length, 6);
  assert.equal(search(many, 'Page 12')[0].tabId, 12);
});
test('home retains the source tab beyond the six-tab limit and marks only that tab current', () => {
  const tabs = Array.from({ length: 10 }, (_, i) => tab(i + 1, i));
  const items = entries({ ...data, tabs, currentTabId: 10 });
  assert.deepEqual(items.filter(item => item.kind === 'tab' && item.active).map(item => item.tabId), [10]);
  assert.deepEqual(homeEntries(items).filter(item => item.kind === 'tab').map(item => item.tabId), [1, 2, 3, 4, 5, 10]);
  assert.deepEqual(homeEntries(entries({ ...data, tabs, currentTabId: 2 })).filter(item => item.kind === 'tab').map(item => item.tabId), [1, 2, 3, 4, 5, 6]);
  assert.equal(homeEntries(entries({ ...data, tabs: [] })).filter(item => item.kind === 'tab').length, 0);
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
  assert.equal(actionsFor(selected, data).length, 7);
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

test('script actions retain the target and allow searching delete in both languages', () => {
  const entry = { id: 'script:one', scriptId: 'one', kind: 'script' as const, action: 'copyScript' as const, icon: 'script' as const, title: 'Helper', subtitle: '', keywords: '' };
  const actions = actionsFor(entry, data);
  assert.deepEqual(actions.map(action => action.action), ['runScript', 'runCopyScript', 'copyScript', 'editScript', 'deleteScript']);
  assert.ok(actions.every(action => action.scriptId === 'one'));
  assert.equal(new Set(actions.map(action => action.id)).size, 5);
  for (const query of ['delete', '删除']) assert.deepEqual(search(actions, query).map(action => action.action), ['deleteScript']);
  assert.deepEqual(actionsFor({ ...entry, scriptId: 'builtin-ctrl-tab' }, data).map(action => action.action), ['copyScript', 'editScript']);
});

test('feature commands are discoverable by intent without changing the empty-search home', () => {
  const items = entries(data);
  for (const [query, id] of [
    ['new script', 'command:newScript'], ['新建脚本', 'command:newScript'],
    ['scripts', 'command:scriptLibrary'], ['脚本', 'command:scriptLibrary'], ['管理脚本', 'command:scriptLibrary'],
    ['language', 'command:settings:language'], ['语言', 'command:settings:language'],
    ['theme', 'command:settings:theme'], ['主题', 'command:settings:theme'],
    ['hotkey', 'command:settings:keyboard'], ['快捷键', 'command:settings:keyboard'],
    ['reset search ranking', 'command:settings:ranking'], ['重置搜索排序', 'command:settings:ranking'],
    ['auto tuck', 'command:settings:tabs'], ['自动收起', 'command:settings:tabs'],
  ]) assert.equal(search(items, query)[0]?.id, id, query);
  assert.equal(homeEntries(items).filter(item => item.kind === 'command').length, 9);
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
      assert.equal(homeEntries(items, scores).filter(item => item.kind === 'command').length, 9);
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
  assert.equal(homeEntries(items).filter(item => item.kind === 'command').length, 9);
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
  const items = entries({ ...data, tabs: [{ ...tab(1, 0), title: 'New Tab' }, { ...tab(2, 1), title: 'Script: New Script' }] });
  assert.equal(search(items, 'new tab')[0].id, 'command:newTab');
  assert.equal(search(items, 'Script: New Script')[0].id, 'command:newScript');
  assert.equal(search(items, 'Script:new')[0].id, 'command:newScript');
  assert.equal(search(items, '脚本：new')[0].id, 'command:newScript');
  assert.ok(search(items, 'Storage: cookie').some(item => item.action === 'cookies'));
  assert.ok(search(items, 'Settings: theme').some(item => item.settingsSection === 'theme'));
  assert.ok(search(items, 'iam').every(item => item.action !== 'newTab'));
  assert.equal(items.find(item => item.id === 'command:newScript')?.title, 'New Script');
  assert.equal(items.find(item => item.id === 'command:newScript')?.category, 'script');
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
