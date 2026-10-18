import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionsFor, entries, homeEntries, matchingAlias, search } from '../src/model.ts';
import { queryUsage, type UsageRecord } from '../src/usage.ts';
import type { Snapshot, TabItem } from '../src/types.ts';

// Representative workday samples, not data read from a personal Chrome profile.
const pages: [string, string, boolean?, number?][] = [
  ['Pull requests · acme/justonehop · GitHub', 'https://github.com/acme/justonehop/pulls'],
  ['Issues · acme/justonehop · GitHub', 'https://github.com/acme/justonehop/issues'],
  ['产品路线图 Q4 — Notion', 'https://notion.so/roadmap'],
  ['Design System — Figma', 'https://figma.com/design/system'],
  ['日志服务-阿里云控制台', 'https://sls.console.aliyun.com/logs', true],
  ['周会纪要 — Google Docs', 'https://docs.google.com/document/meeting'],
  ['Music for work — YouTube', 'https://youtube.com/watch'],
  ['JavaScript reference | MDN', 'https://developer.mozilla.org/docs/javascript'],
  ['Redesign Notebook', 'https://example.com/archive'],
  ['Design Notes', 'https://example.com/notes'],
  ['Cloud Console', 'https://cloud.example/dashboard'],
  ['EchoTech IAM', 'https://auth.example/login'],
  ['Budget 2026', 'https://sheets.google.com/budget', false, 9],
  ['Budget 2025', 'https://sheets.google.com/archive'],
  ['Team Workspace', 'https://workspace.example/design'],
  ['Settings Guide', 'https://help.example/settings'],
];
const tabs: TabItem[] = pages.map(([title, url, pinned = false, groupId], i) => ({
  id: i + 1, index: i, windowId: 1, title, url, pinned, groupId, active: i === 6, muted: i === 6, audible: false,
}));
const snapshot: Snapshot = {
  windowId: 1, currentTabId: 7, shortcut: '', tabs,
  groups: [{ id: 9, windowId: 1, title: 'Research 研究', color: 'blue', collapsed: false }],
  bookmarks: [
    { id: 'react', title: 'React 文档', url: 'https://react.dev/learn', folder: '开发 / 前端' },
    { id: 'github-api', title: 'GitHub API reference', url: 'https://docs.github.com/rest', folder: '开发 / API' },
    { id: 'budget', title: 'Budget Handbook', url: 'https://finance.example', folder: 'Research / Finance' },
    { id: 'sls', title: 'sls production', url: 'https://sls.console.aliyun.com/prod', folder: '工作' },
    ...Array.from({ length: 200 }, (_, i) => ({ id: `reference-${i}`, title: `Engineering reference ${i}`, url: `https://reference.example/${i}`, folder: '资料' })),
  ],
};

const scenarios: [string, string, string[]][] = [
  ['找代码评审', 'tab:1', ['github pull', 'pull github', 'justonehop pull']],
  ['找问题列表', 'tab:2', ['github issues', 'issues justonehop']],
  ['只记得中文标题', 'tab:3', ['路线', 'notion 路线', 'Q4 notion']],
  ['只记得服务域名', 'tab:5', ['sls', '日志', 'sls 日志']],
  ['找会议记录', 'tab:6', ['周会', 'google 周会', '周会 docs']],
  ['标题只记得两个词', 'tab:10', ['des not', 'not des', 'design notes']],
  ['标题有拼写错误', 'tab:10', ['desgin notes']],
  ['组名加页面名', 'tab:13', ['Research Budget', 'Budget 研究']],
  ['书签目录加名称', 'bookmark:react', ['前端 react', 'react 开发', 'react.dev 文档']],
  ['跨目录找参考', 'bookmark:github-api', ['API github', '开发 docs.github']],
  ['新建页面', 'command:newTab', ['open tab', 'create tab', 'new t', '新标签页', '新建页面']],
  ['刷新页面', 'command:reload', ['refresh page', 'reload page', '刷新页面', '重新加载页面', 'reloda']],
  ['找回刚关的页面', 'command:restore', ['reopen last tab', 'undo close tab', '重新打开', '恢复标签', '恢复上一个标签页']],
  ['换外观', 'command:settings:theme', ['dark mode', '深色', '浅色', '换主题', 'change theme']],
  ['更改语言', 'command:settings:language', ['切换语言', 'change language', '英文', '中文', 'English', 'english']],
  ['打开设置', 'command:settings', ['open settings', '打开设置', 'setings']],
  ['浏览器设置', 'command:openChromeSettings', ['browser settings', '浏览器设置']],
  ['找书签管理', 'command:openBookmarks', ['bookmarks', '打开书签', '书签']],
  ['调整排序', 'command:settings:ranking', ['清除排序', '重置排序', 'reset ranking']],
  ['设置切换快捷键', 'command:settings:binding', ['ctrl tab', '绑定 Ctrl+Tab']],
  ['查看站点数据', 'command:cookies', ['查看 cookie', 'cookies']],
  ['明确关闭意图', 'command:close', ['clo', 'tab clo', '关闭']],
];

for (const locale of ['en-US', 'zh-CN']) test(`${locale}: workday searches surface the intended result first`, () => {
  const original = globalThis.chrome;
  try {
    globalThis.chrome = { i18n: { getUILanguage: () => locale } } as typeof chrome;
    const items = entries(snapshot);
    const failures: string[] = [];
    for (const [task, expected, queries] of scenarios) for (const query of queries) {
      const results = search(items, query);
      if (results[0]?.id !== expected) failures.push(`${task} / ${query}: expected ${expected}; got ${results.slice(0, 5).map(item => `${item.id}(${item.title})`).join(', ') || 'no results'}`);
    }
    assert.deepEqual(failures, []);
  } finally { globalThis.chrome = original; }
});

test('adding descriptive aliases does not let a longer command overtake a direct action', () => {
  const items = entries(snapshot);
  const enriched = items.map(item => item.action === 'restore' ? {
    ...item, aliases: Array.from({ length: 30 }, (_, i) => `restore close tab from history ${i}`),
  } : item);
  for (const query of ['clo tab', 'tab clo', 'close tab']) {
    assert.equal(search(enriched, query)[0]?.action, 'close', query);
  }
  const language = { ...items.find(item => item.id === 'command:settings:language')!, title: '切换语言' };
  assert.equal(matchingAlias(language, 'english'), 'English');
});

test('typing, correcting and narrowing a query preserves useful results without incidental dangerous actions', () => {
  const items = entries(snapshot);
  for (const query of ['g', 'gi', 'git', 'gith', 'github', 'github p', 'github pu', 'github pull']) {
    assert.ok(search(items, query).slice(0, 5).some(item => item.id === 'tab:1'), query);
    assert.ok(!search(items, query).some(item => item.danger), query);
  }
  for (const query of ['iam', 'cloud', 'cl', 'closed', 'guanbi missing', 'github missing', 'Research Budget missing']) {
    assert.ok(!search(items, query).some(item => item.danger), query);
    if (query.includes('missing')) assert.equal(search(items, query).length, 0, query);
  }
  assert.ok(!homeEntries(items).some(item => item.danger));
  assert.equal(search(items, 'iam')[0]?.id, 'tab:12');
  assert.equal(search(items, 'cloud')[0]?.id, 'tab:11');
});

test('recent successful choices influence ties without hiding a better match or changing another query', () => {
  const items = entries(snapshot);
  const now = Date.now();
  const history: UsageRecord[] = [
    { query: 'sls', target: 'bookmark:sls', weight: 3, lastUsed: now },
    { query: 'design', target: 'tab:https://workspace.example/design', weight: 100, lastUsed: now },
    { query: 'settings', target: 'tab:https://help.example/settings', weight: 100, lastUsed: now },
  ];
  assert.equal(search(items, 'sls')[0]?.id, 'tab:5');
  assert.equal(search(items, 'sls', queryUsage(history, 'sls', now))[0]?.id, 'bookmark:sls');
  assert.equal(search(items, 'sls 日志', queryUsage(history, 'sls 日志', now))[0]?.id, 'tab:5');
  assert.notEqual(search(items, 'design', queryUsage(history, 'design', now))[0]?.id, 'tab:15');
  assert.equal(search(items, 'settings', queryUsage(history, 'settings', now))[0]?.id, 'command:settings');
});

for (const locale of ['en-US', 'zh-CN']) test(`${locale}: inverse actions never suggest doing the opposite on an already satisfied tab`, () => {
  const original = globalThis.chrome;
  try {
    globalThis.chrome = { i18n: { getUILanguage: () => locale } } as typeof chrome;
    for (const enabled of [false, true]) {
      const state = { ...snapshot, tabs: snapshot.tabs.map(tab => ({ ...tab, pinned: enabled, muted: enabled })) };
      const items = entries(state);
      const menu = actionsFor(items.find(item => item.id === 'tab:1')!, state);
      for (const candidates of [items, menu]) for (const [action, queries] of [
        ['mute', ['unmute', 'unmute tab', '取消静音', '恢复声音']],
        ['pin', ['unpin', 'unpin tab', '取消固定', '取消固定标签页']],
      ] as const) for (const query of queries) {
        const matches = search(candidates, query).filter(item => item.action === action);
        assert.equal(matches.length, enabled ? 1 : 0, `${enabled}: ${query}`);
        if (enabled) assert.equal(matches[0].tabId, candidates === items ? 7 : 1);
      }
    }
  } finally { globalThis.chrome = original; }
});

test('technical punctuation, emoji, long queries and mixed scripts preserve exact page identity', () => {
  const titles = ['C++ API reference', 'C# guide', 'Node.js v22 notes', '[RFC] OAuth2 / PKCE (2026)',
    '📌 项目计划 — Sprint 42', '支付回调接口签名校验失败排查与生产环境部署操作记录完整说明文档',
    'Release notes ' + 'long project context '.repeat(8) + 'unique-ending'];
  const items = entries({ ...snapshot, bookmarks: [], tabs: titles.map((title, i) => ({
    ...tabs[0], id: 100 + i, title, url: `https://docs.example/${i}?mode=preview#section`,
  })) });
  for (const [query, id] of [['C++', 100], ['C#', 101], ['node.js v22', 102], ['[RFC] PKCE', 103],
    ['📌 计划', 104], [titles[5], 105], [titles[6], 106], ['unique-ending release', 106],
    ['docs.example/3?mode=preview#section', 103]] as const) {
    assert.equal(search(items, query)[0]?.tabId, id, query);
  }
  for (const query of ['[', '(', '*', '\\', '支付回调 missing']) assert.doesNotThrow(() => search(items, query), query);
  assert.equal(search(items, '支付回调 missing').length, 0);
});

test('identical titles remain separate and prefer pinned then open pages before bookmarks', () => {
  const items = entries({ ...snapshot, tabs: [
    { ...tabs[0], id: 101, title: 'Release Notes', url: 'https://a.example', pinned: false },
    { ...tabs[0], id: 102, title: 'Release Notes', url: 'https://b.example', pinned: true },
  ], bookmarks: [{ id: 'same', title: 'Release Notes', url: 'https://a.example', folder: 'Work' }] });
  assert.deepEqual(search(items, 'Release Notes').map(item => item.id), ['tab:102', 'tab:101', 'bookmark:same']);
  assert.equal(search(items, 'b.example release')[0]?.id, 'tab:102');
  assert.equal(search(items, 'Work Release')[0]?.id, 'bookmark:same');
});

test('case, whitespace and copied category labels do not change command intent', () => {
  const items = entries(snapshot);
  for (const [query, action] of [['  NEW\tTAB  ', 'newTab'], ['Tab：refresh page', 'reload'],
    ['存储：local', 'localStorage'], ['Chrome Pages：password', 'openPasswords'],
    ['\nGITHUB PULL\n', 'switch']] as const) {
    assert.equal(search(items, query)[0]?.action, action, query);
  }
  assert.deepEqual(search(items, '   '), items);
});

test('stale history cannot resurrect removed pages or leak another query preference', () => {
  const items = entries(snapshot);
  const now = Date.now();
  const history: UsageRecord[] = [
    { query: 'sls', target: 'bookmark:sls', weight: 100, lastUsed: now - 91 * 86400000 },
    { query: 'github', target: 'tab:https://removed.example/', weight: 100, lastUsed: now },
  ];
  assert.equal(search(items, 'sls', queryUsage(history, 'sls', now))[0]?.id, 'tab:5');
  assert.deepEqual(search(items, 'github', queryUsage(history, 'github', now)), search(items, 'github'));
  assert.equal(search(items, 'removed.example', queryUsage(history, 'github', now)).length, 0);
});

test('an inactive tab menu uses its own state rather than the source tab state', () => {
  const state = { ...snapshot, tabs: snapshot.tabs.map(tab => ({ ...tab, pinned: tab.id === 7, muted: tab.id === 7 })) };
  const items = entries(state);
  const menu = actionsFor(items.find(item => item.id === 'tab:1')!, state);
  for (const query of ['unmute', 'unpin', '取消静音', '取消固定']) {
    assert.ok(search(items, query).some(item => item.tabId === 7));
    assert.ok(!search(menu, query).some(item => item.action === 'mute' || item.action === 'pin'));
  }
  assert.equal(search(menu, 'mute')[0]?.tabId, 1);
  assert.equal(search(menu, 'pin')[0]?.tabId, 1);
});

test('state refresh changes inverse discovery without reusing a stale command index', () => {
  for (const enabled of [false, true, false]) {
    const state = { ...snapshot, tabs: snapshot.tabs.map(tab => ({ ...tab, pinned: enabled, muted: enabled })) };
    const items = entries(state);
    // Search twice to exercise both fresh and cached index paths.
    for (let repeat = 0; repeat < 2; repeat++) {
      assert.equal(search(items, 'unmute').some(item => item.action === 'mute'), enabled);
      assert.equal(search(items, 'unpin').some(item => item.action === 'pin'), enabled);
      for (const query of ['sound', 'audio', 'jingyin']) assert.ok(search(items, query).some(item => item.action === 'mute'), query);
      assert.ok(search(items, 'guding').some(item => item.action === 'pin'));
    }
  }
});

test('a page title in an action query does not silently retarget current-tab commands', () => {
  const items = entries(snapshot);
  for (const query of ['close github', 'reload youtube', 'mute Music', 'pin notion']) {
    assert.ok(!search(items, query).some(item => ['close', 'reload', 'mute', 'pin'].includes(item.action)), query);
  }
  for (const query of ['reload', 'refresh page', '重新加载页面']) {
    assert.equal(search(items, query)[0]?.action, 'reload');
    assert.ok(!search(items, query).some(item => item.action === 'reloadExtension'));
  }
  assert.equal(search(items, 'reload ext')[0]?.action, 'reloadExtension');
});

test('bookmark names and built-in command intents retain distinct execution identities', () => {
  const items = entries({ ...snapshot, bookmarks: ['Release helper', 'Settings', 'New Tab'].map((title, i) => ({
    id: `named-${i}`, title, url: `https://named.example/${i}`, folder: '',
  })) });
  assert.equal(search(items, 'Release helper')[0]?.action, 'openBookmark');
  assert.equal(search(items, 'settings')[0]?.id, 'command:settings');
  assert.ok(search(items, 'settings').some(item => item.id === 'bookmark:named-1'));
  assert.equal(search(items, 'new tab')[0]?.id, 'command:newTab');
  assert.ok(search(items, 'new tab').some(item => item.id === 'bookmark:named-2'));
});

test('everyday tab actions use the same vocabulary and keep the selected target', () => {
  const items = entries(snapshot);
  const actions = actionsFor(items.find(item => item.id === 'tab:7')!, snapshot);
  for (const [query, expected] of [['refresh page', 'reload'], ['unmute', 'mute'], ['取消静音', 'mute'], ['close right', 'closeRight']]) {
    const found = search(actions, query)[0];
    assert.equal(found?.action, expected, query);
    assert.equal(found?.tabId, 7, query);
  }
  const reload = { ...items.find(item => item.id === 'command:reload')!, title: '刷新当前标签页' };
  assert.equal(matchingAlias(reload, 'refresh page'), 'refresh page');
});
