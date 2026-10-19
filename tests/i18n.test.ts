import { test } from 'node:test';
import assert from 'node:assert/strict';
import english from '../public/_locales/en/messages.json';
import chinese from '../public/_locales/zh_CN/messages.json';
import { t, countMessage, errorMessage } from '../src/i18n.ts';

test('Chinese catalog covers every English key with matching substitutions', () => {
  assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort());
  for (const key of Object.keys(english) as (keyof typeof english)[]) {
    assert.ok(chinese[key].message.trim(), key);
    assert.deepEqual(chinese[key].message.match(/\$\d/g) || [], english[key].message.match(/\$\d/g) || [], key);
  }
});
test('localized extension descriptions fit the Chrome manifest limit', () => {
  for (const catalog of [english, chinese]) {
    const description = catalog.extensionDescription.message;
    assert.ok(description.trim().length > 0);
    assert.ok(description.length <= 132, `Description has ${description.length} characters; Chrome allows 132`);
  }
});
test('fallback English handles singular, plural and missing browser APIs', () => {
  assert.equal(t('newTab'), 'New Tab');
  assert.equal(countMessage('resultOne', 'resultMany', 0), '0 results');
  assert.equal(countMessage('resultOne', 'resultMany', 1), '1 result');
  assert.equal(countMessage('closeCountOne', 'closeCountMany', 2), 'Will close 2 tabs');
  assert.equal(errorMessage(new Error('No tab with id: 1')), english.errorClosedTab.message);
});
