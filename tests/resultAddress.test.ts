import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distinctResultAddresses } from '../src/resultAddress';
import { historyEntries } from '../src/historySearch';

const root = 'https://github.com/lyyourc/JustOneHop';
const entry = (id: string, url: string, title = 'JustOneHop') => historyEntries([{ id, url, title, lastVisitTime: 1 }])[0];

test('same labels reveal fragments and queries without changing entries or destinations', () => {
  const items = [ { ...entry('tab', root), kind: 'tab' as const }, entry('anchor', root + '#quick-shortcuts'), entry('query', root + '?tab=readme#top') ];
  const before = structuredClone(items);
  const labels = distinctResultAddresses(items);
  assert.deepEqual(labels.get('history:anchor'), { base: 'github.com/lyyourc/JustOneHop', detail: '#quick-shortcuts', url: root + '#quick-shortcuts' });
  assert.equal(labels.get('history:query')?.detail, '?tab=readme#top');
  assert.equal(labels.get('history:tab')?.detail, '');
  assert.deepEqual(items, before);
});

test('unique labels and identical destinations stay concise', () => {
  assert.equal(distinctResultAddresses([entry('a', root + '#top')]).size, 0);
  assert.equal(distinctResultAddresses([entry('a', root), entry('b', root)]).size, 0);
  assert.equal(distinctResultAddresses([entry('a', root), entry('b', root + '#top', 'Chapter')]).size, 0);
});

test('protocol and port differences use full addresses instead of indistinguishable suffixes', () => {
  const labels = distinctResultAddresses([entry('a', 'https://example.com/docs'), entry('b', 'http://example.com/docs'), entry('c', 'https://example.com:8443/docs')]);
  assert.equal(labels.get('history:b')?.detail, 'http://example.com/docs');
  assert.equal(labels.get('history:c')?.detail, 'https://example.com:8443/docs');
});
