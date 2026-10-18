import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeShortcut, formatShortcut, matchesShortcut, shortcutKeys } from '../src/Shortcut';

test('shortcut explanations expand actual keys without assuming the default binding', () => {
  for (const [binding, description] of [
    ['⇧⌘P', 'Shift + Command + P'], ['⌃Tab', 'Control + Tab'],
    ['Ctrl+Shift+Y', 'Control + Shift + Y'], ['⌥⌘↵', 'Option + Command + Enter'],
    ['⌘,', 'Command + ,'], ['Alt+F2', 'Alt + F2'], ['Ctrl++', 'Control + +'],
    ['↑', 'Arrow Up'], ['esc', 'Escape'], ['', ''],
  ]) assert.equal(describeShortcut(binding), description);
});

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
  const alt = { ...event, metaKey: false, altKey: true };
  assert.ok(matchesShortcut(alt, 'Alt+Enter', false));
  assert.ok(!matchesShortcut({ ...alt, ctrlKey: true }, 'Alt+Enter', false));
  assert.ok(!matchesShortcut({ ...alt, shiftKey: true }, 'Alt+Enter', false));
  assert.ok(!matchesShortcut({ ...alt, metaKey: true }, 'Alt+Enter', false));
  assert.equal(formatShortcut(shortcutKeys('Alt+Enter', false)), 'Alt+↵');
  assert.equal(formatShortcut(shortcutKeys('Alt+Enter', true)), '⌥↵');
});
