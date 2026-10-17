import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { highlightParts } from '../src/highlight.ts';
import { HighlightedText } from '../src/HighlightedText.tsx';
import { entries, matchingAlias } from '../src/model.ts';

test('literal terms highlight all occurrences without matching stray fuzzy letters', () => {
  assert.deepEqual(highlightParts('New Tab — new notes', 'new tab'), [
    { text: 'New', matched: true }, { text: ' ', matched: false },
    { text: 'Tab', matched: true }, { text: ' — ', matched: false },
    { text: 'new', matched: true }, { text: ' notes', matched: false },
  ]);
  assert.deepEqual(highlightParts('New', 'new ew'), [{ text: 'New', matched: true }]);
});

test('Chinese, literal punctuation, spaces and emoji preserve original text', () => {
  for (const [text, query, highlighted] of [
    ['新建标签页', '标签', '标签'], ['docs.example/a+b', 'a+b', 'a+b'],
    ['New   Tab', ' NEW  TAB ', 'NewTab'], ['📖 阅读', '📖', '📖'],
  ]) {
    const parts = highlightParts(text, query);
    assert.equal(parts.map(part => part.text).join(''), text);
    assert.equal(parts.filter(part => part.matched).map(part => part.text).join(''), highlighted);
  }
});

test('fuzzy fallback marks matching characters and empty or unrelated queries do not highlight', () => {
  const parts = highlightParts('Design', 'desgin');
  assert.ok(parts.some(part => part.matched));
  assert.equal(parts.map(part => part.text).join(''), 'Design');
  for (const query of ['', '   ', 'zzzzzz']) {
    assert.deepEqual(highlightParts('Design', query), [{ text: 'Design', matched: false }]);
  }
});

test('highlighted page titles render as escaped text, never HTML', () => {
  const markup = renderToStaticMarkup(createElement(HighlightedText, { text: '<img src=x onerror=alert(1)>', query: 'img' }));
  assert.ok(markup.includes('<mark class="search-match">img</mark>'));
  assert.ok(markup.startsWith('&lt;'));
  assert.ok(!markup.includes('<img'));
});

test('alias hint only explains a matching command when its display title does not', () => {
  const item = entries({ tabs: [], bookmarks: [], currentTabId: 0, windowId: 1, shortcut: '' }).find(item => item.action === 'newTab')!;
  assert.equal(matchingAlias({ ...item, title: '新建标签页' }, 'new tab'), 'new tab');
  assert.equal(matchingAlias(item, 'new tab'), '');
  assert.equal(matchingAlias(item, ''), '');
  assert.equal(matchingAlias(item, 'new tab guide'), '');
  assert.equal(matchingAlias({ ...item, kind: 'tab', title: 'Guide' }, 'new tab'), '');
});

test('translated commands explain partial, reordered and typo queries with visible aliases', () => {
  const items = entries({ tabs: [], bookmarks: [], currentTabId: 0, windowId: 1, shortcut: '' });
  const close = { ...items.find(item => item.action === 'close')!, title: '关闭当前标签页' };
  assert.equal(matchingAlias(close, 'clo'), 'close');
  assert.equal(matchingAlias(close, 'tab clo'), 'close tab');
  assert.equal(matchingAlias(close, 'Tab: clo'), 'close');
  assert.equal(matchingAlias(close, 'clo missing'), '');
  const alias = matchingAlias(close, 'tab clo');
  assert.deepEqual(highlightParts(alias, 'tab clo').filter(part => part.matched).map(part => part.text), ['clo', 'tab']);
  const reload = { ...items.find(item => item.action === 'reload')!, title: '刷新当前标签页' };
  assert.equal(matchingAlias(reload, 'reloda'), 'reload');
  assert.ok(highlightParts(matchingAlias(reload, 'reloda'), 'reloda').some(part => part.matched));
});

test('highlights follow strict short-query and metadata matching', () => {
  for (const text of ['Example Domain', 'xinjian', 'Programming', 'WebSequenceDiagrams']) {
    assert.deepEqual(highlightParts(text, 'iam'), [{ text, matched: false }]);
  }
  assert.deepEqual(highlightParts('IAM', 'iam'), [{ text: 'IAM', matched: true }]);
  assert.deepEqual(highlightParts('settings.example', 'setings', false), [{ text: 'settings.example', matched: false }]);
  assert.ok(highlightParts('Settings', 'setings').some(part => part.matched));
  assert.deepEqual(highlightParts('Programming', 'granm'), [{ text: 'Programming', matched: false }]);
});
