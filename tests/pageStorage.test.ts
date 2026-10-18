import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readPageStorage, openCookieAccess } from '../src/pageStorage';
import { cookiePatterns } from '../src/cookieAccess';
import type { StorageRead } from '../src/types';

const url = 'https://app.example.test/nested/page';
const request: StorageRead = { kind: 'local', tabId: 2, windowId: 10, expectedUrl: url, query: 'local storage' };
const sender = { tab: { id: 2 }, frameId: 0 } as chrome.runtime.MessageSender;
let tab: chrome.tabs.Tab;
let calls: unknown[];
let saved: Record<string, unknown>;
beforeEach(() => {
  calls = []; saved = {};
  tab = { id: 2, windowId: 10, url, incognito: false } as chrome.tabs.Tab;
  globalThis.chrome = {
    runtime: { getURL: (path: string) => `chrome-extension://justonehop/${path}` },
    permissions: { contains: async () => true },
    windows: { create: async (options: unknown) => { calls.push(options); } },
    tabs: { get: async () => structuredClone(tab) },
    scripting: { executeScript: async (options: unknown) => { calls.push(options); return [{ result: { url, entries: [{ id: 'empty', name: 'empty', value: '' }, { id: 'config', name: 'config', value: '{"a":1}' }] } }]; } },
    cookies: {
      getAllCookieStores: async () => [{ id: 'private', tabIds: [99] }, { id: 'source-store', tabIds: [2] }],
      getPartitionKey: async () => ({ partitionKey: { topLevelSite: 'https://example.test', hasCrossSiteAncestor: false } }),
      getAll: async (scope: unknown) => { calls.push(scope); return []; },
    },
    storage: { local: { get: async () => saved, set: async (value: Record<string, unknown>) => { saved = value; } } },
  } as unknown as typeof chrome;
});

test('storage reads the captured top frame and only learns the command, preserving original strings', async () => {
  const result = await readPageStorage(request, sender);
  assert.deepEqual(result.entries.map(row => [row.name, row.value]), [['config', '{"a":1}'], ['empty', '']]);
  assert.deepEqual((calls[0] as chrome.scripting.ScriptInjection<unknown[], unknown>).target, { tabId: 2, frameIds: [0] });
  assert.match(JSON.stringify(saved), /command:localStorage/);
  assert.doesNotMatch(JSON.stringify(saved), /config|empty/);
});

test('storage rejects malformed, other tab, child frame, unexpected extension page and moved targets before reading', async () => {
  for (const [payload, source] of [
    [{ ...request, kind: 'invalid' }, sender],
    [request, { tab: { id: 3 }, frameId: 0 }],
    [request, { tab: { id: 2 }, frameId: 1 }],
    [request, { url: 'https://example.test' }],
    [{ ...request, windowId: 11 }, sender],
    [{ ...request, expectedUrl: `${url}?changed` }, sender],
  ] as [StorageRead, chrome.runtime.MessageSender][]) await assert.rejects(readPageStorage(payload, source));
  assert.equal(calls.length, 0);
});

test('storage detects navigation during the read and refuses unsupported or pending pages', async () => {
  chrome.scripting.executeScript = async () => {
    tab.url = 'https://other.test';
    return [{ result: { url, entries: [] } }] as never;
  };
  await assert.rejects(readPageStorage(request, sender), /page changed/);
  assert.deepEqual(saved, {});
  tab.url = 'chrome://settings';
  await assert.rejects(readPageStorage({ ...request, expectedUrl: tab.url }, sender), /HTTP or HTTPS/);
  tab.url = url; tab.pendingUrl = 'https://other.test';
  await assert.rejects(readPageStorage(request, sender), /page changed/);
});

test('cookies select the source store and URL, retain HttpOnly and distinct partition identities', async () => {
  chrome.cookies.getAll = async scope => {
    calls.push(scope);
    return [{ name: 'token', value: 'opaque', domain: '.example.test', path: '/', storeId: 'source-store',
      httpOnly: true, secure: true, sameSite: 'lax' as const, session: true, hostOnly: false,
      ...(scope.partitionKey ? { partitionKey: scope.partitionKey } : {}) }];
  };
  const result = await readPageStorage({ ...request, kind: 'cookies' }, sender);
  assert.equal(result.entries.length, 2);
  assert.notEqual(result.entries[0].id, result.entries[1].id);
  assert.equal(result.entries[0].cookie?.httpOnly, true);
  assert.deepEqual(calls, [{ url, storeId: 'source-store' }, { url, storeId: 'source-store', partitionKey: { topLevelSite: 'https://example.test', hasCrossSiteAncestor: false } }]);
});

test('private and refresh reads do not learn; popup sender can read the captured target', async () => {
  tab.incognito = true;
  await readPageStorage(request, sender);
  assert.deepEqual(saved, {});
  tab.incognito = false;
  await readPageStorage({ ...request, query: undefined }, { url: 'chrome-extension://justonehop/popup.html' });
  assert.deepEqual(saved, {});
});

test('read failures expose a localized explanation instead of values from browser errors', async () => {
  chrome.scripting.executeScript = async () => { throw new Error('secret-value'); };
  await assert.rejects(readPageStorage(request, sender), error => error instanceof Error && !error.message.includes('secret-value') && /Unable to read/.test(error.message));
  assert.deepEqual(saved, {});
});


test('cookie permissions include required ancestor domains without sibling, public suffix or private-tenant access', async () => {
  assert.deepEqual(cookiePatterns('https://app.example.test:8443/nested?a=b'), ['*://app.example.test/*', '*://example.test/*']);
  assert.deepEqual(cookiePatterns('https://a.b.example.co.uk'), ['*://a.b.example.co.uk/*', '*://b.example.co.uk/*', '*://example.co.uk/*']);
  assert.deepEqual(cookiePatterns('https://tenant.github.io'), ['*://tenant.github.io/*']);
  assert.deepEqual(cookiePatterns('http://127.0.0.1:1234/'), ['*://127.0.0.1/*']);
  assert.throws(() => cookiePatterns('chrome://settings'));
  chrome.permissions.contains = async () => false;
  await assert.rejects(readPageStorage({ ...request, kind: 'cookies' }, sender), /Allow access/);
  assert.equal(calls.length, 0); assert.deepEqual(saved, {});
  await readPageStorage(request, sender);
  assert.equal(calls.length, 1); // Local Storage still uses its existing activeTab grant.
});

test('authorization opens only a trusted extension page for a validated target, without URL queries', async () => {
  await openCookieAccess(request, sender);
  const created = calls[0] as chrome.windows.CreateData;
  const target = new URL(created.url as string);
  assert.equal(target.pathname, '/cookie-access.html');
  assert.equal(target.searchParams.get('origin'), 'https://app.example.test');
  assert.equal(target.searchParams.get('tab'), '2');
  assert.equal(created.type, 'popup');
  tab.url = 'https://other.test';
  await assert.rejects(openCookieAccess(request, sender), /page changed/);
  assert.equal(calls.length, 1);
});
