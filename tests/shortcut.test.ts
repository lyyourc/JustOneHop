import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatShortcut, matchesShortcut, shortcutKeys } from '../src/Shortcut';

test('binding hints and dispatch agree on platform and modifiers', () => {
  assert.deepEqual(shortcutKeys('Mod+Shift+T', true), ['⌘', '⇧', 'T']);
  assert.deepEqual(shortcutKeys('Mod+Enter', false), ['Ctrl', '↵']);
  assert.equal(formatShortcut(shortcutKeys('Mod+Shift+T', true)), '⌘⇧T');
  assert.equal(formatShortcut(shortcutKeys('Mod+Enter', false)), 'Ctrl+↵');
  assert.equal(formatShortcut(['Ctrl', 'P']), 'Ctrl+P');
  const event = { key: 'Enter', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false };
  assert.ok(matchesShortcut(event, 'Mod+Enter', true));
  assert.ok(!matchesShortcut(event, 'Mod+Enter', false));
  assert.ok(!matchesShortcut({ ...event, altKey: true }, 'Mod+Enter', true));
  assert.ok(!matchesShortcut({ ...event, shiftKey: true }, 'Mod+Enter', true));
});
