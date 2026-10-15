import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePreferences } from '../src/preferences.ts';

test('missing or invalid saved preferences fall back per field', () => {
  assert.deepEqual(normalizePreferences(null), { language: 'system', theme: 'system' });
  assert.deepEqual(normalizePreferences({ language: 'fr', theme: 'dark' }), { language: 'system', theme: 'dark' });
  assert.deepEqual(normalizePreferences({ language: 'zh', theme: 'unknown' }), { language: 'zh', theme: 'system' });
});
