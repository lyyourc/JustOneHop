import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterRecentTabs, recentNavigation, recentSelection } from '../src/recentSearch';

const tabs = [
  { id: 3, title: 'Project 文档', url: 'https://docs.example.com/guide' },
  { id: 1, title: 'Project Console', url: 'https://app.example.com/' },
  { id: 2, title: 'News', url: 'https://news.example.com/project' },
] as chrome.tabs.Tab[];

test('recent search matches title and URL terms without changing MRU order', () => {
  assert.deepEqual(filterRecentTabs(tabs, '  PROJECT example.COM  ').map(tab => tab.id), [3, 1, 2]);
  assert.deepEqual(filterRecentTabs(tabs, '文档 docs').map(tab => tab.id), [3]);
  assert.deepEqual(filterRecentTabs(tabs, 'app.example').map(tab => tab.id), [1]);
  assert.deepEqual(filterRecentTabs(tabs, 'missing'), []);
  assert.deepEqual(filterRecentTabs(tabs, ' '), tabs);
  assert.deepEqual(filterRecentTabs([{} as chrome.tabs.Tab], 'missing'), []);
});

test('recent search puts literal matches before pinyin and keeps MRU within each group', () => {
  const candidates = [
    { id: 1, title: '项目文档', url: 'https://one.example' },
    { id: 2, title: 'WD reference', url: 'https://two.example' },
    { id: 3, title: '产品文档', url: 'https://three.example' },
  ] as chrome.tabs.Tab[];
  assert.deepEqual(filterRecentTabs(candidates, 'wd').map(tab => tab.id), [2, 1, 3]);
  assert.deepEqual(filterRecentTabs(candidates, 'wendang').map(tab => tab.id), [1, 3]);
  assert.deepEqual(filterRecentTabs(candidates, 'xmwd one').map(tab => tab.id), [1]);
  assert.deepEqual(filterRecentTabs(candidates, '').map(tab => tab.id), [1, 2, 3]);
});

test('recent selection preserves visible targets and cannot confirm a hidden source after removal', () => {
  const visible = filterRecentTabs(tabs, 'Project Console');
  assert.equal(recentSelection(visible, 1), 0);
  assert.equal(recentSelection(visible, 3), 0);
  assert.equal(recentSelection(visible, 3, -1), -1);
  assert.equal(recentSelection([], 1), -1);
  assert.equal(recentSelection(tabs, 1), 1);
});

test('recent navigation cycles, pages and jumps within visible results with modifier protection', () => {
  const key = (key: string, modifiers = {}) => ({ key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...modifiers });
  assert.equal(recentNavigation(key('ArrowDown'), 2, 3, 8), 0);
  assert.equal(recentNavigation(key('p', { ctrlKey: true }), 0, 3, 8), 2);
  assert.equal(recentNavigation(key('n', { ctrlKey: true, shiftKey: true }), 0, 3, 8), undefined);
  assert.equal(recentNavigation(key('ArrowDown', { metaKey: true }), 0, 20, 8), 19);
  assert.equal(recentNavigation(key('ArrowUp', { ctrlKey: true }), 9, 20, 8), 0);
  assert.equal(recentNavigation(key('ArrowDown', { altKey: true }), 9, 20, 8), 17);
  assert.equal(recentNavigation(key('PageUp'), 9, 20, 8), 1);
  assert.equal(recentNavigation(key('Tab', { shiftKey: true }), 0, 3, 8), 2);
  assert.equal(recentNavigation(key('ArrowDown'), -1, 3, 8), 0);
  assert.equal(recentNavigation(key('ArrowDown'), 0, 0, 8), -1);
  assert.equal(recentNavigation(key('j'), 0, 3, 8), undefined);
});
