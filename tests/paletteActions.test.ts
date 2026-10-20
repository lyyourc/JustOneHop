import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepsPaletteOpen, nearbySelection } from '../src/paletteActions.ts';

test('list mutations keep the palette open while navigation and host reload hand off to the page', () => {
  for (const action of ['closeOthers', 'closeRight', 'pin', 'mute', 'undoTuck', 'ungroupTab', 'updateGroup', 'ungroupGroup', 'closeGroup'] as const) {
    assert.equal(keepsPaletteOpen(action, 1, 1), true, action);
  }
  for (const action of ['switch', 'newTab', 'openBookmark', 'restore', 'openExtensions', 'openPasswords'] as const) {
    assert.equal(keepsPaletteOpen(action, 2, 1), false, action);
  }
  for (const action of ['close', 'reload', 'tuck'] as const) {
    assert.equal(keepsPaletteOpen(action, 1, 1), false);
    assert.equal(keepsPaletteOpen(action, 2, 1), true);
  }
});

test('bookmark mutations keep the palette open for both source and selected tabs', () => {
  for (const action of ['bookmarkTab', 'unbookmarkTab', 'removeBookmark'] as const) {
    for (const target of [1, 2]) assert.equal(keepsPaletteOpen(action, target, 1), true, `${action}: ${target}`);
  }
});

test('selection follows identity and then the nearest survivor in the original list', () => {
  const original = ['a', 'b', 'c', 'd'];
  assert.equal(nearbySelection(original, ['d', 'b', 'a', 'c'], 'b'), 'b');
  assert.equal(nearbySelection(original, ['d', 'a', 'c'], 'b'), 'c');
  assert.equal(nearbySelection(original, ['a', 'b', 'c'], 'd'), 'c');
  assert.equal(nearbySelection(original, ['a', 'd'], 'b'), 'd');
  assert.equal(nearbySelection(original, ['a'], 'c'), 'a');
  assert.equal(nearbySelection(original, [], 'c'), '');
  assert.equal(nearbySelection(original, ['new'], 'c'), 'new');
});

test('a neutral selection after source closure cannot rearm a destructive command on refresh', () => {
  assert.equal(nearbySelection(['close'], ['close', 'closeOthers'], null), null);
  assert.equal(nearbySelection([], ['close'], null), null);
  assert.equal(nearbySelection(['a'], ['b'], ''), 'b');
});
