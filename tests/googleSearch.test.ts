import { test } from 'node:test';
import assert from 'node:assert/strict';
import { googleSearchEntry, insertGoogleSearch } from '../src/googleSearch';
import { addressActions, addressEntry } from '../src/addressPresentation';
import { historySearchEntry, insertHistorySearch } from '../src/historyPresentation';
import { usageTarget } from '../src/usage';
import type { Entry, Snapshot } from '../src/types';

const data: Snapshot = { windowId: 10, currentTabId: 2, shortcut: '', bookmarks: [], tabs: [
  { id: 2, windowId: 10, index: 0, title: 'Source', url: 'https://source.test/', active: true, pinned: false, muted: false, audible: false },
] };
const local: Entry = { id: 'local', kind: 'tab', action: 'switch', icon: 'tab', title: 'React hooks', subtitle: '', keywords: '' };
const history = historySearchEntry({ items: [], limited: false, state: 'ready' });

test('Google search preserves terms and encodes them as a single query parameter', () => {
  for (const terms of ['React hooks', '天气 中文', 'C++ & x=1 #part ? / %20', 'example.com/Docs?q=A#Part', 'google.com', 'google', 'googler React', '谷歌搜索']) {
    const google = googleSearchEntry(`  ${terms}  `, data)!;
    const url = new URL(google.entry.url!);
    assert.equal(url.origin + url.pathname, 'https://www.google.com/search');
    assert.deepEqual([...url.searchParams], [['q', terms]]);
    assert.equal(url.hash, '');
    assert.equal(google.explicit, false);
    assert.ok(google.entry.title.includes(terms));
  }
  assert.equal(googleSearchEntry('', data), undefined);
  assert.equal(googleSearchEntry(' \n ', data), undefined);
  assert.equal(googleSearchEntry('React', { ...data, tabs: [] }), undefined);
});

test('explicit bilingual Google prefixes promote only the remaining search terms', () => {
  for (const prefix of ['google', 'GOOGLE', 'search google', 'Search in Google', '谷歌搜索', '在 Google 搜索', '在Google搜索']) {
    const google = googleSearchEntry(`${prefix}  React hooks 中文 & +`, data)!;
    assert.equal(google.explicit, true, prefix);
    assert.equal(new URL(google.entry.url!).searchParams.get('q'), 'React hooks 中文 & +', prefix);
    assert.equal(insertGoogleSearch([local, history], google)[0], google.entry);
  }
});

test('Google fallback follows local results and addresses but leads an otherwise empty search', () => {
  const google = googleSearchEntry('React hooks', data)!;
  assert.deepEqual(insertGoogleSearch([local, history], google), [local, history, google.entry]);
  assert.deepEqual(insertGoogleSearch([history], google), [google.entry, history]);
  assert.deepEqual(insertGoogleSearch([], google), [google.entry]);
  const address = addressEntry('example.com', data)!;
  assert.deepEqual(insertGoogleSearch([address, history], google), [address, history, google.entry]);
  assert.deepEqual(insertGoogleSearch([local], undefined), [local]);
  const many = Array.from({ length: 120 }, (_, index) => ({ ...local, id: `local:${index}` }));
  const visible = insertGoogleSearch(insertHistorySearch(many, history), google);
  assert.equal(visible.length, 100);
  assert.equal(visible[6], history);
  assert.equal(visible[99], google.entry);
  assert.deepEqual(visible.filter(entry => entry.kind === 'tab'), many.slice(0, 98));
  const historyQuery = googleSearchEntry('history', data)!;
  assert.equal(insertGoogleSearch(insertHistorySearch([local], history, 'history'), historyQuery)[0], history);
  assert.equal(insertGoogleSearch([history], historyQuery)[0], history);
});

test('Google navigation reuses source binding, pinned protection and excludes learning', () => {
  const google = googleSearchEntry('React hooks', { ...data, tabs: [{ ...data.tabs[0], pinned: true }] })!;
  assert.equal(google.entry.action, 'navigateAddress');
  assert.equal(google.entry.tabId, 2);
  assert.equal(google.entry.expectedUrl, 'https://source.test/');
  assert.equal(google.entry.disabled, true);
  assert.equal(usageTarget(google.entry), '');
  const [current, newTab] = addressActions(google.entry, true);
  assert.equal(current.disabled, true);
  assert.equal(newTab.action, 'openAddressNewTab');
  assert.equal(newTab.url, google.entry.url);
  assert.equal(usageTarget(newTab), '');
});
