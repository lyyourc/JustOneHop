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
let overlayReply: unknown = true;
let injectionFailure = false;
let beforeToggle: (() => Promise<void>) | undefined;
let beforeRemove: (() => Promise<void>) | undefined;
let afterRemove: (() => Promise<void>) | undefined;
let usageWrite: (() => Promise<void>) | undefined;
const state: PaletteState = { query: 'tabs', selection: 'command:close', caret: [1, 3], group: { id: 5, query: 'work', selection: 'tab:2', caret: [2, 4] } };
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
  removeFailure = false; creationFocus = false;
  overlayReply = true; injectionFailure = false; beforeToggle = undefined;
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
  runtime: { getURL: (path: string) => `chrome-extension://justonehop/${path}` },
  action: { setPopup: async (options: chrome.action.PopupDetails) => { calls.push(['set-popup', options]); } },
  scripting: { executeScript: async () => { calls.push(['inject']); if (injectionFailure) throw new Error('Cannot access this page'); } },
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
    query: async (query: chrome.tabs.QueryInfo) => tabs.filter(tab => (query.active === undefined || tab.active === query.active) &&
      (query.currentWindow ? tab.windowId === focused : query.windowId === undefined || tab.windowId === query.windowId)).map(tab => ({ ...tab })),
    sendMessage: async (_id: number, message: { type: string }) => {
      calls.push(['message', message.type]);
      if (message.type === 'ping') return undefined;
      await beforeToggle?.();
      return overlayReply;
    },
    remove: removeTabs,
    update: async (id: number, options: chrome.tabs.UpdateProperties) => { calls.push(['update-tab', id, options]); return tabs.find(tab => tab.id === id); },
    create: async (options: chrome.tabs.CreateProperties) => { calls.push(['create-tab', options]); return { id: 99, ...options }; },
  },
} as unknown as typeof chrome;
const { togglePaletteWindow, paletteSender, getPaletteWindowState, performPaletteAction, closePaletteWindowForShortcut, cancelPaletteContinuation } = await import('../src/paletteWindow.ts');
const { launchPalette, clearToolbarPopups } = await import('../src/paletteLaunch.ts');
const nativeSender = () => ({ url: tabs.find(tab => tab.id === 30)!.url, tab: tabs.find(tab => tab.id === 30)! });
const execute = (action: Execution['action'] = 'close', tabId = 2, sender: chrome.runtime.MessageSender = sourceSender(), acknowledged = () => {}) =>
  performPaletteAction({ action, windowId: 10, tabId, query: 'close', paletteState: state }, sender, acknowledged);

beforeEach(async () => {
  await closePaletteWindowForShortcut({ windowId: 10 } as chrome.tabs.Tab);
  await tick();
  reset();
});

for (const host of ['page', 'legacy action popup', 'native'] as const) {
  for (const action of ['navigateAddress', 'openAddressNewTab'] as const) {
    test(`${host}: ${action} binds navigation to the source without focusing a window or learning`, async () => {
      if (host === 'native') {
        tabs[1].url = 'chrome://version/';
        await togglePaletteWindow(tabs[1]);
      }
      const sender = host === 'native' ? await paletteSender(nativeSender())
        : host === 'legacy action popup' ? { url: 'chrome-extension://justonehop/popup.html' } : sourceSender();
      const payload: Execution = { action, windowId: 10, tabId: 2, expectedUrl: tabs[1].url, url: 'https://destination.example/', query: 'destination.example' };
      calls = [];
      let acknowledged = 0;
      await performPaletteAction(payload, sender, () => { acknowledged++; });
      assert.deepEqual(calls, action === 'navigateAddress'
        ? [['update-tab', 2, { url: 'https://destination.example/' }]]
        : [['create-tab', { windowId: 10, url: 'https://destination.example/', active: true }]]);
      assert.equal(acknowledged, 1);
      assert.deepEqual(usage, []);
    });

    test(`${host}: ${action} refuses a payload targeting another tab even if it is active`, async () => {
      if (host === 'native') await togglePaletteWindow(tabs[1]);
      const sender = host === 'native' ? await paletteSender(nativeSender())
        : host === 'legacy action popup' ? { url: 'chrome-extension://justonehop/popup.html' } : sourceSender();
      // An independently valid target cannot replace the host's own source.
      Object.assign(tabs[2], { active: true, url: 'https://source.example' });
      calls = [];
      let acknowledged = 0;
      await assert.rejects(performPaletteAction({ action, windowId: 10, tabId: 3, expectedUrl: tabs[2].url,
        url: 'https://destination.example/', query: 'destination.example' }, sender, () => { acknowledged++; }));
      assert.deepEqual(calls, []);
      assert.equal(acknowledged, 0);
      assert.deepEqual(usage, []);
    });

    test(`${host}: ${action} rejects stale source state before acknowledging`, async () => {
      if (host === 'native') await togglePaletteWindow(tabs[1]);
      const sender = host === 'native' ? await paletteSender(nativeSender())
        : host === 'legacy action popup' ? { url: 'chrome-extension://justonehop/popup.html' } : sourceSender();
      const original = { ...tabs[1] };
      const payload: Execution = { action, windowId: 10, tabId: 2, expectedUrl: original.url, url: 'https://destination.example/', query: 'destination.example' };
      if (host === 'native') focused = 30;
      calls = [];
      let acknowledged = 0;
      for (const patch of [{ active: false }, { windowId: 20 }, { url: 'https://changed.example/' }, { pendingUrl: 'https://pending.example/' }]) {
        tabs[1] = { ...original, ...patch };
        await assert.rejects(performPaletteAction(payload, sender, () => { acknowledged++; }));
      }
      tabs = tabs.filter(tab => tab.id !== 2);
      await assert.rejects(performPaletteAction(payload, sender, () => { acknowledged++; }));
      assert.deepEqual(calls, []);
      assert.equal(acknowledged, 0);
      assert.deepEqual(usage, []);
    });
  }
}

test('toolbar navigation follows the current active tab and rejects the old payload after activation changes', async () => {
  const sender = { url: 'chrome-extension://justonehop/popup.html' };
  tabs[1].active = false;
  Object.assign(tabs[2], { active: true, url: 'https://source.example' });
  for (const action of ['navigateAddress', 'openAddressNewTab'] as const) {
    await assert.rejects(performPaletteAction({ action, windowId: 10, tabId: 2, expectedUrl: tabs[1].url,
      url: 'https://destination.example/' }, sender, () => assert.fail('stale toolbar request acknowledged')));
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(usage, []);
});

test('startup clears default and per-tab toolbar popup overrides', async () => {
  await clearToolbarPopups();
  assert.deepEqual(calls, [['set-popup', { popup: '' }], ...tabs.map(tab => ['set-popup', { tabId: tab.id, popup: '' }])]);
});

test('ordinary pages open an acknowledged overlay without creating a window', async () => {
  await launchPalette(tabs[1]);
  assert.deepEqual(calls.map(([name]) => name), ['set-popup', 'message', 'inject', 'message']);
  assert.equal(stored.justonehopPaletteWindow, undefined);
});

for (const reason of ['native', 'restricted', 'overlay unavailable', 'missing acknowledgement'] as const) {
  test(`${reason} launch uses a source-bound window and repeated launch closes it`, async () => {
    if (reason === 'native') tabs[1].url = 'chrome://version/';
    if (reason === 'restricted') injectionFailure = true;
    if (reason === 'overlay unavailable') overlayReply = false;
    if (reason === 'missing acknowledgement') overlayReply = undefined;
    await launchPalette(tabs[1]);
    assert.equal((await paletteSender(nativeSender())).tab?.id, 2);
    assert.equal(calls.filter(([name]) => name === 'create').length, 1);
    assert.ok(calls.filter(([name]) => name === 'set-popup').every(([, options]) => (options as { popup: string }).popup === ''));
    if (reason === 'native') assert.equal(calls.some(([name]) => name === 'inject'), false);
    await launchPalette(tabs.find(tab => tab.id === 30)!);
    assert.equal(stored.justonehopPaletteWindow, undefined);
  });
}

for (const change of ['deactivated', 'moved', 'navigated', 'closed', 'window focus'] as const) {
  test(`fallback does not open after source is ${change}`, async () => {
    const source = { ...tabs[1] };
    overlayReply = false;
    beforeToggle = async () => {
      if (change === 'deactivated') tabs[1].active = false;
      if (change === 'moved') tabs[1].windowId = 20;
      if (change === 'navigated') tabs[1].url = 'https://other.example';
      if (change === 'closed') tabs = tabs.filter(tab => tab.id !== source.id);
      if (change === 'window focus') focus(20);
    };
    if (change === 'closed') await assert.rejects(launchPalette(source), /No tab/);
    else await launchPalette(source);
    assert.equal(calls.some(([name]) => name === 'create'), false);
  });
}

test('concurrent launches do not create duplicate fallback windows', async () => {
  const gate = deferred();
  overlayReply = false;
  beforeToggle = () => gate.promise;
  const first = launchPalette(tabs[1]);
  await tick();
  await launchPalette(tabs[1]);
  gate.resolve(); await first;
  assert.equal(calls.filter(([name]) => name === 'create').length, 1);
});

for (const host of ['page', 'legacy action popup', 'native'] as const) {
  for (const [action, target, removedIds] of [
    ['close', 2, 2], ['closeOthers', 3, [2]], ['closeRight', 1, [2, 3]],
  ] as const) {
    test(`${host}: ${action} removing the source ends the session even with legacy paletteState`, async () => {
      if (host === 'native') await togglePaletteWindow(tabs[1]);
      const native = host === 'native' ? nativeSender() : undefined;
      const sender = native ? await paletteSender(native) : host === 'legacy action popup' ? { url: 'chrome-extension://justonehop/popup.html' } : sourceSender();
      calls = [];
      await execute(action, target, sender);
      await tick();
      assert.deepEqual(calls.filter(([name]) => name === 'remove'), [['remove', removedIds]]);
      assert.ok(tabs.some(tab => tab.id === 1), 'pinned tabs survive batch removal');
      assert.equal(calls.some(([name]) => name === 'create' || name === 'focus'), false);
      assert.equal(stored.justonehopPaletteWindow, undefined);
      assert.equal(usage[0].target, `command:${action}`);
      if (native) {
        assert.deepEqual(calls.filter(([name]) => name === 'close-window'), [['close-window', 30]]);
        await assert.rejects(paletteSender(native));
      }
    });
  }
}

for (const [action, target] of [['close', 3], ['closeOthers', 2], ['closeRight', 2]] as const) {
  test(`${action} preserves the native host when the source survives`, async () => {
    await togglePaletteWindow(tabs[1]);
    const native = nativeSender();
    const sender = await paletteSender(native);
    calls = [];
    await execute(action, target, sender);
    await tick();
    assert.equal((await paletteSender(native)).tab?.id, 2);
    assert.equal((stored.justonehopPaletteWindow as { sourceTabId: number }).sourceTabId, 2);
    assert.equal(await getPaletteWindowState(native), undefined);
    assert.equal(calls.some(([name]) => ['create', 'focus', 'close-window'].includes(name)), false);
  });
}

test('source removal without paletteState also closes the native host and cleans the session', async () => {
  await togglePaletteWindow(tabs[1]);
  const native = nativeSender();
  const sender = await paletteSender(native);
  calls = [];
  await performPaletteAction({ action: 'close', windowId: 10, tabId: 2 }, sender, () => {});
  await tick();
  assert.deepEqual(calls.filter(([name]) => name === 'close-window'), [['close-window', 30]]);
  assert.equal(stored.justonehopPaletteWindow, undefined);
  assert.equal(calls.some(([name]) => name === 'create'), false);
  await assert.rejects(paletteSender(native));
});

test('native source removal closes its host before a delayed remove response resolves', async () => {
  await togglePaletteWindow(tabs[1]);
  const native = nativeSender();
  const sender = await paletteSender(native);
  const gate = deferred();
  const started = deferred();
  afterRemove = async () => { started.resolve(); await gate.promise; };
  const execution = execute('close', 2, sender);
  await started.promise;
  try {
    await tick();
    await assert.rejects(paletteSender(native));
    assert.deepEqual(calls.filter(([name]) => name === 'close-window'), [['close-window', 30]]);
    assert.equal(stored.justonehopPaletteWindow, undefined);
  } finally { gate.resolve(); await execution; }
  assert.equal(calls.filter(([name]) => name === 'create').length, 1);
});

test('action acknowledgement does not wait for usage storage after source closure', async () => {
  const disk = deferred();
  usageWrite = () => disk.promise;
  const ack = deferred();
  let finished = false;
  const execution = execute('close', 2, sourceSender(), ack.resolve).then(() => { finished = true; });
  await ack.promise;
  try {
    assert.equal(finished, false);
    assert.equal(calls.some(([name]) => name === 'create'), false);
    assert.equal(stored.justonehopPaletteWindow, undefined);
  } finally { disk.resolve(); await execution; }
  assert.equal(usage[0].target, 'command:close');
});

test('failed removal retains the native source and does not acknowledge or record usage', async () => {
  await togglePaletteWindow(tabs[1]);
  const native = nativeSender();
  const sender = await paletteSender(native);
  removeFailure = true;
  let acknowledged = false;
  await assert.rejects(execute('close', 2, sender, () => { acknowledged = true; }), /Cannot remove/);
  assert.equal((await paletteSender(native)).tab?.id, 2);
  assert.equal(acknowledged, false);
  assert.equal(usage.length, 0);
  assert.equal(calls.some(([name]) => name === 'close-window'), false);
  removeFailure = false;
  await execute('close', 2, sender);
  await tick();
  await assert.rejects(paletteSender(native));
  assert.equal(stored.justonehopPaletteWindow, undefined);
});

test('external source closure closes native host and clears session storage', async () => {
  await togglePaletteWindow(tabs[1]);
  const native = nativeSender();
  await removeTabs(2);
  await tick();
  assert.ok(calls.some(([name, id]) => name === 'close-window' && id === 30));
  assert.equal(stored.justonehopPaletteWindow, undefined);
  await assert.rejects(paletteSender(native));
});

test('last owner tab closes its native host without creating a replacement', async () => {
  tabs = tabs.filter(tab => tab.windowId !== 10 || tab.id === 2);
  await togglePaletteWindow(tabs[0]);
  const native = nativeSender();
  await execute('close', 2, await paletteSender(native));
  await tick();
  assert.equal(calls.filter(([name]) => name === 'create').length, 1);
  assert.equal(stored.justonehopPaletteWindow, undefined);
  assert.equal(usage[0].target, 'command:close');
  await assert.rejects(paletteSender(native));
});

test('switching to another window during removal never steals focus', async () => {
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

test('close validation rejects cross-window source/target and stale group before listing affected tabs', async () => {
  const query = chrome.tabs.query;
  chrome.tabs.query = (async () => { throw new Error('Affected tabs queried before validation'); }) as typeof chrome.tabs.query;
  try {
    await assert.rejects(execute('closeOthers', 4), /another window/);
    for (const action of ['close', 'closeOthers', 'closeRight', 'closeGroup'] as const) {
      for (const paletteState of [undefined, state]) {
        await assert.rejects(performPaletteAction({ action, windowId: 20, tabId: 4, paletteState }, sourceSender(), () => {}), /another window/);
      }
    }
    await assert.rejects(performPaletteAction(null as unknown as Execution, sourceSender(), () => {}), /window/i);
    await assert.rejects(performPaletteAction({ action: 'close', windowId: NaN, tabId: 2 }, sourceSender(), () => {}), /window/i);
    await assert.rejects(performPaletteAction({ action: 'closeOthers', windowId: 10, tabId: 3, groupId: 99, paletteState: state }, sourceSender(), () => {}), /group/i);
  } finally { chrome.tabs.query = query; }
  assert.deepEqual(calls, []);
});

test('an unsuccessful removal that lost its source still cleans the native host', async () => {
  await togglePaletteWindow(tabs[1]);
  const native = nativeSender();
  const sender = await paletteSender(native);
  afterRemove = async () => { throw new Error('Removal failed after source vanished'); };
  await assert.rejects(execute('close', 2, sender), /Removal failed/);
  await tick();
  await assert.rejects(paletteSender(native));
  assert.equal(usage.length, 0);
  assert.equal(stored.justonehopPaletteWindow, undefined);
  assert.ok(calls.some(([name]) => name === 'close-window'));
});

test('switching browser windows while explicitly opening the host never focuses it', async () => {
  const create = chrome.windows.create;
  chrome.windows.create = (async (options: chrome.windows.CreateData) => {
    const popup = await create(options);
    focus(20);
    return popup;
  }) as typeof chrome.windows.create;
  try { await togglePaletteWindow(tabs[1]); }
  finally { chrome.windows.create = create; }
  assert.equal(focused, 20);
  assert.equal(calls.some(([name]) => name === 'focus'), false);
  assert.ok(calls.some(([name]) => name === 'close-window'));
  assert.equal(stored.justonehopPaletteWindow, undefined);
});

test('switching to another application during removal does not take focus back', async () => {
  beforeRemove = async () => { for (const window of windows) window.focused = false; focusChanged.emit(-1); await tick(); };
  await execute();
  assert.equal(calls.some(([name]) => name === 'create' || name === 'focus'), false);
});

test('legacy cancellation cannot enable continuation or cancel the browser action', async () => {
  const sender = { ...sourceSender(), documentId: 'source-document' };
  await cancelPaletteContinuation(sender);
  await performPaletteAction({ action: 'close', windowId: 10, tabId: 2, paletteState: state }, sender, () => {});
  assert.equal(calls.some(([name]) => name === 'create'), false);
  assert.ok(calls.some(([name]) => name === 'remove'));
  assert.equal(usage[0].target, 'command:close');
});

test('native sender and state requests reject invalid token, popup window and source context', async () => {
  await togglePaletteWindow(tabs[1]);
  const native = nativeSender();
  for (const invalid of [
    { ...native, url: 'chrome-extension://justonehop/popup.html#window=wrong' },
    { ...native, tab: { ...native.tab, windowId: 20 } },
    { url: native.url },
  ]) {
    await assert.rejects(paletteSender(invalid));
    await assert.rejects(getPaletteWindowState(invalid));
  }
  assert.equal(await getPaletteWindowState(native), undefined);
  assert.equal(await getPaletteWindowState({ url: 'chrome-extension://justonehop/popup.html' }), undefined);
  tabs.find(tab => tab.id === 2)!.windowId = 20;
  await assert.rejects(paletteSender(native));
  tabs.find(tab => tab.id === 2)!.windowId = 10;
  tabs.find(tab => tab.id === 2)!.active = false;
  await assert.rejects(paletteSender(native));
});
