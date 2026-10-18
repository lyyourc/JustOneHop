import { test } from 'node:test';
import assert from 'node:assert/strict';

const listeners: ((message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => unknown)[] = [];
const noopEvent = { addListener() {} };
const url = 'chrome-extension://test/theme.html';
let exists = false, creates = 0, reads = 0, fail = false;
const paths: unknown[] = [];
globalThis.chrome = {
  runtime: { id: 'test', getURL: () => url, ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
    getContexts: async () => exists ? [{}] : [], sendMessage: async () => { reads++; },
    onMessage: { addListener: (listener: typeof listeners[number]) => listeners.push(listener) }, onInstalled: noopEvent, onStartup: noopEvent },
  windows: { onFocusChanged: noopEvent },
  alarms: { onAlarm: noopEvent, create: async () => {} },
  offscreen: { Reason: { MATCH_MEDIA: 'MATCH_MEDIA' }, createDocument: async () => { creates++; if (fail) throw new Error('create failed'); exists = true; } },
  action: { setIcon: async ({ path }: { path: unknown }) => { paths.push(path); } },
} as unknown as typeof chrome;
const { ensureToolbarTheme, startToolbarIcon } = await import('../src/toolbarIcon');

test('offscreen creation coalesces startup calls, resynchronizes an existing document and recovers after failure', async () => {
  await Promise.all([ensureToolbarTheme(), ensureToolbarTheme(), ensureToolbarTheme()]);
  assert.equal(creates, 1);
  await ensureToolbarTheme(); assert.equal(reads, 1);
  exists = false; fail = true;
  await assert.rejects(ensureToolbarTheme(), /create failed/);
  fail = false; await ensureToolbarTheme(); assert.equal(exists, true);
});

test('only the offscreen document can update the icon, with ordered light and dark assets', async () => {
  startToolbarIcon();
  const receive = listeners[0];
  const sender = { id: 'test', url };
  const message = { source: 'justonehop', type: 'toolbar-theme', dark: true };
  for (const invalid of [{ ...sender, id: 'other' }, { ...sender, url: url + '?spoof' }, { ...sender, tab: { id: 1 } }]) {
    assert.equal(receive(message, invalid as chrome.runtime.MessageSender, () => assert.fail()), undefined);
  }
  assert.equal(receive({ ...message, dark: 'true' }, sender, () => assert.fail()), undefined);
  const send = (dark: boolean) => new Promise(resolve => { assert.equal(receive({ ...message, dark }, sender, resolve), true); });
  await Promise.all([send(true), send(false)]);
  assert.deepEqual(paths, [
    { 16: 'icon16-dark.png', 32: 'icon32-dark.png', 48: 'toolbar48-dark.png', 128: 'toolbar128-dark.png' },
    { 16: 'icon16.png', 32: 'icon32.png', 48: 'toolbar48.png', 128: 'toolbar128.png' },
  ]);
});
