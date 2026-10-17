import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addUsage, commandUsage, homeUsage, normalizeUsage, queryUsage, usageTarget } from '../src/usage.ts';
import { entries, homeEntries, search } from '../src/model.ts';

const now = 1_800_000_000_000;
const day = 24 * 60 * 60 * 1000;

test('usage is scoped to a normalized query and accumulates repeated selections', () => {
  let history = addUsage([], ' IAM  guide ', 'tab:https://iam.example/', now);
  history = addUsage(history, 'iam guide', 'tab:https://iam.example/', now);
  history = addUsage(history, 'iam', 'bookmark:1', now);
  assert.equal(queryUsage(history, 'IAM GUIDE', now).get('tab:https://iam.example/'), 2);
  assert.equal(queryUsage(history, 'iam', now).has('tab:https://iam.example/'), false);
  assert.equal(queryUsage(history, 'other', now).size, 0);
});

test('frequent selections beat a single choice and recent habits can replace stale ones', () => {
  let history = addUsage([], 'guide', 'old', now - 42 * day);
  history = addUsage(history, 'guide', 'old', now - 42 * day);
  history = addUsage(history, 'guide', 'new', now);
  assert.ok(queryUsage(history, 'guide', now).get('new')! > queryUsage(history, 'guide', now).get('old')!);
  history = addUsage(history, 'guide', 'old', now);
  assert.ok(queryUsage(history, 'guide', now).get('old')! > queryUsage(history, 'guide', now).get('new')!);
});

test('explicit empty queries learn home pages and reject unsupported blank-query identities', () => {
  let history = addUsage([], ' ', 'tab:https://example.com', now);
  history = addUsage(history, '', 'bookmark:1', now);
  history = addUsage(history, '\n', 'tab:https://example.com', now);
  assert.equal(history.length, 2);
  assert.deepEqual(new Set(normalizeUsage(history, now).map(record => record.query)), new Set(['']));
  assert.equal(queryUsage(history, '', now).get('tab:https://example.com'), 2);
  assert.equal(queryUsage(history, 'example', now).size, 0);
  for (const target of ['', 'tab:', 'bookmark:', 'command:', 'script:one', 'unknown']) {
    assert.deepEqual(addUsage([], '', target, now), []);
  }
});

test('malformed or expired usage data is ignored', () => {
  assert.deepEqual(normalizeUsage([{ query: 'x', target: 'y', weight: NaN, lastUsed: now },
    { query: 'x', target: 'y', weight: 1, lastUsed: now + 1 },
    { query: 'x', target: 'y', weight: 1, lastUsed: now - 91 * day }, null], now), []);
  assert.deepEqual(normalizeUsage({ bad: true }, now), []);
});

test('home command scores reuse prior queries and count empty-query executions once', () => {
  let history = addUsage([], 'refresh', 'command:reload', now);
  history = addUsage(history, '刷新', 'command:reload', now);
  history = addUsage(history, '  ', 'command:reload', now);
  history = addUsage(history, 'iam', 'tab:https://iam.example', now);
  history = addUsage(history, 'guide', 'bookmark:1', now);
  const scores = commandUsage(history, now);
  assert.equal(scores.size, 1);
  assert.equal(scores.get('command:reload'), 3);
  assert.deepEqual(homeUsage(history, now), new Map([['command:reload', 3], ['tab:https://iam.example', 1], ['bookmark:1', 1]]));
  assert.equal(queryUsage(history, 'refresh', now).get('command:reload'), 1);
  assert.equal(queryUsage(history, 'unrelated', now).size, 0);
  assert.equal(normalizeUsage(history, now).find(record => record.query === '')?.weight, 1);
});

test('home command habits decay and expired records do not influence ordering', () => {
  let history = addUsage([], 'new', 'command:newTab', now - 42 * day);
  history = addUsage(history, '', 'command:newTab', now - 42 * day);
  history = addUsage(history, '', 'command:reload', now);
  history.push({ query: '', target: 'command:mute', weight: 100, lastUsed: now - 91 * day });
  const scores = commandUsage(history, now);
  assert.equal(scores.get('command:newTab'), 0.25);
  assert.equal(scores.get('command:reload'), 1);
  assert.ok(!scores.has('command:mute'));
});

test('home aggregates page frequency across queries and lets recent choices replace stale habits', () => {
  const items = entries({ currentTabId: 1, windowId: 1, shortcut: '', bookmarks: [],
    tabs: [1, 2, 3].map(id => ({ id, index: id - 1, windowId: 1, title: `Page ${id}`, url: `https://example.com/${id}`,
      active: id === 1, pinned: false, muted: false, audible: false })) });
  let history = addUsage([], 'old', 'tab:https://example.com/2', now - 42 * day);
  history = addUsage(history, '', 'tab:https://example.com/2', now - 42 * day);
  history = addUsage(history, 'new', 'tab:https://example.com/3', now);
  assert.equal(homeUsage(history, now).get('tab:https://example.com/2'), 0.25);
  assert.equal(homeEntries(items, homeUsage(history, now))[0].id, 'tab:3');
  history = addUsage(history, 'different query', 'tab:https://example.com/2', now);
  assert.equal(homeUsage(history, now).get('tab:https://example.com/2'), 1.25);
  assert.equal(homeEntries(items, homeUsage(history, now))[0].id, 'tab:2');
  assert.equal(queryUsage(history, 'different query', now).get('tab:https://example.com/2'), 1);
  assert.equal(queryUsage(history, 'new', now).has('tab:https://example.com/2'), false);
  history.push({ query: '', target: 'bookmark:expired', weight: 100, lastUsed: now - 91 * day });
  assert.equal(homeUsage(history, now).has('bookmark:expired'), false);
});

test('home learns mixed page and command order while retaining safe defaults and live labels', () => {
  const items = entries({ currentTabId: 3, windowId: 1, shortcut: '', bookmarks: [],
    tabs: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, windowId: 1, index: i,
      title: `Page ${i}`, url: `https://example.com/${i}`, active: i === 2, pinned: true, muted: true, audible: false })) });
  const original = homeEntries(items);
  const before = items.map(item => item.id);
  const learned = homeEntries(items, new Map([['command:mute', 5], ['command:pin', 3], ['command:closeOthers', 100], ['tab:https://example.com/7', 100]]));
  assert.equal(learned[0].id, 'tab:8');
  assert.deepEqual(learned.slice(1).map(item => item.action), ['pin', 'settings', 'help', 'tabSwitcher', 'scriptLibrary', 'newTab', 'reload', 'localStorage', 'cookies']);
  assert.equal(learned[1].title, 'Unpin Tab');
  assert.ok(learned.slice(1).every(item => item.tabId === 3 || ['settings', 'help', 'tabSwitcher', 'scriptLibrary', 'localStorage', 'cookies'].includes(item.action)));
  assert.deepEqual(items.map(item => item.id), before);
  assert.deepEqual(homeEntries(items, commandUsage([], now)), original);
});

test('history is bounded and repeated targets do not create duplicate records', () => {
  let history = Array.from({ length: 500 }, (_, i) => ({ query: 'x', target: `tab:${i}`, weight: 1, lastUsed: now - i }));
  history = addUsage(history, 'x', 'tab:new', now);
  assert.equal(history.length, 500);
  assert.equal(history.some(record => record.target === 'tab:499'), false);
  history = addUsage(history, 'x', 'tab:new', now);
  assert.equal(history.filter(record => record.target === 'tab:new').length, 1);
  assert.equal(history[0].weight, 2);
});

test('learning cannot promote metadata, substrings or typos above more relevant names', () => {
  const items = entries({ currentTabId: 1, windowId: 1, shortcut: '', bookmarks: [],
    tabs: ['Design', 'Design Notes', 'Team Design Notes', 'Redesign Notes', 'Workspace', 'Desgin Notes'].map((title, i) => ({
      id: i + 1, windowId: 1, index: i, active: i === 0, pinned: false, muted: false, audible: false,
      title, url: i === 4 ? 'https://example.com/design' : `https://example.com/${i}`,
    })) });
  for (const item of items.filter(item => item.kind === 'tab')) {
    const scores = new Map([[usageTarget(item), 100]]);
    assert.deepEqual(search(items, 'design', scores).map(item => item.tabId), [1, 2, 3, 4, 5, 6]);
  }
  const scores = new Map([['command:restore', 100], ['command:closeOthers', 100]]);
  assert.equal(search(items, 'clo', scores)[0]?.action, 'closeOthers'); // Same prefix tier can learn.
  assert.equal(search(items, 'close', scores)[0]?.action, 'close'); // Exact action stays first.
});

test('learned choices move ahead within the same relevance tier and query while strict filtering remains protected', () => {
  const items = entries({ currentTabId: 1, windowId: 1, shortcut: '', tabs: [{
    id: 1, windowId: 1, index: 0, active: true, pinned: false, muted: false, audible: false,
    title: 'IAM Console', url: 'https://auth.example/Guide',
  }, { id: 2, windowId: 1, index: 1, active: false, pinned: false, muted: false, audible: false,
    title: 'New Tab', url: 'chrome://newtab/' }],
  bookmarks: [{ id: 'iam', title: 'IAM Handbook', url: 'https://handbook.example', folder: '' }] });
  assert.equal(search(items, 'iam')[0].tabId, 1);
  const target = usageTarget(items[0]);
  const history = addUsage(addUsage([], 'iam', 'bookmark:iam', now), 'iam', 'bookmark:iam', now);
  assert.equal(search(items, 'iam', queryUsage(history, 'iam', now))[0].bookmarkId, 'iam');
  assert.equal(search(items, 'iam', queryUsage(history, 'other', now))[0].tabId, 1);
  const stale = new Map([['command:newTab', 100]]);
  assert.ok(!search(items, 'iam', stale).some(item => item.action === 'newTab'));
  assert.equal(search(items, 'new tab', new Map([['tab:chrome://newtab/', 100]]))[0].action, 'newTab');
  const restored = { ...items[0], id: 'tab:99', tabId: 99 };
  assert.equal(usageTarget(restored), target); // Browser restart changes tab IDs, not the learned URL.
  assert.equal(usageTarget({ ...restored, url: 'https://auth.example/Other' }) === target, false);
  assert.equal(usageTarget({ ...restored, keywords: `${restored.url} tucked away 已收起 switch tab 切换标签页` }), target);
});
