import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchingSettings } from '../src/settingsSearch.ts';

test('settings search finds individual rows by bilingual labels, descriptions and aliases', () => {
  for (const [query, rows] of [
    ['  ', ['language', 'theme', 'keyboard', 'binding', 'tabs', 'ranking', 'scripts']],
    ['LANG', ['language']], ['语言', ['language']], ['外观', ['theme']], ['dark', ['theme']],
    ['7 days', ['tabs']], ['页面始终保持打开', ['tabs']], ['search 排序', ['ranking']],
    ['userscript', ['scripts']], ['ctrl tab', ['binding']], ['hotkey', ['keyboard']],
    ['实验性功能', ['tabs', 'ranking', 'scripts']], ['preferences', ['language', 'theme']],
    ['keyboard', ['keyboard', 'binding']], ['theme ranking', []], ['[.*]', []],
  ] as const) assert.deepEqual([...matchingSettings(query)], rows, query);
});
