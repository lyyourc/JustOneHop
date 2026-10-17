import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reloadExtension } from '../src/reloadExtension.ts';

test('reload closes only zing panels, waits for overlay cleanup, and preserves ordinary tabs', async () => {
  const calls: string[] = [];
  let release!: () => void;
  globalThis.chrome = {
    runtime: { getURL: (path: string) => `chrome-extension://zing/${path}`, reload: () => calls.push('reload') },
    tabs: {
      query: async () => [
        { id: 1, url: 'https://example.com/' }, { id: 2, url: 'chrome-extension://zing/popup.html?token=a' },
        { id: 3, url: 'chrome-extension://zing/switcher.html' }, { id: 4, url: 'chrome://settings/' },
        { id: 5, url: 'chrome-extension://another/popup.html' },
      ],
      remove: async (id: number) => { calls.push(`remove:${id}`); },
      sendMessage: async (id: number, message: unknown, options: unknown) => {
        assert.deepEqual(message, { source: 'zing', type: 'close-for-reload' });
        assert.deepEqual(options, { frameId: 0 });
        calls.push(`close:${id}`);
        if (id === 1) await new Promise<void>(resolve => { release = resolve; });
        else throw new Error('No receiver');
      },
    },
  } as unknown as typeof chrome;
  const reloading = reloadExtension(() => calls.push('ack'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['ack', 'close:1', 'remove:2', 'remove:3', 'close:4', 'close:5']);
  release(); await reloading;
  assert.equal(calls.at(-1), 'reload');
  assert.equal(calls.filter(call => call === 'reload').length, 1);
});

test('reload preflight errors do not acknowledge or reload', async () => {
  globalThis.chrome = {
    runtime: { reload: () => assert.fail('must not reload') },
    tabs: { query: async () => { throw new Error('query failed'); } },
  } as unknown as typeof chrome;
  await assert.rejects(reloadExtension(() => assert.fail('must not acknowledge')), /query failed/);
});
