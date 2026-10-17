import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Execution, PaletteState } from '../src/types.ts';
import { USAGE_STORAGE_KEY, type UsageRecord } from '../src/usage.ts';

const event = <T extends unknown[]>() => {
  const listeners: ((...args: T) => void)[] = [];
  return { addListener: (listener: (...args: T) => void) => { listeners.push(listener); }, emit: (...args: T) => { for (const listener of listeners) listener(...args); } };
};
const removed = event<[number]>();
const windowRemoved = event<[number]>();
const focusChanged = event<[number]>();
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
let tabs: chrome.tabs.Tab[];
let windows: chrome.windows.Window[];
let stored: Record<string, unknown>;
let usage: UsageRecord[];
let calls: [string, ...unknown[]][];
let focused: number;
let removeFailure = false;
let creationFocus = false;
let beforeRemove: (() => Promise<void>) | undefined;
let afterRemove: (() => Promise<void>) | undefined;
let usageWrite: (() => Promise<void>) | undefined;
let createFailure = false;
const state: PaletteState = { query: 'tabs', selection: 'command:close', caret: [1, 3], group: { id: 5, query: 'work', selection: 'tab:2', caret: [2, 4] } };
const continuedState: PaletteState = { query: 'tabs', selection: null, caret: [1, 3], group: { id: 5, query: 'work', selection: null, caret: [2, 4] } };
const sourceSender = () => ({ tab: { ...tabs.find(tab => tab.id === 2)! }, url: 'https://source.example', frameId: 0 });
function reset() {
  tabs = [
    { id: 1, windowId: 10, index: 0, active: false, pinned: true },
    { id: 2, windowId: 10, index: 1, active: true, pinned: false, url: 'https://source.example' },
    { id: 3, windowId: 10, index: 2, active: false, pinned: false },
    { id: 4, windowId: 20, index: 0, active: true, pinned: false },
  ] as chrome.tabs.Tab[];
  windows = [{ id: 10, type: 'normal', focused: true }, { id: 20, type: 'normal', focused: false }] as chrome.windows.Window[];
  stored = {}; usage = []; calls = []; focused = 10;
  removeFailure = false; creationFocus = false; createFailure = false;
  beforeRemove = afterRemove = usageWrite = undefined;
}
function focus(id: number) {
  focused = id;
  for (const window of windows) window.focused = window.id === id;
  focusChanged.emit(id);
}
async function removeTabs(ids: number | number[]) {
  await beforeRemove?.();
  if (removeFailure) throw new Error('Cannot remove tab');
  for (const id of Array.isArray(ids) ? ids : [ids]) {
    const tab = tabs.find(tab => tab.id === id);
    tabs = tabs.filter(tab => tab.id !== id);
    if (tab?.active) {
      const next = tabs.find(next => next.windowId === tab.windowId);
      if (next) next.active = true;
      else {
        windows = windows.filter(window => window.id !== tab.windowId);
        windowRemoved.emit(tab.windowId);
      }
    }
    removed.emit(id);
  }
  calls.push(['remove', ids]);
  await afterRemove?.();
}
reset();
globalThis.chrome = {
  runtime: { getURL: (path: string) => `chrome-extension://zing/${path}` },
  storage: {
    onChanged: event<[Record<string, chrome.storage.StorageChange>, string]>(),
    session: {
      get: async () => structuredClone(stored),
      set: async (data: Record<string, unknown>) => { Object.assign(stored, structuredClone(data)); },
      remove: async (key: string) => { delete stored[key]; },
    },
    local: {
      get: async () => ({ [USAGE_STORAGE_KEY]: structuredClone(usage) }),
      set: async (data: Record<string, UsageRecord[]>) => { await usageWrite?.(); usage = structuredClone(data[USAGE_STORAGE_KEY]); },
    },
  },
  windows: {
    WINDOW_ID_NONE: -1,
    onFocusChanged: focusChanged, onRemoved: windowRemoved,
    get: async (id: number) => { const window = windows.find(window => window.id === id); if (!window) throw new Error('No window'); return { ...window }; },
    getLastFocused: async () => ({ ...windows.find(window => window.id === focused)! }),
    create: async (options: chrome.windows.CreateData) => {
      if (createFailure) throw new Error('Cannot create palette');
      calls.push(['create', options]);
      const popup = { id: 30, type: 'popup', focused: false } as chrome.windows.Window;
      windows.push(popup);
      tabs.push({ id: 30, windowId: 30, active: true, url: options.url } as chrome.tabs.Tab);
      if (creationFocus) focus(30);
      return popup;
    },
    update: async (id: number, options: chrome.windows.UpdateInfo) => { calls.push(['focus', id]); if (options.focused) focus(id); return windows.find(window => window.id === id); },
    remove: async (id: number) => { calls.push(['close-window', id]); windows = windows.filter(window => window.id !== id); tabs = tabs.filter(tab => tab.windowId !== id); windowRemoved.emit(id); },
  },
  tabs: {
    onRemoved: removed,
    get: async (id: number) => { const tab = tabs.find(tab => tab.id === id); if (!tab) throw new Error('No tab'); return { ...tab }; },
    getZoom: async () => 1,
    query: async (query: chrome.tabs.QueryInfo) => tabs.filter(tab => (query.active === undefined || tab.active === query.active) && tab.windowId === (query.currentWindow ? focused : query.windowId)).map(tab => ({ ...tab })),
    remove: removeTabs,
  },
} as unknown as typeof chrome;
const { togglePaletteWindow, paletteSender, getPaletteWindowState, performWithPaletteContinuation, closePaletteWindowForShortcut, registerPaletteContinuation, releasePaletteContinuation, cancelPaletteContinuation } = await import('../src/paletteWindow.ts');
const nativeSender = () => ({ url: tabs.find(tab => tab.id === 30)!.url, tab: tabs.find(tab => tab.id === 30)! });
const execute = (action: Execution['action'] = 'close', tabId = 2, sender: chrome.runtime.MessageSender = sourceSender(), acknowledged = () => {}) =>
  performWithPaletteContinuation({ action, windowId: 10, tabId, query: 'close', paletteState: state }, sender, acknowledged);

beforeEach(async () => {
  await closePaletteWindowForShortcut({ windowId: 10 } as chrome.tabs.Tab);
  await tick();
  reset();
});

test('self close continues in the owner window with root/group state and records usage', async () => {
  await execute();
  assert.deepEqual(calls.filter(([name]) => name === 'remove'), [['remove', 2]]);
  assert.equal((await paletteSender(nativeSender())).tab?.id, 1);
  assert.deepEqual(await getPaletteWindowState(nativeSender()), continuedState);
  assert.equal(usage[0].target, 'command:close');
  assert.equal((stored.zingPaletteWindow as { sourceWindowId: number }).sourceWindowId, 10);
});

test('bootstrap state clears unsafe selections and is consumed once, including session storage', async () => {
  await execute();
  assert.deepEqual((stored.zingPaletteWindow as { state: PaletteState }).state, continuedState);
  const states = await Promise.all([getPaletteWindowState(nativeSender()), getPaletteWindowState(nativeSender())]);
  assert.deepEqual(states, [continuedState, undefined]);
  assert.equal((stored.zingPaletteWindow as { state?: PaletteState }).state, undefined);
  assert.equal(await getPaletteWindowState(nativeSender()), undefined);
  assert.equal(state.selection, 'command:close');
  assert.equal(state.group?.selection, 'tab:2');
});

test('action popup resolves its actual source before continuing', async () => {
  await execute('close', 2, { url: 'chrome-extension://zing/popup.html' });
  assert.equal((await paletteSender(nativeSender())).tab?.windowId, 10);
  assert.deepEqual(await getPaletteWindowState({ url: 'chrome-extension://zing/popup.html' }), undefined);
});

test('batch close keeps pinned tabs and hands off when the source is among removed tabs', async () => {
  await execute('closeOthers', 3);
  assert.deepEqual(calls.filter(([name]) => name === 'remove'), [['remove', [2]]]);
  assert.ok(tabs.some(tab => tab.id === 1));
  assert.deepEqual(await getPaletteWindowState(nativeSender()), continuedState);
});

test('close right can remove the source; closing another tab never opens a host', async () => {
  await execute('close', 3);
  assert.equal(calls.some(([name]) => name === 'create'), false);
  tabs[0].pinned = false;
  await execute('closeRight', 1);
  assert.equal(calls.filter(([name]) => name === 'create').length, 1);
});

test('no state means no continuation, even for self close', async () => {
  await performWithPaletteContinuation({ action: 'close', windowId: 10, tabId: 2 }, sourceSender(), () => {});
  assert.equal(calls.some(([name]) => name === 'create'), false);
});

test('native host remains alive and serializes source resolution during removal', async () => {
  await togglePaletteWindow(tabs[1]);
  const native = nativeSender();
  const sender = await paletteSender(native);
  const removedGate = deferred();
  const removalStarted = deferred();
  afterRemove = async () => { removalStarted.resolve(); await removedGate.promise; };
  const execution = execute('close', 2, sender);
  await removalStarted.promise;
  let resolved = false;
  const context = paletteSender(native).then(value => { resolved = true; return value; });
  await tick();
  assert.equal(resolved, false);
  assert.equal(calls.some(([name]) => name === 'close-window'), false);
  removedGate.resolve();
  await execution;
  assert.equal((await context).tab?.id, 1);
  assert.equal(await getPaletteWindowState(native), undefined);
  assert.equal((stored.zingPaletteWindow as { state?: PaletteState }).state, undefined);
  assert.equal(calls.filter(([name]) => name === 'create').length, 1);
  assert.equal(calls.some(([name]) => name === 'close-window'), false);
});

test('acknowledgement and continuation do not wait for usage storage', async () => {
  const disk = deferred();
  usageWrite = () => disk.promise;
  const ack = deferred();
  let finished = false;
  const execution = execute('close', 2, sourceSender(), ack.resolve).then(() => { finished = true; });
  await ack.promise;
  assert.equal(finished, false);
  assert.deepEqual(await getPaletteWindowState(nativeSender()), continuedState);
  disk.resolve();
  await execution;
  assert.equal(usage[0].target, 'command:close');
});

test('failure releases the native source latch and allows another operation', async () => {
  await togglePaletteWindow(tabs[1]);
  const native = nativeSender();
  const sender = await paletteSender(native);
  removeFailure = true;
  await assert.rejects(execute('close', 2, sender), /Cannot remove/);
  assert.equal((await paletteSender(native)).tab?.id, 2);
  assert.equal(usage.length, 0);
  removeFailure = false;
  await execute('close', 2, sender);
  assert.equal((await paletteSender(native)).tab?.id, 1);
});

test('external source closure closes native host', async () => {
  await togglePaletteWindow(tabs[1]);
  const native = nativeSender();
  await removeTabs(2);
  await tick();
  assert.ok(calls.some(([name, id]) => name === 'close-window' && id === 30));
  await assert.rejects(paletteSender(native));
});

test('failed native creation preserves action acknowledgement and usage', async () => {
  createFailure = true;
  let acknowledged = false;
  await execute('close', 2, sourceSender(), () => { acknowledged = true; });
  assert.equal(acknowledged, true);
  assert.equal(usage[0].target, 'command:close');
  assert.equal(stored.zingPaletteWindow, undefined);
});

test('last owner tab does not create a continuation window', async () => {
  tabs = tabs.filter(tab => tab.windowId !== 10 || tab.id === 2);
  await execute();
  assert.equal(calls.some(([name]) => name === 'create'), false);
  assert.equal(usage[0].target, 'command:close');
});

test('switching to another window during removal cancels continuation without stealing focus', async () => {
  beforeRemove = async () => { focus(20); await tick(); };
  await execute();
  assert.equal(focused, 20);
  assert.equal(calls.some(([name]) => name === 'create' || name === 'focus'), false);
  assert.equal(usage[0].target, 'command:close');
});

test('Chrome focusing its new native popup before explicit handoff is accepted', async () => {
  creationFocus = true;
  await togglePaletteWindow(tabs[1]);
  assert.equal((await paletteSender(nativeSender())).tab?.id, 2);
  assert.equal(calls.some(([name]) => name === 'close-window'), false);
});

test('preflight rejects cross-window source/target and stale group before listing affected tabs', async () => {
  const query = chrome.tabs.query;
  chrome.tabs.query = (async () => { throw new Error('Affected tabs queried before validation'); }) as typeof chrome.tabs.query;
  try {
    await assert.rejects(execute('closeOthers', 4), /another window/);
    await assert.rejects(performWithPaletteContinuation({ action: 'closeOthers', windowId: 20, tabId: 4, paletteState: state }, sourceSender(), () => {}), /another window/);
    await assert.rejects(performWithPaletteContinuation({ action: 'closeOthers', windowId: 10, tabId: 3, groupId: 99, paletteState: state }, sourceSender(), () => {}), /group/i);
  } finally { chrome.tabs.query = query; }
  assert.deepEqual(calls, []);
});

test('an unsuccessful removal that lost its source closes the native host and releases waiters', async () => {
  await togglePaletteWindow(tabs[1]);
  const native = nativeSender();
  const sender = await paletteSender(native);
  afterRemove = async () => { throw new Error('Removal failed after source vanished'); };
  await assert.rejects(execute('close', 2, sender), /Removal failed/);
  await assert.rejects(paletteSender(native));
  assert.equal(usage.length, 0);
  assert.ok(calls.some(([name]) => name === 'close-window'));
});

test('switching browser windows while creating the host never focuses the new palette', async () => {
  const create = chrome.windows.create;
  chrome.windows.create = (async (options: chrome.windows.CreateData) => {
    const popup = await create(options);
    focus(20);
    return popup;
  }) as typeof chrome.windows.create;
  try { await execute(); }
  finally { chrome.windows.create = create; }
  assert.equal(focused, 20);
  assert.equal(calls.some(([name]) => name === 'focus'), false);
  assert.ok(calls.some(([name]) => name === 'close-window'));
});

test('switching to another application does not take focus back from it', async () => {
  beforeRemove = async () => { for (const window of windows) window.focused = false; focusChanged.emit(-1); await tick(); };
  await execute();
  assert.equal(calls.some(([name]) => name === 'create' || name === 'focus'), false);
});

test('explicit dismissal before preflight suppresses continuation but preserves mutation and usage', async () => {
  const sender = { ...sourceSender(), documentId: 'source-document' };
  const ticket = registerPaletteContinuation(sender);
  try {
    await cancelPaletteContinuation(sender);
    await performWithPaletteContinuation({ action: 'close', windowId: 10, tabId: 2, paletteState: state }, sender, () => {}, ticket);
  } finally { releasePaletteContinuation(ticket); }
  assert.equal(calls.some(([name]) => name === 'create'), false);
  assert.ok(calls.some(([name]) => name === 'remove'));
  assert.equal(usage[0].target, 'command:close');
});

test('dismissal during delayed removal suppresses reopening and does not cancel later calls', async () => {
  const sender = { ...sourceSender(), documentId: 'source-document' };
  const ticket = registerPaletteContinuation(sender);
  const gate = deferred();
  const started = deferred();
  beforeRemove = async () => { started.resolve(); await gate.promise; };
  const execution = performWithPaletteContinuation({ action: 'close', windowId: 10, tabId: 2, paletteState: state }, sender, () => {}, ticket);
  await started.promise;
  await cancelPaletteContinuation(sender);
  gate.resolve();
  await execution.finally(() => releasePaletteContinuation(ticket));
  assert.equal(calls.some(([name]) => name === 'create'), false);
  assert.equal(usage[0].target, 'command:close');
  const next = tabs.find(tab => tab.windowId === 10 && tab.active)!;
  await performWithPaletteContinuation({ action: 'close', windowId: 10, tabId: next.id, paletteState: state }, { ...sender, tab: next }, () => {});
  assert.equal(calls.filter(([name]) => name === 'create').length, 1);
});

test('a different sender document cannot cancel an in-flight continuation', async () => {
  const sender = { ...sourceSender(), documentId: 'source-document' };
  const ticket = registerPaletteContinuation(sender);
  try {
    await cancelPaletteContinuation({ ...sender, documentId: 'other-document' });
    await performWithPaletteContinuation({ action: 'close', windowId: 10, tabId: 2, paletteState: state }, sender, () => {}, ticket);
  } finally { releasePaletteContinuation(ticket); }
  assert.equal(calls.filter(([name]) => name === 'create').length, 1);
});

test('dismissal while popup creation is pending removes that host before focusing it', async () => {
  const sender = sourceSender();
  const ticket = registerPaletteContinuation(sender);
  const create = chrome.windows.create;
  chrome.windows.create = (async (options: chrome.windows.CreateData) => {
    await cancelPaletteContinuation(sender);
    return create(options);
  }) as typeof chrome.windows.create;
  try {
    await performWithPaletteContinuation({ action: 'close', windowId: 10, tabId: 2, paletteState: state }, sender, () => {}, ticket);
  } finally { chrome.windows.create = create; releasePaletteContinuation(ticket); }
  assert.equal(calls.some(([name]) => name === 'focus'), false);
  assert.ok(calls.some(([name]) => name === 'close-window'));
  assert.equal(stored.zingPaletteWindow, undefined);
  assert.equal(usage[0].target, 'command:close');
});

test('native cancellation uses its raw token while source resolution is waiting for removal', async () => {
  await togglePaletteWindow(tabs[1]);
  const native = nativeSender();
  const sender = await paletteSender(native);
  const ticket = registerPaletteContinuation(native);
  const gate = deferred();
  const started = deferred();
  afterRemove = async () => { started.resolve(); await gate.promise; };
  const execution = performWithPaletteContinuation({ action: 'close', windowId: 10, tabId: 2, paletteState: state }, sender, () => {}, ticket);
  await started.promise;
  await cancelPaletteContinuation({ ...native, url: 'chrome-extension://zing/popup.html#window=wrong' });
  assert.equal(calls.some(([name]) => name === 'close-window'), false);
  await cancelPaletteContinuation(native);
  assert.ok(calls.some(([name]) => name === 'close-window'));
  gate.resolve();
  await execution.finally(() => releasePaletteContinuation(ticket));
  await assert.rejects(paletteSender(native));
  assert.equal(calls.filter(([name]) => name === 'create').length, 1);
  assert.equal(usage[0].target, 'command:close');
});

test('native state rejects another token and popup window', async () => {
  await execute();
  const native = nativeSender();
  await assert.rejects(getPaletteWindowState({ ...native, url: 'chrome-extension://zing/popup.html#window=wrong' }));
  await assert.rejects(getPaletteWindowState({ ...native, tab: { ...native.tab, windowId: 20 } }));
});
