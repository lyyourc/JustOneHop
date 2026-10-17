import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entries, homeEntries, search } from '../src/model.ts';
import { addUsage, commandUsage, queryUsage, rankingInfo, usageTarget } from '../src/usage.ts';
import type { Snapshot } from '../src/types.ts';

const now = Date.now();
const snapshot: Snapshot = { currentTabId: 1, windowId: 1, shortcut: '', bookmarks: [],
  tabs: ['Guide Alpha', 'Guide Beta', 'Guide'].map((title, index) => ({ id: index + 1, windowId: 1, index,
    title, url: `https://example.com/${index}`, pinned: false, active: index === 0, muted: false, audible: false, tucked: index === 1 })) };

test('tucked tabs inherit URL habits and forget removes only the selected query preference', () => {
  const items = entries(snapshot);
  const beta = items.find(item => item.id === 'tab:2')!;
  const target = 'tab:https://example.com/1';
  assert.equal(usageTarget(beta), target);
  const history = addUsage([], 'guide', target, now);
  const baseline = search(items, 'guide');
  const scores = queryUsage(history, 'guide', now);
  const learned = search(items, 'guide', scores);
  assert.deepEqual(baseline.filter(item => item.kind === 'tab').map(item => item.id), ['tab:3', 'tab:1', 'tab:2']);
  assert.deepEqual(learned.filter(item => item.kind === 'tab').map(item => item.id), ['tab:3', 'tab:2', 'tab:1']);
  assert.deepEqual(rankingInfo(learned, baseline, scores).get(beta.id), { learned: true, promoted: true });
  assert.deepEqual(search(items, 'guide', queryUsage(history, 'other', now)), baseline);
});

test('a remembered result is not reported as boosted if relevance or its default position prevents promotion', () => {
  const items = entries(snapshot);
  const scores = new Map([['tab:https://example.com/2', 10]]);
  const baseline = search(items, 'guide');
  const ranked = search(items, 'guide', scores);
  assert.deepEqual(ranked, baseline);
  assert.deepEqual(rankingInfo(ranked, baseline, scores).get('tab:3'), { learned: true, promoted: false });
  assert.deepEqual(rankingInfo(ranked, baseline, scores).get('tab:1'), { learned: false, promoted: false });
});

test('settings destinations learn independently and legacy generic records do not boost every destination', () => {
  const items = entries(snapshot).filter(item => item.settingsSection);
  const language = items.find(item => item.settingsSection === 'language')!;
  const baseline = search(items, 'settings');
  const scores = new Map([[usageTarget(language), 5]]);
  assert.equal(scores.has('command:settings:language'), true);
  assert.notEqual(baseline[0].id, language.id);
  assert.equal(search(items, 'settings', scores)[0].id, language.id);
  assert.deepEqual(search(items, 'settings', new Map([['command:settings', 100]])), baseline);
  assert.equal(new Set(items.map(usageTarget)).size, items.length);
});

test('home explains command aggregation without treating recently accessed tabs as learned', () => {
  const items = entries(snapshot);
  const history = addUsage(addUsage([], 'mute', 'command:mute', now), '', 'command:mute', now);
  const scores = commandUsage(history, now);
  const ranked = homeEntries(items, scores);
  const baseline = homeEntries(items);
  const info = rankingInfo(ranked, baseline, scores);
  assert.equal(ranked.find(item => item.kind === 'command')?.action, 'mute');
  assert.deepEqual(info.get('command:mute'), { learned: true, promoted: true });
  assert.equal(info.get('tab:1')?.learned, false);
});

test('unsupported results cannot inherit phantom action preferences', () => {
  const items = entries(snapshot);
  for (const action of ['help', 'runScript', 'runCopyScript', 'scriptLibrary', 'newScript', 'reloadExtension']) {
    assert.equal(usageTarget(items.find(item => item.action === action)!), '');
  }
  const script = { ...items[0], id: 'script:a', kind: 'script' as const, action: 'runScript' as const, scriptId: 'a' };
  assert.equal(usageTarget(script), '');
});
