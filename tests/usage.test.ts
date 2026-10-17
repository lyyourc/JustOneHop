import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addUsage, commandUsage, normalizeUsage, queryUsage, usageTarget } from '../src/usage.ts';
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

test('blank tab searches do not train and malformed or expired data is ignored', () => {
  assert.deepEqual(addUsage([], ' ', 'tab:https://example.com', now), []);
  assert.deepEqual(addUsage([], '', 'bookmark:1', now), []);
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

test('home learns command order while retaining recent tabs, safe defaults and live labels', () => {
  const items = entries({ currentTabId: 3, windowId: 1, shortcut: '', bookmarks: [],
    tabs: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, windowId: 1, index: i,
      title: `Page ${i}`, url: `https://example.com/${i}`, active: i === 2, pinned: true, muted: true, audible: false })) });
  const original = homeEntries(items);
  const before = items.map(item => item.id);
  const learned = homeEntries(items, new Map([['command:mute', 5], ['command:pin', 3], ['command:closeOthers', 100], ['tab:https://example.com/7', 100]]));
  assert.deepEqual(learned.slice(0, 6), original.slice(0, 6));
  assert.deepEqual(learned.slice(6).map(item => item.action), ['mute', 'pin', 'newTab', 'restore', 'reload', 'localStorage', 'sessionStorage', 'cookies', 'settings']);
  assert.equal(learned[6].title, 'Unmute Tab');
  assert.equal(learned[7].title, 'Unpin Tab');
  assert.ok(learned.slice(6).every(item => item.tabId === 3 || ['settings', 'localStorage', 'sessionStorage', 'cookies'].includes(item.action)));
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
  assert.equal(usageTarget({ ...restored, keywords: 'https://auth.example/Other' }) === target, false);
});
