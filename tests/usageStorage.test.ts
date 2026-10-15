import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { recordUsage, resetUsage } from '../src/usageStorage.ts';
import { USAGE_STORAGE_KEY, type UsageRecord } from '../src/usage.ts';

let stored: Record<string, UsageRecord[]>;
beforeEach(() => {
  stored = {};
  globalThis.chrome = { storage: { local: {
    get: async () => structuredClone(stored),
    set: async (value: typeof stored) => { stored = structuredClone(value); },
    remove: async (key: string) => { delete stored[key]; },
  } } } as unknown as typeof chrome;
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

test('reset is ordered with pending writes and blank tab queries never write', async () => {
  await Promise.all([recordUsage('iam', 'tab:first'), resetUsage()]);
  assert.deepEqual(stored, {});
  await recordUsage(' ', 'tab:first');
  assert.deepEqual(stored, {});
  await recordUsage('iam', 'tab:second');
  assert.equal(stored[USAGE_STORAGE_KEY][0].target, 'tab:second');
});

test('home command selections persist through the same queue and reset', async () => {
  await Promise.all([recordUsage('', 'command:reload'), recordUsage('  ', 'command:reload')]);
  assert.equal(stored[USAGE_STORAGE_KEY].length, 1);
  assert.equal(stored[USAGE_STORAGE_KEY][0].query, '');
  assert.ok(stored[USAGE_STORAGE_KEY][0].weight > 1.99);
  await resetUsage();
  assert.deepEqual(stored, {});
});
