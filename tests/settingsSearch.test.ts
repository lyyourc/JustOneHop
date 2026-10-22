import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchingSettings } from '../src/settingsSearch.ts';

test('settings search finds individual rows by bilingual labels, descriptions and aliases', () => {
  for (const [query, rows] of [
    ['  ', ['language', 'theme', 'searchIcon', 'help', 'keyboard', 'binding', 'tabs', 'ranking']],
    ['help', ['help']], ['帮助', ['help']], ['使用说明', ['help']], ['general', []],
    ['LANG', ['language']], ['语言', ['language']], ['外观', ['language', 'theme', 'searchIcon']], ['dark', ['theme']],
    ['图标', ['searchIcon']], ['emoji', ['searchIcon']], ['image', ['searchIcon']],
    ['7 days', ['tabs']], ['自定义', ['searchIcon', 'keyboard']], ['12 hours', ['tabs']], ['时长', ['tabs']], ['页面始终保持打开', ['tabs']], ['search 排序', ['ranking']],
    ['userscript', []], ['scripts', []], ['脚本', []], ['ctrl tab', ['binding']], ['hotkey', ['keyboard']],
    ['实验性功能', ['tabs', 'ranking']], ['preferences', ['language', 'theme', 'searchIcon']],
    ['keyboard', ['keyboard', 'binding']], ['theme ranking', []], ['[.*]', []],
  ] as const) assert.deepEqual([...matchingSettings(query)], rows, query);
});
