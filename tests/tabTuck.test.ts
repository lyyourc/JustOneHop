import test from 'node:test';
import assert from 'node:assert/strict';
import { idleTabEligible, TUCK_AFTER } from '../src/tabTuck';

const now = Date.UTC(2026, 9, 15);
const tab = { id: 1, windowId: 10, index: 2, url: 'https://example.com', active: false, pinned: false,
  groupId: -1, highlighted: false, incognito: false, status: 'complete' } as chrome.tabs.Tab;

test('automatic tuck requires a full seven days, including at the exact boundary', () => {
  assert.equal(idleTabEligible(tab, now - TUCK_AFTER + 1, now), false);
  assert.equal(idleTabEligible(tab, now - TUCK_AFTER, now), true);
  assert.equal(idleTabEligible(tab, now, now), false);
});
test('current, pinned, grouped, selected, audible and loading tabs stay in place', () => {
  for (const change of [ { active: true }, { pinned: true }, { groupId: 123 }, { highlighted: true },
    { audible: true }, { status: 'loading' }, { splitViewId: 4 }, { incognito: true }, { id: undefined } ]) {
    assert.equal(idleTabEligible({ ...tab, ...change } as chrome.tabs.Tab, now - TUCK_AFTER, now), false, JSON.stringify(change));
  }
});
test('missing and invalid timestamps never make a tab look old', () => {
  for (const value of [NaN, Infinity, -Infinity, 0, -1, now + TUCK_AFTER]) {
    assert.equal(idleTabEligible(tab, value, now), false, String(value));
  }
});
test('discarded tabs can be tucked without reloading them, and absent new Chrome fields remain compatible', () => {
  assert.equal(idleTabEligible({ ...tab, discarded: true }, now - TUCK_AFTER, now), true);
  assert.equal(idleTabEligible({ ...tab, groupId: undefined } as unknown as chrome.tabs.Tab, now - TUCK_AFTER, now), true);
});
