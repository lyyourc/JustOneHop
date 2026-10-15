import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesShortcut, shortcutKeys } from '../src/Shortcut';

test('binding hints and dispatch agree on platform and modifiers', () => {
  assert.deepEqual(shortcutKeys('Mod+Shift+T', true), ['⌘', '⇧', 'T']);
  assert.deepEqual(shortcutKeys('Mod+Enter', false), ['Ctrl', '↵']);
  const event = { key: 'Enter', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false };
  assert.ok(matchesShortcut(event, 'Mod+Enter', true));
  assert.ok(!matchesShortcut(event, 'Mod+Enter', false));
  assert.ok(!matchesShortcut({ ...event, altKey: true }, 'Mod+Enter', true));
  assert.ok(!matchesShortcut({ ...event, shiftKey: true }, 'Mod+Enter', true));
});
