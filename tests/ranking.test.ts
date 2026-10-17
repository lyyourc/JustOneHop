import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entries, homeRecommendations, search } from '../src/model.ts';
import { addUsage, homeUsage, queryUsage, rankingInfo, usageTarget } from '../src/usage.ts';
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

test('home explains command aggregation without treating unlearned pages as candidates', () => {
  const items = entries(snapshot);
  const history = addUsage(addUsage([], 'pin', 'command:pin', now), '', 'command:pin', now);
  const home = homeRecommendations(items, homeUsage(history, now));
  const info = rankingInfo(home.results, home.baseline, home.scores);
  assert.equal(home.results[0]?.action, 'pin');
  assert.deepEqual(info.get('command:pin'), { learned: true, promoted: true });
  assert.equal(info.has('tab:1'), false);
  assert.deepEqual(info.get('command:settings'), { learned: false, promoted: false });
});

test('home ranking compares identical pre-limit candidates and explains bookmark-to-tab learning', () => {
  const items = entries({ ...snapshot,
    bookmarks: [{ id: 'beta', title: 'Saved Beta', url: snapshot.tabs[1].url, folder: '' }] });
  const history = addUsage([], 'saved beta', 'bookmark:beta', now);
  const home = homeRecommendations(items, homeUsage(history, now));
  assert.deepEqual(new Set(home.results.map(item => item.id)), new Set(home.baseline.map(item => item.id)));
  assert.equal(home.results[0].id, 'tab:2');
  assert.equal(home.baseline.at(-1)?.id, 'tab:2');
  assert.equal(home.scores.get(usageTarget(home.results[0])), 1);
  assert.deepEqual(rankingInfo(home.results, home.baseline, home.scores).get('tab:2'), { learned: true, promoted: true });
  assert.deepEqual(home.targets.get('tab:2'), ['bookmark:beta', `tab:${snapshot.tabs[1].url}`]);
  const reset = homeRecommendations(items);
  assert.ok(!reset.results.some(item => item.kind === 'tab'));
  assert.deepEqual(rankingInfo(home.results, home.baseline, reset.scores).get('tab:2'), { learned: false, promoted: false });
});

test('home defaults at the top can be learned without an inaccurate promotion claim', () => {
  const home = homeRecommendations(entries(snapshot), new Map([['command:settings', 3]]));
  assert.deepEqual(home.results, home.baseline);
  assert.deepEqual(rankingInfo(home.results, home.baseline, home.scores).get('command:settings'), { learned: true, promoted: false });
});

test('unsupported results cannot inherit phantom action preferences', () => {
  const items = entries(snapshot);
  for (const action of ['help', 'tabSwitcher', 'runScript', 'runCopyScript', 'scriptLibrary', 'newScript', 'reloadExtension']) {
    assert.equal(usageTarget(items.find(item => item.action === action)!), '');
  }
  const script = { ...items[0], id: 'script:a', kind: 'script' as const, action: 'runScript' as const, scriptId: 'a' };
  assert.equal(usageTarget(script), '');
});
