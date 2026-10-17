import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveHistoryQuery } from '../src/historyQuery';
import { insertHistorySearch, isHistorySearchIntent, historySearchEntry } from '../src/historyPresentation';
import type { Entry, HistorySearchResult } from '../src/types';

const page = { id: '1', url: 'https://example.com/', title: 'Example', lastVisitTime: 1 };
const result: HistorySearchResult = { items: [page], limited: false };
const entry = (id: string): Entry => ({ id, kind: 'command', action: 'newTab', title: id, subtitle: '', keywords: '', icon: 'plus' });

test('fast history replies are committed with their limit state', async () => {
  assert.deepEqual(await resolveHistoryQuery(Promise.resolve(result), 100), { ...result, state: 'ready' });
});
test('history deadline commits once and ignores a later success', async () => {
  let finish!: (value: HistorySearchResult) => void;
  const pending = new Promise<HistorySearchResult>(resolve => { finish = resolve; });
  const outcome = await resolveHistoryQuery(pending, 5);
  assert.equal(outcome.state, 'timeout');
  finish(result);
  await pending;
  assert.deepEqual(outcome, { items: [], limited: false, state: 'timeout' });
});
test('history failures and timeouts are distinct, including late rejection', async () => {
  assert.equal((await resolveHistoryQuery(Promise.reject(new Error('denied')), 100)).state, 'error');
  let fail!: (reason: Error) => void;
  const pending = new Promise<HistorySearchResult>((_, reject) => { fail = reject; });
  assert.equal((await resolveHistoryQuery(pending, 5)).state, 'timeout');
  fail(new Error('late'));
  await Promise.resolve();
});
test('all-history action occupies fifth slot without exceeding the 100-row display limit', () => {
  const rows = Array.from({ length: 150 }, (_, i) => entry(String(i)));
  const action = entry('all-history');
  const visible = insertHistorySearch(rows, action);
  assert.equal(visible.length, 100);
  assert.equal(visible[4], action);
  assert.deepEqual(visible.filter(row => row !== action), rows.slice(0, 99));
  assert.equal(rows.length, 150);
  for (const count of [0, 1, 3, 4]) {
    assert.deepEqual(insertHistorySearch(rows.slice(0, count), action), [...rows.slice(0, count), action]);
  }
});

test('explicit bilingual history intent promotes the entry without swallowing page queries', () => {
  const rows = Array.from({ length: 8 }, (_, i) => entry(String(i)));
  const outcome = { ...result, state: 'ready' as const };
  for (const query of ['history', ' HISTORY ', 'search   all history', 'browsing history', '历史', '历史记录', '浏览历史', '搜索历史', '搜索全部历史']) {
    assert.equal(isHistorySearchIntent(query), true);
    const action = historySearchEntry(outcome, query);
    const visible = insertHistorySearch(rows, action, query);
    assert.equal(visible[0], action);
    assert.deepEqual(visible.slice(1), rows);
  }
  for (const query of ['', 'react history', 'history api', '历史论文', 'chrome history']) {
    assert.equal(isHistorySearchIntent(query), false);
    const action = historySearchEntry(outcome, query);
    assert.equal(insertHistorySearch(rows, action, query)[4], action);
  }
});
