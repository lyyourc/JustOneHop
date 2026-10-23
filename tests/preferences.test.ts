import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_AUTO_TUCK_HOURS, isAutoTuckAfterHours, normalizePreferences } from '../src/preferences.ts';

test('missing or invalid saved preferences fall back per field', () => {
  assert.deepEqual(normalizePreferences(null), { language: 'system', theme: 'system', autoTuck: false, autoTuckAfterHours: 168 });
  assert.deepEqual(normalizePreferences({ language: 'fr', theme: 'dark' }), { language: 'system', theme: 'dark', autoTuck: false, autoTuckAfterHours: 168 });
  assert.deepEqual(normalizePreferences({ language: 'zh', theme: 'unknown' }), { language: 'zh', theme: 'system', autoTuck: false, autoTuckAfterHours: 168 });
});

test('pet remains visible by default and hiding is explicitly saved', () => {
  for (const hidePet of [undefined, null, false, 'true', 1]) assert.equal(normalizePreferences({ hidePet }).hidePet, undefined);
  assert.equal(normalizePreferences({ hidePet: true }).hidePet, true);
});

test('automatic tucking is opt-in, including when reading old or invalid settings', () => {
  for (const value of [undefined, null, false, 'true', 1]) {
    assert.equal(normalizePreferences({ autoTuck: value }).autoTuck, false);
  }
  assert.equal(normalizePreferences({ autoTuck: true }).autoTuck, true);
});

test('automatic tuck duration accepts only whole hours from 1 to 8760', () => {
  assert.equal(DEFAULT_AUTO_TUCK_HOURS, 168);
  for (const value of [undefined, null, false, '24', 0, -1, 1.5, 8761, NaN, Infinity, -Infinity]) {
    assert.equal(isAutoTuckAfterHours(value), false, String(value));
    assert.equal(normalizePreferences({ autoTuckAfterHours: value }).autoTuckAfterHours, 168, String(value));
  }
  for (const value of [1, 24, 168, 8760]) {
    assert.equal(isAutoTuckAfterHours(value), true);
    assert.equal(normalizePreferences({ autoTuckAfterHours: value }).autoTuckAfterHours, value);
  }
});
