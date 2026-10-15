import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { runSavedScript, evaluateUserScript } from '../src/scriptExecution';
import type { ScriptRun } from '../src/types';

const url = 'https://example.test/page';
const request: ScriptRun = { scriptId: 'helper', tabId: 2, windowId: 1, expectedUrl: url };
const sender = { tab: { id: 2 }, frameId: 0, documentId: 'doc-1', url } as chrome.runtime.MessageSender;
let tab: { id: number; windowId: number; url: string; active: boolean; pendingUrl?: string };
let injections: chrome.userScripts.UserScriptInjection[];
let saved: Record<string, unknown>;
beforeEach(() => {
  tab = { id: 2, windowId: 1, url, active: true }; injections = []; saved = { 'saved-script:helper': { code: '21 + 21' } };
  globalThis.chrome = {
    runtime: { getURL: (path: string) => `chrome-extension://zing/${path}` },
    tabs: { get: async () => tab },
    storage: { local: { get: async () => saved } },
    scripting: { executeScript: async () => [{ documentId: 'doc-1', frameId: 0, result: url }] },
    userScripts: { configureWorld: async () => {}, execute: async (injection: chrome.userScripts.UserScriptInjection) => {
      injections.push(injection); return [{ documentId: 'doc-1', frameId: 0, result: { success: true, text: '42' } }];
    } },
  } as unknown as typeof chrome;
  Object.defineProperty(globalThis, 'location', { value: { href: url }, configurable: true });
});
test('execution resolves saved code and pins the exact top-level document in a user-script world', async () => {
  assert.deepEqual(await runSavedScript({ ...request, code: 'unexpected code' } as ScriptRun, sender), { success: true, text: '42' });
  assert.deepEqual(injections[0].target, { tabId: 2, documentIds: ['doc-1'] });
  assert.equal(injections[0].world, 'USER_SCRIPT');
  assert.match(injections[0].js[0].code!, /21 \+ 21/);
  assert.doesNotMatch(injections[0].js[0].code!, /unexpected code/);
  assert.deepEqual(Object.keys(saved), ['saved-script:helper']);
});
test('rejects built-ins, missing scripts, other frames, stale pages and inactive tabs without running', async () => {
  for (const [payload, source] of [
    [{ ...request, scriptId: 'builtin-ctrl-tab' }, sender],
    [{ ...request, scriptId: 'missing' }, sender],
    [request, { ...sender, frameId: 1 }], [request, { ...sender, tab: { id: 3 } }],
    [request, { ...sender, documentId: 'old-document' }],
    [{ ...request, windowId: 99 }, sender], [{ ...request, expectedUrl: `${url}?next` }, sender],
  ] as [ScriptRun, chrome.runtime.MessageSender][]) await assert.rejects(runSavedScript(payload, source));
  tab.active = false; await assert.rejects(runSavedScript(request, sender));
  tab.active = true; tab.pendingUrl = url; await assert.rejects(runSavedScript(request, sender));
  delete tab.pendingUrl; tab.url = 'chrome://settings'; await assert.rejects(runSavedScript({ ...request, expectedUrl: tab.url }, sender));
  assert.equal(injections.length, 0);
});
test('disabled user scripts and missing access report actionable errors before executing', async () => {
  const api = chrome.userScripts;
  Object.defineProperty(chrome, 'userScripts', { value: undefined, configurable: true });
  await assert.rejects(runSavedScript(request, sender), /Enable user scripts/);
  Object.defineProperty(chrome, 'userScripts', { value: api, configurable: true });
  chrome.scripting.executeScript = async () => { throw new Error('permission denied'); };
  await assert.rejects(runSavedScript(request, sender), /cannot access/);
  assert.equal(injections.length, 0);
});
test('a pending run blocks duplicate execution and navigation invalidates its result', async () => {
  let complete!: () => void;
  chrome.userScripts.execute = async () => { await new Promise<void>(resolve => { complete = resolve; }); return [{ documentId: 'doc-1', frameId: 0, result: { success: true, text: 'old' } }] as never; };
  const first = runSavedScript(request, sender);
  while (!complete) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(runSavedScript(request, sender), /already running/);
  tab.url = 'https://other.test'; complete();
  await assert.rejects(first, /page changed/);
});
test('result formatting preserves strings and supports objects, promises, empty and undefined values', async () => {
  for (const [code, expected] of [
    ['"中文\\n\\n"', '中文\n\n'], ['""', ''], ['undefined', 'undefined'], ['null', 'null'],
    ['Promise.resolve({a: 42})', '{\n  "a": 42\n}'], ['42n', '42'], ['NaN', 'NaN'],
    ['const x = 6; x * 7', '42'],
  ]) assert.deepEqual(await evaluateUserScript(code, url), { success: true, text: expected });
  assert.equal((await evaluateUserScript('throw new Error("bad")', url)).success, false);
  assert.equal((await evaluateUserScript('const a = {}; a.self = a; a', url)).success, false);
  assert.equal((await evaluateUserScript('"x".repeat(1000001)', url)).success, false);
  assert.equal((await evaluateUserScript('globalThis.shouldNotRun = true', 'https://other.test')).success, false);
  assert.equal('shouldNotRun' in globalThis, false);
});
