import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressNewTabShortcut, addressUrl } from '../src/address';
import { addressEntry, addressActions } from '../src/addressPresentation';
import { usageTarget } from '../src/usage';
import { keepsPaletteOpen } from '../src/paletteActions';
import type { Entry, Snapshot } from '../src/types';

const data: Snapshot = { windowId: 10, currentTabId: 2, shortcut: '', bookmarks: [], tabs: [
  { id: 2, windowId: 10, index: 0, title: 'Source', url: 'chrome://version/', active: true, pinned: false, muted: false, audible: false },
] };

test('typed addresses normalize protocols while preserving path, query, and fragment case', () => {
  for (const [input, expected] of [
    [' example.com/Docs?Q=A%2Bb#Part ', 'https://example.com/Docs?Q=A%2Bb#Part'],
    ['https://EXAMPLE.com:443/a', 'https://example.com/a'],
    ['http://example.com/a', 'http://example.com/a'],
    ['localhost:3000/Dev', 'http://localhost:3000/Dev'],
    ['127.0.0.1:8080/x', 'http://127.0.0.1:8080/x'],
    ['[::1]:3000/x', 'http://[::1]:3000/x'],
    ['192.168.1.10:8080/', 'https://192.168.1.10:8080/'],
    ['https://intranet/path', 'https://intranet/path'],
    ['例子.中国/路径', 'https://xn--fsqu00a.xn--fiqs8s/%E8%B7%AF%E5%BE%84'],
  ]) assert.equal(addressUrl(input), expected, input);
});

test('ordinary queries, malformed addresses, credentials, and unsupported schemes are not navigation candidates', () => {
  for (const input of ['', 'settings', 'github pull', '天气', 'example.com search', 'http://', 'https://example.com:99999',
    'javascript:alert(1)', 'data:text/html,test', 'file:///tmp/test', 'chrome://settings', 'ftp://example.com',
    '//example.com', 'user@example.com', 'https://user:secret@example.com', 'example..com', '-example.com',
    'https://exa\nmple.com', 'https://example.com\\@evil.test', 'https://example.com/\u0000']) {
    assert.equal(addressUrl(input), undefined, input);
  }
});

test('address actions target the source with matching mouse/menu semantics and no learning', () => {
  const entry = addressEntry('example.com/A?q=B#C', data)!;
  assert.equal(entry.url, 'https://example.com/A?q=B#C');
  assert.equal(entry.subtitle, entry.url);
  assert.equal(entry.tabId, 2);
  assert.equal(entry.expectedUrl, 'chrome://version/');
  assert.equal(entry.action, 'navigateAddress');
  assert.equal(addressEntry('settings', data), undefined);
  assert.equal(addressEntry('example.com', { ...data, tabs: [] }), undefined);
  for (const isMac of [true, false]) {
    const actions = addressActions(entry, isMac);
    assert.deepEqual(actions.map(action => action.action), ['navigateAddress', 'openAddressNewTab']);
    assert.equal(actions[1].shortcut, isMac ? 'Mod+Enter' : 'Alt+Enter');
    assert.equal(addressNewTabShortcut(isMac), actions[1].shortcut);
    for (const action of actions) {
      assert.equal(action.tabId, 2);
      assert.equal(action.url, entry.url);
      assert.equal(usageTarget(action), '');
      assert.ok(action.action === 'navigateAddress' || action.action === 'openAddressNewTab');
      assert.equal(keepsPaletteOpen(action.action, 2, 2), false);
    }
  }
});

test('matching tabs bookmarks and history suppress only the same normalized complete address', () => {
  for (const kind of ['tab', 'bookmark', 'history'] as const) {
    const match: Entry = { id: kind, kind, action: 'switch', icon: 'tab', title: 'Existing', subtitle: '', keywords: '', url: 'https://EXAMPLE.com:443' };
    assert.equal(addressEntry('example.com', data, [match]), undefined, kind);
    for (const url of ['http://example.com/', 'https://example.com/docs', 'https://example.com/?q=1', 'https://example.com/#part']) {
      assert.ok(addressEntry('example.com', data, [{ ...match, url }]), url);
    }
    assert.equal(addressEntry('example.com/Docs?q=A#Part', data, [{ ...match, url: 'https://example.com/Docs?q=A#Part' }]), undefined);
    assert.ok(addressEntry('example.com/Docs?q=A#Part', data, [{ ...match, url: 'https://example.com/docs?q=A#Part' }]));
    assert.ok(addressEntry('example.com', data, [{ ...match, url: 'https://other.test/', title: 'example.com' }]));
  }
  const existingSource = { ...data, tabs: [{ ...data.tabs[0], url: 'https://example.com/' }] };
  assert.ok(addressEntry('example.com', existingSource, []), 'unmatched snapshot entries must not hide the candidate');
});

test('pinned sources disable only current-tab navigation', () => {
  const entry = addressEntry('example.com', { ...data, tabs: [{ ...data.tabs[0], pinned: true }] })!;
  assert.equal(entry.disabled, true);
  const actions = addressActions(entry, true);
  assert.equal(actions[0].disabled, true);
  assert.equal(actions[1].disabled, false);
});
