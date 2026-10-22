import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { canContinueSearch, forgetSearchContinuations, getSearchContinuation, recordSearchContinuation, SEARCH_CONTINUATION_KEY, SEARCH_CONTINUATION_TTL, validContinuation } from '../src/searchContinuation';
import type { Entry, Execution } from '../src/types';

let stored: Record<string, unknown>;
beforeEach(() => {
  stored = {};
  globalThis.chrome = { storage: { session: {
    get: async () => structuredClone(stored), set: async (values: Record<string, unknown>) => { Object.assign(stored, structuredClone(values)); },
  } } } as unknown as typeof chrome;
});
const execution: Execution = { action: 'switch', windowId: 1, tabId: 2, query: 'GitHub issues', continueSearch: true };
const target = 'tab:https://github.com/issues';
const page = (url: string): Entry => ({ id: url, url, kind: 'tab', action: 'switch', title: url, subtitle: url, keywords: url, icon: 'tab' });

test('continuation requires a page selection and at least two distinct available destinations', () => {
  const first = page('https://github.com/');
  assert.equal(canContinueSearch('github', first, [first, page(first.url!)]), false);
  assert.equal(canContinueSearch('github', first, [first, { ...page('https://github.com/issues'), disabled: true }]), false);
  assert.equal(canContinueSearch('github', first, [first, page('https://github.com/issues')]), true);
  assert.equal(canContinueSearch('', first, [first, page('https://github.com/issues')]), false);
  assert.equal(canContinueSearch('github', { ...first, action: 'navigateAddress' }, [first, page('https://github.com/issues')]), false);
});

test('successful qualifying selections replace only their window record and expire after ten minutes', async () => {
  await recordSearchContinuation(execution, target);
  assert.equal((await getSearchContinuation(1))?.query, 'GitHub issues');
  assert.equal(await getSearchContinuation(2), undefined);
  await recordSearchContinuation({ ...execution, windowId: 2, query: 'other' }, target);
  await recordSearchContinuation({ ...execution, query: 'latest' }, target);
  assert.equal((await getSearchContinuation(1))?.query, 'latest');
  assert.equal((await getSearchContinuation(2))?.query, 'other');
  const record = (await getSearchContinuation(1))!;
  assert.equal(validContinuation(record, record.at + SEARCH_CONTINUATION_TTL - 1), true);
  assert.equal(validContinuation(record, record.at + SEARCH_CONTINUATION_TTL), false);
  assert.equal(validContinuation(record, record.at - 1), false);
  stored = {}; // A new browser session has no session storage.
  assert.equal(await getSearchContinuation(1), undefined);
});

test('private, command, URL and ineligible executions never update continuation', async () => {
  await recordSearchContinuation(execution, '');
  await recordSearchContinuation({ ...execution, continueSearch: false }, target);
  await recordSearchContinuation({ ...execution, action: 'reload' }, 'command:reload');
  await recordSearchContinuation({ ...execution, action: 'navigateAddress' }, 'query:navigation');
  assert.deepEqual(stored, {});
});

test('forgetting respects target and query while reset removes all window records', async () => {
  await recordSearchContinuation(execution, target);
  await forgetSearchContinuations(new Set([target]), 'unrelated');
  assert.ok(await getSearchContinuation(1));
  await forgetSearchContinuations(new Set([target]), 'github issues');
  assert.equal(await getSearchContinuation(1), undefined);
  await recordSearchContinuation(execution, target);
  await forgetSearchContinuations();
  assert.deepEqual(stored[SEARCH_CONTINUATION_KEY], {});
});
