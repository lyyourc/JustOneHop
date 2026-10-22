import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinyinMatches } from '../src/pinyinMatch.ts';
import { termMatches } from '../src/searchMatch.ts';
import { highlightParts } from '../src/highlight.ts';
import { entries, search } from '../src/model.ts';
import { usageTarget } from '../src/usage.ts';
import { matchingSettings } from '../src/settingsSearch.ts';
import { matchingHelp } from '../src/helpSearch.ts';
import type { Entry, Snapshot } from '../src/types.ts';

const snapshot: Snapshot = {
  windowId: 1, currentTabId: 0, shortcut: '',
  tabs: [{ id: 1, windowId: 1, index: 0, title: '产品路线图 Q4 — Notion', url: 'https://example.com/roadmap',
    active: false, pinned: true, muted: false, audible: false, groupId: 2 }],
  groups: [{ id: 2, windowId: 1, title: '项目研究', color: 'blue', collapsed: false }],
  bookmarks: [{ id: 'docs', title: 'React 文档', url: 'https://react.dev', folder: '开发 / 前端' }],
};

test('Chinese content supports full pinyin, syllable prefixes and consecutive initials', () => {
  for (const query of ['chanpin', 'CHANPIN', 'chanpinluxiantu', 'cplxt', 'luxian', 'lx', 'chanp']) {
    assert.ok(termMatches('产品路线图', query).length, query);
  }
  for (const query of ['hanpin', 'anpin', 'cplt', 'c', 'chanpni', 'chanpin.missing']) {
    assert.deepEqual(pinyinMatches('产品路线图', query), [], query);
  }
  assert.ok(pinyinMatches('重庆银行', 'chongqingyinhang').length);
  assert.ok(pinyinMatches('音乐', 'yinyue').length);
  assert.ok(pinyinMatches('吕布', 'lvbu').length);
  assert.deepEqual(pinyinMatches('产品 / 路线', 'pinlu'), []);
  assert.deepEqual(pinyinMatches('English only', 'eo'), []);
});

test('pinyin highlighting maps to original Chinese UTF-16 ranges and prefers literal text', () => {
  for (const query of ['luxian', 'lx', 'LUX']) {
    assert.deepEqual(highlightParts('📖 产品路线图', query, false), [
      { text: '📖 产品', matched: false }, { text: '路线', matched: true }, { text: '图', matched: false },
    ]);
  }
  assert.deepEqual(termMatches('路线和路线', 'luxian', false), [[0, 1], [3, 4]]);
  assert.deepEqual(highlightParts('cp 产品', 'cp'), [{ text: 'cp', matched: true }, { text: ' 产品', matched: false }]);
});

test('unified search recalls pinyin in tabs, bookmarks, groups and metadata with AND terms', () => {
  const items = entries(snapshot);
  for (const query of ['chanpinluxiantu', 'cplxt', 'notion chanpin', 'Q4 lx', '产品 lx', 'yanjiu notion']) {
    assert.ok(search(items, query).some(item => item.id === 'tab:1'), query);
  }
  for (const query of ['react wd', 'wendang', 'qianduan react', 'react kaifa']) {
    assert.ok(search(items, query).some(item => item.id === 'bookmark:docs'), query);
  }
  assert.ok(search(items, 'xmyj').some(item => item.id === 'group:2'));
  assert.equal(search(items, 'chanpin missing').length, 0);
  assert.equal(search(items, 'cplt').length, 0);
});

test('literal matches stay above pinyin even with pinning and extreme learned weights', () => {
  const chinese = entries(snapshot).find(item => item.id === 'tab:1')!;
  const literal: Entry = { ...chinese, id: 'literal', kind: 'bookmark', pinned: false, title: 'cplxt', url: 'https://literal.example', bookmarkId: 'literal' };
  const metadata: Entry = { ...literal, id: 'metadata', title: 'Other', keywords: 'cplxt', bookmarkId: 'metadata' };
  const learned = new Map([[usageTarget(chinese), 1e12]]);
  assert.deepEqual(search([chinese, metadata, literal], 'cplxt', learned).map(item => item.id), ['literal', 'metadata', chinese.id]);
  const other: Entry = { ...chinese, id: 'other', url: 'https://other.example' };
  assert.equal(search([chinese, other], 'cplxt', new Map([[usageTarget(other), 1]]))[0].id, 'other');
});

test('settings and help share Chinese phonetic filtering', () => {
  assert.ok(matchingSettings('zhuti').has('theme'));
  assert.ok(matchingSettings('kjj').has('keyboard'));
  assert.ok(matchingHelp('kuaijiejian').length > 0);
  assert.equal(matchingHelp('kuaijiejian missing').length, 0);
});

test('Chinese command aliases support pinyin in either UI language and preserve danger gates', () => {
  const previous = globalThis.chrome;
  try {
    for (const locale of ['en-US', 'zh-CN']) {
      globalThis.chrome = { i18n: { getUILanguage: () => locale } } as typeof chrome;
      const items = entries(snapshot);
      for (const [query, action] of [['bangzhu', 'help'], ['bz', 'help'], ['bendi cunchu', 'localStorage'], ['bdcc', 'localStorage']]) {
        assert.ok(search(items, query).some(item => item.action === action), `${locale}: ${query}`);
      }
      for (const query of ['gb', 'gbqt', 'bqy', 'shanchu', 'missing']) {
        assert.ok(!search(items, query).some(item => item.danger), query);
      }
      assert.equal(search(items, 'guanbi')[0]?.action, 'close');
    }
  } finally { globalThis.chrome = previous; }
});
