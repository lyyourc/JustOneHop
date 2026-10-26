import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { forgetUsage, recordUsage, resetUsage } from '../src/usageStorage.ts';
import { USAGE_STORAGE_KEY, type UsageRecord } from '../src/usage.ts';

let stored: Record<string, UsageRecord[]>;
beforeEach(() => {
  stored = {};
  globalThis.chrome = { storage: { local: {
    get: async () => structuredClone(stored),
    set: async (value: typeof stored) => { stored = structuredClone(value); },
    remove: async (key: string) => { delete stored[key]; },
  }, session: { get: async () => ({}), set: async () => {} } } } as unknown as typeof chrome;
});

test('simultaneous selections are serialized without lost updates', async () => {
  await Promise.all(Array.from({ length: 12 }, () => recordUsage('iam', 'tab:https://iam.example/')));
  assert.equal(stored[USAGE_STORAGE_KEY].length, 1);
  assert.ok(stored[USAGE_STORAGE_KEY][0].weight > 11.99);
});

test('a failed history write does not poison later saves', async () => {
  const original = chrome.storage.local.set;
  chrome.storage.local.set = async () => { throw new Error('Disk unavailable'); };
  await assert.rejects(recordUsage('iam', 'tab:https://iam.example/'));
  chrome.storage.local.set = original;
  await recordUsage('iam', 'tab:https://iam.example/');
  assert.equal(stored[USAGE_STORAGE_KEY][0].weight, 1);
});

test('reset is ordered with pending writes and explicit home page selections persist', async () => {
  await Promise.all([recordUsage('iam', 'tab:first'), resetUsage()]);
  assert.deepEqual(stored, {});
  await recordUsage(' ', 'tab:first');
  await recordUsage('', 'bookmark:second');
  assert.deepEqual(new Set(stored[USAGE_STORAGE_KEY].map(record => record.target)), new Set(['tab:first', 'bookmark:second']));
  assert.ok(stored[USAGE_STORAGE_KEY].every(record => record.query === ''));
  await forgetUsage('tab:first');
  assert.deepEqual(stored[USAGE_STORAGE_KEY].map(record => record.target), ['bookmark:second']);
  await resetUsage();
  assert.deepEqual(stored, {});
});

test('invalid home targets never access storage', async () => {
  let reads = 0;
  chrome.storage.local.get = (async () => { reads++; return {}; }) as typeof chrome.storage.local.get;
  await recordUsage('', 'unsupported:first');
  await recordUsage('', 'tab:');
  assert.equal(reads, 0);
  assert.deepEqual(stored, {});
});

test('home command selections persist through the same queue and reset', async () => {
  await Promise.all([recordUsage('', 'command:reload'), recordUsage('  ', 'command:reload')]);
  assert.equal(stored[USAGE_STORAGE_KEY].length, 1);
  assert.equal(stored[USAGE_STORAGE_KEY][0].query, '');
  assert.ok(stored[USAGE_STORAGE_KEY][0].weight > 1.99);
  await resetUsage();
  assert.deepEqual(stored, {});
});

test('forgetting a target without a query removes all its queries and preserves other targets', async () => {
  await Promise.all([
    recordUsage('', 'command:settings:theme'), recordUsage('theme', 'command:settings:theme'),
    recordUsage('appearance', 'command:settings:theme'), recordUsage('theme', 'command:settings'),
    recordUsage('theme', 'command:settings:language'), recordUsage('theme', 'tab:theme'),
  ]);
  const retained = stored[USAGE_STORAGE_KEY].filter(record => record.target !== 'command:settings:theme');
  await forgetUsage('command:settings:theme');
  assert.deepEqual(stored[USAGE_STORAGE_KEY], retained);
  await forgetUsage('command:settings:theme');
  assert.deepEqual(stored[USAGE_STORAGE_KEY], retained);
});

test('forgetting a page recommendation atomically removes every contributing identity across queries', async () => {
  await Promise.all([
    recordUsage('', 'tab:https://example.com/'), recordUsage('example', 'tab:https://example.com/'),
    recordUsage('', 'bookmark:a'), recordUsage('saved', 'bookmark:a'), recordUsage('other', 'bookmark:b'),
    recordUsage('keep', 'bookmark:unrelated'),
  ]);
  const saved = structuredClone(stored);
  const targets = ['tab:https://example.com/', 'bookmark:a', 'bookmark:b'];
  const set = chrome.storage.local.set;
  let writes = 0;
  chrome.storage.local.set = async () => { writes++; throw new Error('Disk unavailable'); };
  await assert.rejects(forgetUsage(targets), /Disk unavailable/);
  assert.equal(writes, 1);
  assert.deepEqual(stored, saved);
  chrome.storage.local.set = (async value => { writes++; await set(value); }) as typeof set;
  await forgetUsage(targets);
  assert.equal(writes, 2);
  assert.deepEqual(stored[USAGE_STORAGE_KEY].map(record => record.target), ['bookmark:unrelated']);
});

test('multi-target forgetting preserves query scope and validates the whole set before storage', async () => {
  await Promise.all([recordUsage('same', 'bookmark:a'), recordUsage('other', 'bookmark:a'), recordUsage('same', 'tab:a')]);
  let reads = 0;
  const get = chrome.storage.local.get;
  chrome.storage.local.get = (async () => { reads++; return structuredClone(stored); }) as typeof get;
  for (const targets of [[], ['bookmark:a', ''], ['bookmark:a', 'x'.repeat(4097)], Array(503).fill('bookmark:a')]) {
    await assert.rejects(forgetUsage(targets), /Invalid usage target/);
  }
  assert.equal(reads, 0);
  await forgetUsage(['bookmark:a', 'tab:a'], ' SAME ');
  assert.equal(reads, 1);
  assert.deepEqual(stored[USAGE_STORAGE_KEY].map(record => [record.query, record.target]), [['other', 'bookmark:a']]);
});

test('forgetting a normalized query only removes its exact target and query pair', async () => {
  await Promise.all([
    recordUsage(' Dark  Theme ', 'command:settings:theme'), recordUsage('other', 'command:settings:theme'),
    recordUsage('', 'command:settings:theme'), recordUsage('dark theme', 'command:settings'),
    recordUsage('dark theme', 'tab:theme'),
  ]);
  const retained = stored[USAGE_STORAGE_KEY].filter(record => !(record.target === 'command:settings:theme' && record.query === 'dark theme'));
  await forgetUsage('command:settings:theme', '  DARK\n\t THEME  ');
  assert.deepEqual(stored[USAGE_STORAGE_KEY], retained);
});

test('an explicit blank query only forgets home selections, while an omitted query forgets all', async () => {
  await recordUsage('', 'command:reload');
  await recordUsage('reload', 'command:reload');
  const searched = structuredClone(stored[USAGE_STORAGE_KEY].filter(record => record.query === 'reload'));
  await forgetUsage('command:reload', ' \n\t ');
  assert.deepEqual(stored[USAGE_STORAGE_KEY], searched);
  await recordUsage('', 'command:reload');
  await forgetUsage('command:reload', '');
  assert.deepEqual(stored[USAGE_STORAGE_KEY], searched);
  await forgetUsage('command:reload');
  assert.deepEqual(stored[USAGE_STORAGE_KEY], []);
});

test('forgetting validates runtime target and normalized query bounds before accessing storage', async () => {
  await recordUsage('keep', 'command:reload');
  const saved = structuredClone(stored);
  let reads = 0;
  let writes = 0;
  const get = chrome.storage.local.get;
  const set = chrome.storage.local.set;
  chrome.storage.local.get = (async () => { reads++; return structuredClone(stored); }) as typeof get;
  chrome.storage.local.set = (async () => { writes++; }) as typeof set;
  for (const target of ['', 'x'.repeat(4097)]) {
    await assert.rejects(forgetUsage(target), /Invalid usage target/);
  }
  await assert.rejects(forgetUsage('command:reload', 'x'.repeat(201)), /Invalid usage query/);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
  assert.deepEqual(stored, saved);
  chrome.storage.local.get = get;
  chrome.storage.local.set = set;
  await forgetUsage('command:unknown');
  const target = 'x'.repeat(4096);
  await recordUsage('x'.repeat(200), target);
  await forgetUsage(target, `  ${'X'.repeat(200)}  `);
  assert.deepEqual(stored, saved);
});

test('forgetting shares the write queue and resolves only after persistence', async () => {
  await recordUsage('old', 'command:reload');
  let release!: () => void;
  let started!: () => void;
  const writing = new Promise<void>(resolve => { started = resolve; });
  const set = chrome.storage.local.set;
  let writes = 0;
  chrome.storage.local.set = (async value => {
    if (++writes === 1) {
      started();
      await new Promise<void>(resolve => { release = resolve; });
    }
    await set(value);
  }) as typeof set;
  let completed = false;
  const deletion = forgetUsage('command:reload').then(() => { completed = true; });
  const selection = recordUsage('later', 'command:reload');
  await writing;
  assert.equal(completed, false);
  assert.equal(writes, 1);
  assert.equal(stored[USAGE_STORAGE_KEY][0].query, 'old');
  release();
  await Promise.all([deletion, selection]);
  assert.equal(completed, true);
  assert.equal(stored[USAGE_STORAGE_KEY].length, 1);
  assert.equal(stored[USAGE_STORAGE_KEY][0].query, 'later');
});

test('queued selections, scoped deletions, target deletions and resets keep invocation order', async () => {
  await Promise.all([
    recordUsage('before', 'command:reload'), recordUsage('keep', 'command:reload'),
    forgetUsage('command:reload', 'before'), recordUsage('after', 'command:reload'),
  ]);
  assert.deepEqual(new Set(stored[USAGE_STORAGE_KEY].map(record => record.query)), new Set(['keep', 'after']));
  await Promise.all([recordUsage('before delete', 'command:reload'), forgetUsage('command:reload'), recordUsage('new', 'command:reload')]);
  assert.deepEqual(stored[USAGE_STORAGE_KEY].map(record => record.query), ['new']);
  await Promise.all([forgetUsage('command:reload'), resetUsage(), recordUsage('after reset', 'tab:other')]);
  assert.deepEqual(stored[USAGE_STORAGE_KEY].map(record => [record.query, record.target]), [['after reset', 'tab:other']]);
});

test('failed deletion reads and writes reject without erasing history or poisoning subsequent operations', async () => {
  await recordUsage('saved', 'command:reload');
  const saved = structuredClone(stored);
  for (const method of ['get', 'set'] as const) {
    const original = chrome.storage.local[method];
    let attempts = 0;
    chrome.storage.local[method] = (async (...args: unknown[]) => {
      if (++attempts === 1) throw new Error('Disk unavailable');
      return (original as (...args: unknown[]) => unknown)(...args);
    }) as typeof original;
    await assert.rejects(forgetUsage('command:reload'), /Disk unavailable/);
    assert.deepEqual(stored, saved);
    await Promise.all([
      recordUsage('later', 'tab:later'), forgetUsage('tab:later'),
    ]);
    assert.deepEqual(stored, saved);
    chrome.storage.local[method] = original;
  }
  await forgetUsage('command:reload');
  assert.deepEqual(stored[USAGE_STORAGE_KEY], []);
});
