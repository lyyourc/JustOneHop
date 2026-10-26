import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSingleEmoji, normalizeSearchIcon, prepareSearchIcon } from '../src/searchIconData.ts';
import { normalizePreferences } from '../src/preferences.ts';

test('search icons accept whole Emoji sequences and reject arbitrary text', () => {
  for (const value of ['🚀', '👩🏽‍💻', '👨‍👩‍👧‍👦', '🇨🇳', '1️⃣', '❤️', '🏳️‍🌈']) {
    assert.equal(isSingleEmoji(value), true, value);
    assert.equal(normalizePreferences({ searchIcon: value }).searchIcon, value);
  }
  for (const value of ['', 'a', '1', '🚀🚀', ' 🚀', '🚀 ', '🇨', '<svg/>', 'https://example.com/icon.png', 'data:image/svg+xml,<svg/>']) {
    assert.equal(normalizeSearchIcon(value), undefined, value);
  }
  assert.equal(normalizePreferences({ searchIcon: null }).searchIcon, undefined);
  assert.equal(normalizeSearchIcon('data:image/png;base64,iVBORw0KGgo' + 'A'.repeat(32768)), undefined);
});

test('image picker rejects unsupported, oversized and disguised files before decoding', async () => {
  for (const file of [
    new File(['<svg/>'], 'icon.svg', { type: 'image/svg+xml' }),
    new File(['<svg/>'], 'icon.png', { type: 'image/png' }),
    new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'icon.png', { type: 'image/png' }),
    new File([], 'icon.webp', { type: 'image/webp' }),
  ]) await assert.rejects(prepareSearchIcon(file));
});
