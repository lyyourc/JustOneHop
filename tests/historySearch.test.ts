import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchHistory } from '../src/api.ts';
import { historyEntries, mergeHistoryResults } from '../src/historySearch.ts';
import { actionsFor, entries, search } from '../src/model.ts';
import { addUsage, queryUsage, rankingInfo, usageTarget } from '../src/usage.ts';
import type { HistoryPage, Snapshot } from '../src/types.ts';

const page = (id: string, title: string, url: string, lastVisitTime = 100): HistoryPage => ({ id, title, url, lastVisitTime });
const snapshot: Snapshot = {
  windowId: 10, currentTabId: 1, shortcut: '',
  tabs: [{ id: 1, windowId: 10, index: 0, title: 'Guide', url: 'https://tab.example/', active: true, pinned: false, muted: false, audible: false }],
  bookmarks: [{ id: 'book', title: 'Guide', url: 'https://book.example/', folder: '' }],
};

test('history entries offer opening and copying the complete URL', () => {
  const [entry] = historyEntries([page('42', 'Old guide', 'https://example.com/docs?q=one#two', 345)]);
  assert.equal(entry.id, 'history:42');
  assert.equal(entry.kind, 'history');
  assert.equal(entry.action, 'openHistoryPage');
  assert.equal(entry.url, 'https://example.com/docs?q=one#two');
  assert.equal(entry.faviconPageUrl, entry.url);
  assert.equal(entry.keywords, entry.url);
  assert.equal(entry.lastVisitTime, 345);
  assert.equal(entry.subtitle, 'example.com/docs');
  const actions = actionsFor(entry, snapshot);
  assert.deepEqual(actions.map(action => action.action), ['openHistoryPage', 'copyUrl']);
  assert.deepEqual(actions.map(action => action.url), ['https://example.com/docs?q=one#two', 'https://example.com/docs?q=one#two']);
  assert.equal(usageTarget(actions[1]), '');
});

test('history joins title, domain and exact URL metadata relevance tiers', () => {
  const candidates = historyEntries([
    page('metadata', 'Other page', 'https://other.example/guide'),
    page('domain', '本地页面', 'https://guide.example/'),
    page('exact', 'Guide', 'https://exact.example/'),
    page('prefix', 'Guide reference', 'https://prefix.example/'),
  ]);
  const ranked = search(candidates, 'guide').map(item => item.id);
  assert.equal(ranked[0], 'history:exact');
  assert.deepEqual(new Set(ranked.slice(1, 3)), new Set(['history:domain', 'history:prefix']));
  assert.equal(ranked[3], 'history:metadata');
  assert.equal(search(candidates, 'other.example/guide')[0]?.id, 'history:metadata');
  assert.deepEqual(search(historyEntries([page('query', 'Other', 'https://example.com/?needle=yes#section')]), 'needle=yes').map(item => item.id), ['history:query']);
  assert.equal(search(historyEntries([page('hash', 'Other', 'https://example.com/#section')]), 'section')[0]?.id, 'history:hash');
});

test('history respects relevance and default source order while URL preferences can reorder same-tier results', () => {
  const history = historyEntries([page('new', 'Guide', 'https://new.example/', 200), page('old', 'Guide', 'https://old.example/', 100)]);
  const base = entries(snapshot).filter(entry => entry.kind === 'tab' || entry.kind === 'bookmark');
  const learned = new Map([['command:openHistoryPage', 1e9], ['history:new', 1e9], ['history:old', 1e12]]);
  assert.deepEqual(search([...history, ...base], 'guide', learned).map(item => item.id), ['tab:1', 'bookmark:book', 'history:new', 'history:old']);
  const scores = new Map([['tab:https://old.example/', 1]]);
  assert.deepEqual(search([...history, ...base], 'guide', scores).map(item => item.id), ['history:old', 'tab:1', 'bookmark:book', 'history:new']);
  const weakerTab = { ...base[0], title: 'Guide reference' };
  assert.deepEqual(search([weakerTab, history[0]], 'guide', new Map([[`tab:${weakerTab.keywords}`, 1e9]])).map(item => item.id), ['history:new', 'tab:1']);
});

test('c2c-web history selection beats newer same-tier history and survives opening as a tab', () => {
  const now = Date.now();
  const history = historyEntries([
    page('recent', 'Project', 'https://other.example/c2c-web', now),
    page('selected', 'Project', 'https://g.echo.tech/c2c-web', now - 1000),
  ]);
  const scores = queryUsage(addUsage([], 'c2c-web', usageTarget(history[1]), now), 'c2c-web', now);
  const baseline = search(history, 'c2c-web');
  assert.equal(baseline[0].id, 'history:recent');
  const ranked = search(history, 'c2c-web', scores);
  assert.equal(ranked[0].id, 'history:selected');
  assert.deepEqual(rankingInfo(ranked, baseline, scores).get('history:selected'), { learned: true, promoted: true });
  const tab = entries({ ...snapshot, bookmarks: [], tabs: [{ ...snapshot.tabs[0], title: 'Project', url: 'https://g.echo.tech/c2c-web' }] })[0];
  assert.equal(usageTarget(tab), usageTarget(history[1]));
  assert.equal(search(mergeHistoryResults([tab], history), 'c2c-web', scores)[0].id, tab.id);
  assert.equal(search(history, 'c2c-web', new Map())[0].id, 'history:recent');
  const exact = historyEntries([page('exact', 'c2c-web', 'https://exact.example/', now)]);
  assert.equal(search([...history, ...exact], 'c2c-web', scores)[0].id, 'history:exact');
  assert.notEqual(usageTarget({ ...history[1], url: `${history[1].url}?q=other` }), usageTarget(history[1]));
});

test('history recency breaks same-tier ties before incidental Fuse scores', () => {
  const candidates = historyEntries([
    page('older', 'Guide', 'https://guide.example/', 100),
    page('newer', 'Guide for a long page title', 'https://other.example/', 200),
  ]);
  assert.deepEqual(search(candidates, 'gui').map(item => item.id), ['history:newer', 'history:older']);
  assert.deepEqual(search(candidates, 'guide').map(item => item.id), ['history:older', 'history:newer']);
});

test('dedup removes only history matching a tab or bookmark and preserves URL query and fragments', () => {
  const base = entries({ ...snapshot,
    tabs: [{ ...snapshot.tabs[0], url: 'https://EXAMPLE.com:443/path?q=one#part' }],
    bookmarks: [{ ...snapshot.bookmarks[0], url: 'https://book.example/' }],
  }).filter(entry => entry.kind === 'tab' || entry.kind === 'bookmark');
  const history = historyEntries([
    page('same-tab', 'Match', 'https://example.com/path?q=one#part'),
    page('same-bookmark', 'Match', 'https://book.example'),
    page('query', 'Different query', 'https://example.com/path?q=two#part'),
    page('fragment', 'Different fragment', 'https://example.com/path?q=one#other'),
    page('protocol', 'Different protocol', 'http://example.com/path?q=one#part'),
  ]);
  assert.deepEqual(mergeHistoryResults(base, history).map(item => item.id), ['tab:1', 'bookmark:book', 'history:query', 'history:fragment', 'history:protocol']);
  assert.deepEqual(mergeHistoryResults([], history), history);
  assert.deepEqual(mergeHistoryResults([history[0]], [history[0]]), [history[0], history[0]]);
  const duplicateBookmark = { ...base[1], url: base[0].url, faviconPageUrl: base[0].url };
  assert.deepEqual(mergeHistoryResults([base[0], duplicateBookmark], []), [base[0], duplicateBookmark]);
});

test('history API sends the query and scope over IPC and propagates failures', async () => {
  const previous = globalThis.chrome;
  const requests: unknown[] = [];
  const result = { items: [page('one', 'Guide', 'https://example.com/')], limited: false };
  try {
    globalThis.chrome = { runtime: { sendMessage: async request => { requests.push(request); return { ok: true, data: result }; } } } as typeof chrome;
    assert.deepEqual(await searchHistory('guide', 'week'), result);
    assert.deepEqual(await searchHistory('guide', 'all'), result);
    assert.deepEqual(requests, [
      { source: 'justonehop', type: 'search-history', payload: { query: 'guide', scope: 'week' } },
      { source: 'justonehop', type: 'search-history', payload: { query: 'guide', scope: 'all' } },
    ]);
    chrome.runtime.sendMessage = (async () => ({ ok: false, error: 'History unavailable' })) as typeof chrome.runtime.sendMessage;
    await assert.rejects(searchHistory('guide', 'week'), /History unavailable/);
  } finally { globalThis.chrome = previous; }
});
