import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchingHelp } from '../src/helpSearch';

test('help searches bilingual titles and body, retaining whole matching sections', () => {
  assert.equal(matchingHelp('  ').length, 5);
  assert.deepEqual(matchingHelp('⌘⇧P', '⌘⇧P (Command + Shift + P)').map(section => section.title), ['helpStartTitle']);
  assert.deepEqual(matchingHelp('Alt+Z', 'Alt+Z').map(section => section.title), ['helpStartTitle']);
  assert.deepEqual(matchingHelp('未绑定', '未绑定').map(section => section.title), ['helpStartTitle']);
  assert.deepEqual(matchingHelp('$1'), []);
  for (const query of ['Go to URL', 'localhost', 'Command+Enter', '访问网址']) {
    assert.ok(matchingHelp(query).some(section => section.title === 'helpStartTitle' && section.paragraphs.includes('helpAddressBody')), query);
  }
  for (const query of ['COOKIE', '查看网站存储', 'cookies 权限', '不修改数据', 'Cookie 撤销']) {
    assert.deepEqual(matchingHelp(query).map(section => section.title), ['helpStorageTitle'], query);
  }
  assert.deepEqual(matchingHelp('网站存储').map(section => section.title), ['helpStorageTitle', 'helpQuestionsTitle']);
  assert.deepEqual(matchingHelp('135').map(section => section.title), []);
  assert.deepEqual(matchingHelp('保存 运行').map(section => section.title), []);
  assert.deepEqual(matchingHelp('cookie    domains').map(section => section.title), ['helpStorageTitle']);
  assert.ok(matchingHelp('cookie')[0].paragraphs.includes('helpStorageBody'));
  assert.deepEqual(matchingHelp('cookie 不存在的说明'), []);
  assert.deepEqual(matchingHelp('zzzz-no-help'), []);
});
