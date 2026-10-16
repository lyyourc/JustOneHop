import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePreferences } from '../src/preferences.ts';

test('missing or invalid saved preferences fall back per field', () => {
  assert.deepEqual(normalizePreferences(null), { language: 'system', theme: 'system', autoTuck: false });
  assert.deepEqual(normalizePreferences({ language: 'fr', theme: 'dark' }), { language: 'system', theme: 'dark', autoTuck: false });
  assert.deepEqual(normalizePreferences({ language: 'zh', theme: 'unknown' }), { language: 'zh', theme: 'system', autoTuck: false });
});

test('automatic tucking is opt-in, including when reading old or invalid settings', () => {
  for (const value of [undefined, null, false, 'true', 1]) {
    assert.equal(normalizePreferences({ autoTuck: value }).autoTuck, false);
  }
  assert.equal(normalizePreferences({ autoTuck: true }).autoTuck, true);
});
