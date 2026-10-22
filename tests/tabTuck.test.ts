import test from 'node:test';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock } from 'node:test';

const event = <T extends unknown[]>() => {
  const listeners: ((...args: T) => void)[] = [];
  return { addListener: (listener: (...args: T) => void) => { listeners.push(listener); },
    emit: (...args: T) => { for (const listener of listeners) listener(...args); },
    clear: () => { listeners.length = 0; } };
};
const alarmEvent = event<[chrome.alarms.Alarm]>();
const idleEvent = event<[chrome.idle.IdleState]>();
const groupUpdatedEvent = event<[chrome.tabGroups.TabGroup]>();
const tabUpdatedEvent = event<[number, chrome.tabs.OnUpdatedInfo, chrome.tabs.Tab]>();
const focusEvent = event<[number]>();
const activatedEvent = event<[chrome.tabs.OnActivatedInfo]>();
const movedEvent = event<[number, chrome.tabs.OnMovedInfo]>();
let focused = true;
let elapsed = 0;
const ignoredEvent = { addListener: () => {} };
const clockKey = 'justonehopTabTuckClocks';
const sessionKey = 'justonehopTabTuckSession';
const recoveryKey = 'justonehopTabTuckRecovery';
const alarmName = 'justonehop-auto-tuck';
const hour = 60 * 60 * 1000;
let local: Record<string, any> = {};
let session: Record<string, any> = {};
let tabs: chrome.tabs.Tab[] = [];
let groups: chrome.tabGroups.TabGroup[] = [];
let alarm: chrome.alarms.Alarm | undefined;
let alarmWrites: chrome.alarms.AlarmCreateInfo[] = [];
let moved: number[] = [];
let idle: 'idle' | 'active' | 'locked' = 'idle';
let idleQueries = 0;
let queryIdle = () => idle;
let tabsQuery: (() => Promise<void>) | undefined;
const storageArea = (data: () => Record<string, any>) => ({
  get: async () => structuredClone(data()),
  set: async (patch: Record<string, unknown>) => { Object.assign(data(), structuredClone(patch)); },
});
globalThis.chrome = {
  storage: { local: storageArea(() => local), session: storageArea(() => session), onChanged: ignoredEvent },
  i18n: { getUILanguage: () => 'en' },
  idle: { queryState: async () => { idleQueries++; return queryIdle(); }, onStateChanged: idleEvent },
  windows: { getAll: async () => [{ id: 10, focused }], WINDOW_ID_NONE: -1, onFocusChanged: focusEvent },
  alarms: { get: async () => alarm, create: async (name: string, info: chrome.alarms.AlarmCreateInfo) => {
    alarmWrites.push(info); alarm = { name, scheduledTime: now + 60_000, periodInMinutes: info.periodInMinutes, persistAcrossSessions: true };
  }, clear: async () => { alarm = undefined; return true; }, onAlarm: alarmEvent },
  tabs: {
    query: async (query: chrome.tabs.QueryInfo) => {
      await tabsQuery?.();
      return structuredClone(tabs.filter(tab => (query.windowId === undefined || tab.windowId === query.windowId) &&
        (query.groupId === undefined || tab.groupId === query.groupId)));
    },
    get: async (id: number) => structuredClone(tabs.find(tab => tab.id === id)),
    group: async ({ tabIds, groupId }: { tabIds: number[]; groupId?: number }) => {
      const target = tabs.find(tab => tab.id === tabIds[0])!;
      const id = groupId ?? 100 + groups.length;
      if (groupId === undefined) groups.push({ id, windowId: target.windowId, title: '', color: 'grey', shared: false, collapsed: false });
      for (const tab of tabs) if (tabIds.includes(tab.id!)) { tab.groupId = id; moved.push(tab.id!); }
      return id;
    },
    move: async (id: number, { index }: chrome.tabs.MoveProperties) => {
      const target = tabs.find(tab => tab.id === id)!;
      const fromIndex = target.index;
      const strip = tabs.filter(tab => tab.windowId === target.windowId && tab.id !== id).sort((a, b) => a.index - b.index);
      strip.splice(index < 0 ? strip.length : index, 0, target);
      strip.forEach((tab, index) => { tab.index = index; });
      movedEvent.emit(id, { windowId: target.windowId, fromIndex, toIndex: target.index });
      return structuredClone(target);
    },
    ungroup: async (id: number) => { tabs.find(tab => tab.id === id)!.groupId = -1; },
    onActivated: activatedEvent, onCreated: ignoredEvent, onRemoved: ignoredEvent, onAttached: ignoredEvent,
    onDetached: ignoredEvent, onUpdated: tabUpdatedEvent, onMoved: movedEvent,
  },
  tabGroups: {
    query: async () => structuredClone(groups),
    get: async (id: number) => structuredClone(groups.find(group => group.id === id)),
    update: async (id: number, changes: chrome.tabGroups.UpdateProperties) => { Object.assign(groups.find(group => group.id === id)!, changes); },
    move: async () => {}, onCreated: ignoredEvent, onRemoved: ignoredEvent, onUpdated: groupUpdatedEvent,
  },
} as unknown as typeof chrome;
const { idleTabEligible, TUCK_AFTER } = await import('../src/tabTuck');
const { getPreferences, preferencesReady } = await import('../src/preferences');
await preferencesReady;
let importId = 0;
async function start() {
  // Restarting a worker replaces its listeners; the previous module no longer runs.
  for (const source of [alarmEvent, idleEvent, groupUpdatedEvent, tabUpdatedEvent, focusEvent, activatedEvent, movedEvent]) source.clear();
  for (const windowId of new Set(tabs.map(tab => tab.windowId))) {
    tabs.filter(tab => tab.windowId === windowId).sort((a, b) => a.index - b.index).forEach((tab, index) => { tab.index = index; });
  }
  const module = await import(new URL(`../src/tabTuck.ts?case=${++importId}`, import.meta.url).href) as typeof import('../src/tabTuck');
  module.startTabTucking(() => {});
  await module.tabTuckingReady();
  return module;
}
afterEach(() => mock.restoreAll());
beforeEach(() => {
  elapsed = 0; focused = true; focusEvent.clear(); activatedEvent.clear(); movedEvent.clear();
  mock.method(Date, 'now', () => now + elapsed);
  local = { [clockKey]: { version: 1, enabled: true, clocks: { 'https://example.com': now - 2 * hour } },
    [recoveryKey]: { version: 1, records: [] } };
  session = {}; tabs = [{ ...tab }]; groups = []; alarm = undefined; alarmWrites = []; moved = [];
  idle = 'idle'; idleQueries = 0; queryIdle = () => idle; tabsQuery = undefined;
  alarmEvent.clear(); idleEvent.clear(); groupUpdatedEvent.clear(); tabUpdatedEvent.clear();
  Object.assign(getPreferences(), { autoTuck: true, autoTuckAfterHours: 168 });
});

const now = Date.UTC(2026, 9, 15);
const tab = { id: 1, windowId: 10, index: 2, url: 'https://example.com', active: false, pinned: false,
  groupId: -1, highlighted: false, incognito: false, status: 'complete' } as chrome.tabs.Tab;

test('group outcomes distinguish unchanged settings and each requested update', async () => {
  groups = [{ id: 7, windowId: 10, title: 'Work', color: 'blue', shared: false, collapsed: false }];
  const module = await start();
  assert.equal(await module.updateManagedGroup(10, 7, { title: 'Work' }), 'Group already has these settings');
  assert.equal(await module.updateManagedGroup(10, 7, { title: 'Research' }), 'Group renamed');
  assert.equal(await module.updateManagedGroup(10, 7, { color: 'red' }), 'Group color updated');
  assert.equal(await module.updateManagedGroup(10, 7, { collapsed: true }), 'Group collapsed');
  assert.equal(await module.updateManagedGroup(10, 7, { collapsed: false }), 'Group expanded');
  assert.equal(await module.updateManagedGroup(10, 7, { title: 'Reading', color: 'green' }), 'Group updated');
});

async function undoFixture() {
  tabs = [{ ...tab, groupId: 7 }, { ...tab, id: 2, groupId: 7 }];
  groups = [{ id: 7, windowId: 10, title: 'Tucked', color: 'grey', shared: false, collapsed: true }];
  session[sessionKey] = { version: 1, enabled: true, clocks: {},
    groups: [{ ...groups[0], key: 'owned', customTitle: true, members: [1, 2] }], undo: { 10: { groupId: 7, ids: [1, 2] } } };
  return start();
}

test('generated group names migrate without counts while custom names remain unchanged', async () => {
  const previousLanguage = getPreferences().language;
  try {
    for (const language of ['en', 'zh'] as const) {
      for (const customTitle of [false, true]) {
        const title = language === 'zh' ? '已收起 · 99' : 'Tucked Away · 99';
        getPreferences().language = language;
        tabs = [{ ...tab, groupId: 7 }];
        groups = [{ id: 7, windowId: 10, title, color: 'grey', shared: false, collapsed: true }];
        session[sessionKey] = { version: 1, enabled: true, clocks: {},
          groups: [{ ...groups[0], key: 'owned', customTitle, members: [1] }], undo: {} };
        const module = await start();
        const expected = customTitle ? title : language === 'zh' ? '收起来' : 'Tuck Away';
        assert.equal(groups[0].title, expected);
        assert.equal(local[recoveryKey].records.find((record: { key: string }) => record.key === 'owned').title, expected);
        assert.equal(module.tuckFlags(tabs[0]).tucked, true);
      }
    }
  } finally { getPreferences().language = previousLanguage; }
});

test('undo tuck reports the number returned and skips tabs that changed after the batch was recorded', async () => {
  let module = await undoFixture();
  assert.equal(await module.undoTuck(10), 'Tabs returned from tucked group: 2');
  module = await undoFixture();
  tabs[1].groupId = -1;
  assert.equal(await module.undoTuck(10), 'Tabs returned from tucked group: 1 · Unavailable or changed tabs skipped: 1');
  assert.equal(module.canUndoTuck(10), false);
});

test('undo tuck failure reports completed work and preserves the remaining undo state', async context => {
  const module = await undoFixture();
  const ungroup = chrome.tabs.ungroup;
  context.mock.method(chrome.tabs, 'ungroup', async (id: number) => {
    if (id === 2) throw new Error('native failure');
    await ungroup(id);
  });
  await assert.rejects(module.undoTuck(10), { message: 'Tabs returned from tucked group: 1 · Tabs not returned: 1. The operation stopped; review the group.' });
  assert.equal(tabs[0].groupId, -1);
  assert.equal(tabs[1].groupId, 7);
  assert.equal(module.canUndoTuck(10), true);
});

for (const operation of ['undo', 'disable'] as const) for (const change of ['rename', 'color', 'foreign member'] as const) {
  test(`${operation} stops releasing a group taken over by a user via ${change}`, async context => {
    const module = await undoFixture();
    const ungroup = chrome.tabs.ungroup;
    context.mock.method(chrome.tabs, 'ungroup', async (id: number) => {
      await ungroup(id);
      if (id !== 1) return;
      if (change === 'foreign member') {
        tabs.push({ ...tab, id: 99, groupId: 7 });
        tabUpdatedEvent.emit(99, { groupId: 7 }, structuredClone(tabs[2]));
      } else {
        if (change === 'rename') groups[0].title = 'My reading';
        else groups[0].color = 'blue';
        groupUpdatedEvent.emit(structuredClone(groups[0]));
      }
    });
    if (operation === 'undo') await module.undoTuck(10);
    else { getPreferences().autoTuck = false; await module.getTuckStatus(); }
    await module.getTuckStatus();
    assert.equal(tabs[0].groupId, -1);
    assert.equal(tabs[1].groupId, 7, 'the user-owned group must keep its remaining member');
    if (change === 'foreign member') assert.equal(tabs[2].groupId, 7);
    assert.equal(module.tuckFlags(tabs[1]).tucked, false);
    assert.equal(module.canUndoTuck(10), false);
  });
}

test('activating a tucked tab does not release it after a user takeover during the final read', async context => {
  const module = await undoFixture();
  tabs[0].active = true;
  const get = chrome.tabs.get;
  let reads = 0;
  context.mock.method(chrome.tabs, 'get', async (id: number) => {
    if (id === 1 && ++reads === 2) {
      groups[0].title = 'User owned';
      groupUpdatedEvent.emit(structuredClone(groups[0]));
    }
    return get(id);
  });
  activatedEvent.emit({ tabId: 1, windowId: 10 });
  await module.getTuckStatus(); await module.getTuckStatus();
  assert.equal(tabs[0].groupId, 7);
  assert.equal(module.tuckFlags(tabs[0]).tucked, false);
});

test('disabled status reports outstanding releases until the retry succeeds', async context => {
  const module = await undoFixture();
  const ungroup = chrome.tabs.ungroup;
  let failing = true;
  context.mock.method(chrome.tabs, 'ungroup', async (id: number) => {
    if (id === 2 && failing) throw new Error('Temporarily unavailable');
    return ungroup(id);
  });
  getPreferences().autoTuck = false;
  const pending = await module.getTuckStatus();
  assert.equal(pending.enabled, false);
  assert.equal(pending.pendingReleaseCount, 1);
  failing = false;
  const complete = await module.getTuckStatus();
  assert.equal(complete.pendingReleaseCount ?? 0, 0);
  assert.ok(tabs.every(tab => tab.groupId === -1));
});

test('a failed native group label update preserves ownership and undo for a later retry', async context => {
  getPreferences().autoTuckAfterHours = 1;
  const module = await start();
  const update = chrome.tabGroups.update;
  let fail = true;
  context.mock.method(console, 'warn', () => {});
  context.mock.method(chrome.tabGroups, 'update', async (id: number, changes: chrome.tabGroups.UpdateProperties) => {
    if (fail) { fail = false; throw new Error('Temporary metadata failure'); }
    return update(id, changes);
  });
  alarmEvent.emit(alarm!);
  await module.getTuckStatus();
  assert.equal(module.canUndoTuck(10), true);
  tabUpdatedEvent.emit(1, { pinned: false }, structuredClone(tabs[0]));
  await module.getTuckStatus(); await module.getTuckStatus();
  assert.equal(module.tuckFlags(tabs[0]).tucked, true);
  assert.equal(groups[0].title, 'Tuck Away');
  await module.undoTuck(10);
  assert.equal(tabs[0].groupId, -1);
});

test('automatic tuck requires a full seven days, including at the exact boundary', () => {
  assert.equal(idleTabEligible(tab, now - TUCK_AFTER + 1, now), false);
  assert.equal(idleTabEligible(tab, now - TUCK_AFTER, now), true);
  assert.equal(idleTabEligible(tab, now, now), false);
});
test('current, pinned, grouped, selected, audible and loading tabs stay in place', () => {
  for (const change of [ { active: true }, { pinned: true }, { groupId: 123 }, { highlighted: true },
    { audible: true }, { status: 'loading' }, { splitViewId: 4 }, { incognito: true }, { id: undefined } ]) {
    assert.equal(idleTabEligible({ ...tab, ...change } as chrome.tabs.Tab, now - TUCK_AFTER, now), false, JSON.stringify(change));
  }
});
test('missing and invalid timestamps never make a tab look old', () => {
  for (const value of [NaN, Infinity, -Infinity, 0, -1, now + TUCK_AFTER]) {
    assert.equal(idleTabEligible(tab, value, now), false, String(value));
  }
});
test('discarded tabs can be tucked without reloading them, and absent new Chrome fields remain compatible', () => {
  assert.equal(idleTabEligible({ ...tab, discarded: true }, now - TUCK_AFTER, now), true);
  assert.equal(idleTabEligible({ ...tab, groupId: undefined } as unknown as chrome.tabs.Tab, now - TUCK_AFTER, now), true);
});

test('custom thresholds retain exact-boundary and protected-tab eligibility', () => {
  assert.equal(idleTabEligible(tab, now - hour + 1, now, hour), false);
  assert.equal(idleTabEligible(tab, now - hour, now, hour), true);
  assert.equal(idleTabEligible({ ...tab, pinned: true }, now - hour, now, hour), false);
});

test('status previews current tabs without moving them, writing storage or advancing age', async () => {
  const module = await start();
  const before = structuredClone({ local, session });
  assert.deepEqual(await module.getTuckStatus(), { enabled: true, eligibleCount: 0, blockedCount: 0, notDueCount: 1, protectedCount: 0, waitingReason: 'scheduled', checkedAt: now });
  assert.deepEqual(await module.getTuckStatus(1), { enabled: true, eligibleCount: 1, blockedCount: 0, notDueCount: 0, protectedCount: 0, waitingReason: 'scheduled', checkedAt: now });
  tabs[0].audible = true;
  assert.equal((await module.getTuckStatus(1)).eligibleCount, 0, 'reads current native tab state');
  assert.deepEqual({ local, session }, before);
  assert.deepEqual(moved, []);
  assert.equal(idleQueries, 3, 'status reads scheduling conditions without running a scan');
  for (const value of [null, '1', 0, 1.5, 8761, NaN, Infinity]) {
    await assert.rejects(module.getTuckStatus(value as number), /Invalid automatic tuck duration/);
  }
});

test('status waits for initialization and previously queued scans', async () => {
  let release!: () => void;
  let entered!: () => void;
  const enteredQuery = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  tabsQuery = async () => { entered(); await barrier; };
  const module = await import(new URL(`../src/tabTuck.ts?case=${++importId}`, import.meta.url).href) as typeof import('../src/tabTuck');
  module.startTabTucking(() => {});
  let resolved = false;
  const status = module.getTuckStatus(1).then(value => { resolved = true; return value; });
  await enteredQuery;
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(resolved, false);
  release();
  assert.equal((await status).eligibleCount, 1);
  tabsQuery = undefined;
  alarmEvent.emit(alarm!);
  assert.equal((await module.getTuckStatus()).lastScanAt, now, 'status waits for the queued scan to complete');
});

test('status synchronizes enable changes before reporting age', async () => {
  getPreferences().autoTuck = false;
  const module = await start();
  getPreferences().autoTuck = true;
  assert.equal((await module.getTuckStatus(1)).eligibleCount, 0, 'enabling starts fresh clocks');
  assert.equal(session[sessionKey].enabled, true);
  assert.equal(session[sessionKey].clocks[1].usedAt, now);
  assert.deepEqual(moved, []);
  getPreferences().autoTuck = false;
  assert.equal((await module.getTuckStatus()).enabled, false);
  assert.equal(session[sessionKey].enabled, false);
  assert.equal(alarm, undefined);
});

test('duration changes preserve clocks and wait for an idle scan', async () => {
  const module = await start();
  const usedAt = session[sessionKey].clocks[1].usedAt;
  getPreferences().autoTuckAfterHours = 1;
  assert.equal((await module.getTuckStatus()).eligibleCount, 1);
  assert.equal(session[sessionKey].clocks[1].usedAt, usedAt);
  assert.deepEqual(moved, []);
  idle = 'active';
  alarmEvent.emit(alarm!);
  assert.equal((await module.getTuckStatus()).lastScanAt, undefined);
  assert.deepEqual(moved, []);
  idle = 'idle';
  alarmEvent.emit(alarm!);
  const status = await module.getTuckStatus();
  assert.deepEqual(moved, [1]);
  assert.equal(status.eligibleCount, 0);
  assert.equal(status.lastScanAt, now);
  assert.equal(local[clockKey].lastScanAt, now);
});

for (const color of ['grey', 'blue'] as const) test(`automatic tuck names and reuses a new ${color} group with no title property`, async context => {
  getPreferences().autoTuckAfterHours = 1;
  tabs.push({ ...tab, id: 2 });
  const createGroup = chrome.tabs.group;
  context.mock.method(chrome.tabs, 'group', async (options: chrome.tabs.GroupOptions) => {
    const id = await createGroup(options);
    if (options.groupId === undefined) {
      const group = groups.find(group => group.id === id)!;
      delete group.title;
      group.color = color;
    } else {
      groupUpdatedEvent.emit(structuredClone(groups.find(group => group.id === id)!));
    }
    return id;
  });
  const module = await start();
  alarmEvent.emit(alarm!);
  await module.getTuckStatus();
  assert.deepEqual(moved, [1, 2]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, 'Tuck Away');
  assert.equal(groups[0].color, 'grey');
  assert.equal(groups[0].collapsed, true);
  assert.equal(module.tuckFlags(tabs[0]).tucked, true);
  assert.equal(module.tuckFlags(tabs[1]).tucked, true);
  tabs.push({ ...tab, id: 3 });
  session[sessionKey].clocks[3] = { url: tab.url, usedAt: now - 2 * hour };
  // A new worker keeps ownership and uses the same group in a later batch.
  alarmEvent.clear(); idleEvent.clear(); groupUpdatedEvent.clear(); tabUpdatedEvent.clear();
  const restarted = await start();
  alarmEvent.emit(alarm!);
  await restarted.getTuckStatus();
  assert.equal(tabs[2].groupId, groups[0].id);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, 'Tuck Away');
  await restarted.undoTuck(10);
  assert.deepEqual(tabs.map(tab => tab.groupId), [groups[0].id, groups[0].id, -1]);
});

test('status separately counts recovery-blocked candidates using the scan window rule', async () => {
  getPreferences().autoTuckAfterHours = 1;
  tabs.push({ ...tab, id: 2, windowId: 20 }, { ...tab, id: 3, windowId: 30 },
    { ...tab, id: 4, windowId: 20, groupId: 50 }, { ...tab, id: 5, windowId: 30, groupId: 60 },
    { ...tab, id: 6, windowId: 30, groupId: 70, url: 'https://recovery.example' });
  groups = [
    { id: 50, windowId: 20, title: 'Owned 20', color: 'grey', shared: false, collapsed: true },
    { id: 60, windowId: 30, title: 'Owned 30', color: 'grey', shared: false, collapsed: true },
    { id: 70, windowId: 30, title: 'Unresolved', color: 'grey', shared: false, collapsed: true },
  ];
  session[sessionKey] = { version: 1, enabled: true,
    clocks: Object.fromEntries(tabs.map(tab => [tab.id, { url: tab.url, usedAt: now - 2 * hour }])),
    groups: groups.slice(0, 2).map((group, i) => ({ ...group, key: `owned-${group.id}`, customTitle: true, members: [4 + i] })), undo: {} };
  local[recoveryKey].records = [{ key: 'pending', title: 'Unresolved', urls: ['https://recovery.example'], context: [], requiresConfirmation: true }];
  const module = await start();
  const status = await module.getTuckStatus();
  assert.equal(status.eligibleCount, 1, 'owned window without recovery candidate stays eligible');
  assert.equal(status.blockedCount, 2, 'unowned window and window with a recovery candidate are blocked');
  assert.deepEqual(moved, []);
  alarmEvent.emit(alarm!);
  await module.getTuckStatus();
  assert.deepEqual(moved, [2], 'automatic scan uses the same blocking rule');
});

test('startup migrates the old alarm but preserves an existing five-minute schedule', async () => {
  alarm = { name: alarmName, scheduledTime: now + 999_999, periodInMinutes: 30, persistAcrossSessions: true };
  await start();
  assert.deepEqual(alarmWrites, [{ delayInMinutes: 1, periodInMinutes: 5 }]);
  const scheduledTime = alarm!.scheduledTime;
  alarmWrites = [];
  await start();
  assert.deepEqual(alarmWrites, []);
  assert.equal(alarm!.scheduledTime, scheduledTime);
});

test('completed idle scans persist their timestamp through worker and browser restarts', async () => {
  let module = await start();
  assert.deepEqual(alarmWrites, [{ delayInMinutes: 1, periodInMinutes: 5 }]);
  alarmEvent.emit(alarm!);
  assert.equal((await module.getTuckStatus()).lastScanAt, now, 'zero candidates is still a completed check');
  module = await start();
  assert.equal((await module.getTuckStatus()).lastScanAt, now, 'worker restart');
  session = {};
  module = await start();
  assert.equal((await module.getTuckStatus()).lastScanAt, now, 'browser restart');
  getPreferences().autoTuck = false;
  assert.equal((await module.getTuckStatus()).lastScanAt, undefined);
  assert.equal(local[clockKey].lastScanAt, undefined);
  getPreferences().autoTuck = true;
  assert.equal((await module.getTuckStatus()).lastScanAt, undefined);
});

test('automatic tuck rechecks idle state per tab and does not stamp an interrupted scan', async () => {
  getPreferences().autoTuckAfterHours = 1;
  tabs.push({ ...tab, id: 2 }, { ...tab, id: 3 });
  const module = await start();
  queryIdle = () => moved.length ? 'active' : 'idle';
  alarmEvent.emit(alarm!);
  assert.equal((await module.getTuckStatus()).lastScanAt, undefined);
  assert.deepEqual(moved, [1]);
  assert.notEqual(tabs[0].groupId, -1);
  assert.deepEqual(tabs.slice(1).map(tab => tab.groupId), [-1, -1]);
  assert.deepEqual(session[sessionKey].undo[10], { groupId: tabs[0].groupId, ids: [1] });
  assert.equal(module.canUndoTuck(10), true);
  await module.undoTuck(10);
  assert.deepEqual(tabs.map(tab => tab.groupId), [-1, -1, -1]);
  assert.equal(module.canUndoTuck(10), false);
});

test('unfocused Chrome waits thirty minutes, survives worker sleep, and stops on return', async () => {
  getPreferences().autoTuckAfterHours = 1;
  idle = 'active';
  let module = await start();
  assert.equal((await module.getTuckStatus()).waitingReason, 'active');
  focused = false; focusEvent.emit(-1);
  assert.equal((await module.getTuckStatus()).waitingReason, 'grace');
  assert.deepEqual(alarmWrites, [{ delayInMinutes: 1, periodInMinutes: 5 }]);
  elapsed = 30 * 60_000 - 1;
  alarmEvent.emit(alarm!);
  await module.getTuckStatus();
  assert.deepEqual(moved, []);
  alarmEvent.clear(); idleEvent.clear(); groupUpdatedEvent.clear(); tabUpdatedEvent.clear(); focusEvent.clear();
  module = await start();
  elapsed = 30 * 60_000;
  assert.equal((await module.getTuckStatus()).waitingReason, 'scheduled');
  tabs.push({ ...tab, id: 2 });
  // Returning after the first move interrupts the batch, even before queued focus work.
  const group = chrome.tabs.group;
  mock.method(chrome.tabs, 'group', async (options: chrome.tabs.GroupOptions) => {
    const id = await group(options);
    focused = true; focusEvent.emit(10);
    return id;
  });
  alarmEvent.emit(alarm!);
  const status = await module.getTuckStatus();
  assert.deepEqual(moved, [1]);
  assert.equal(status.lastScanAt, undefined);
  assert.equal(status.waitingReason, 'active');
  await module.getTuckStatus();
  assert.equal(session.justonehopTabTuckFocus.unfocusedAt, undefined);
  assert.equal(tabs[1].groupId, -1);
});

test('returning before grace expires cancels tucking and a new absence starts over', async () => {
  getPreferences().autoTuckAfterHours = 1;
  idle = 'active';
  const module = await start();
  focused = false; focusEvent.emit(-1);
  await module.getTuckStatus();
  elapsed = 30_000;
  focused = true; focusEvent.emit(10);
  await module.getTuckStatus();
  assert.equal(session.justonehopTabTuckFocus.unfocusedAt, undefined);
  elapsed = 30 * 60_000;
  alarmEvent.emit(alarm!);
  await module.getTuckStatus();
  assert.deepEqual(moved, []);
  focused = false; focusEvent.emit(-1);
  await module.getTuckStatus();
  assert.equal(session.justonehopTabTuckFocus.unfocusedAt, now + elapsed);
  elapsed = 60 * 60_000;
  alarmEvent.emit(alarm!);
  assert.equal((await module.getTuckStatus()).lastScanAt, now + elapsed);
  assert.deepEqual(moved, [1]);
});

test('status separates protected, not due, and eligible tabs without changing their age', async () => {
  getPreferences().autoTuckAfterHours = 1;
  tabs.push({ ...tab, id: 2, active: true }, { ...tab, id: 3, pinned: true },
    { ...tab, id: 4, audible: true }, { ...tab, id: 5, url: 'https://fresh.example' },
    { ...tab, id: 6, incognito: true });
  const module = await start();
  const status = await module.getTuckStatus();
  assert.equal(status.eligibleCount, 1);
  assert.equal(status.notDueCount, 1);
  assert.equal(status.protectedCount, 3);
});

test('batch group events coalesce storage writes and retain complete recovery and undo', async context => {
  getPreferences().autoTuckAfterHours = 1;
  tabs = Array.from({ length: 200 }, (_, index) => ({ ...tab, id: index + 1 }));
  const module = await start();
  const set = context.mock.method(chrome.storage.local, 'set');
  const query = context.mock.method(chrome.tabs, 'query');
  const group = chrome.tabs.group;
  context.mock.method(chrome.tabs, 'group', async (options: chrome.tabs.GroupOptions) => {
    const id = await group(options);
    for (const tabId of options.tabIds as number[]) {
      tabUpdatedEvent.emit(tabId, { groupId: id }, structuredClone(tabs.find(tab => tab.id === tabId)!));
    }
    return id;
  });
  alarmEvent.emit(alarm!);
  await module.getTuckStatus();
  await module.getTuckStatus(); // Drain reconciliation queued behind the scan.
  assert.equal(moved.length, 200);
  assert.ok(query.mock.callCount() < 25, `batch queried tabs ${query.mock.callCount()} times`);
  assert.ok(set.mock.callCount() <= 3, `batch wrote local storage ${set.mock.callCount()} times`);
  assert.equal(local[recoveryKey].records[0].urls.length, 200);
  assert.equal(session[sessionKey].undo[10].ids.length, 200);
  await module.undoTuck(10);
  assert.ok(tabs.every(tab => tab.groupId === -1));
});

test('coalesced reconciliation still relinquishes a group edited during a batch', async context => {
  getPreferences().autoTuckAfterHours = 1;
  tabs = [1, 2, 3].map(id => ({ ...tab, id }));
  const module = await start();
  const group = chrome.tabs.group;
  context.mock.method(chrome.tabs, 'group', async (options: chrome.tabs.GroupOptions) => {
    const id = await group(options);
    const tabId = (options.tabIds as number[])[0];
    tabUpdatedEvent.emit(tabId, { groupId: id }, structuredClone(tabs.find(tab => tab.id === tabId)!));
    if (moved.length === 2) {
      groups[0].title = 'My group';
      groups[0].color = 'blue';
      groupUpdatedEvent.emit(structuredClone(groups[0]));
    }
    return id;
  });
  alarmEvent.emit(alarm!);
  await module.getTuckStatus(); await module.getTuckStatus();
  assert.deepEqual(moved, [1, 2]);
  assert.equal(groups[0].title, 'My group');
  assert.equal(groups[0].color, 'blue');
  assert.equal(tabs[2].groupId, -1);
  assert.equal(module.tuckFlags(tabs[0]).tucked, false);
  assert.equal(module.canUndoTuck(10), false);
});

test('external membership changes invalidate batch reuse before another tab joins', async context => {
  getPreferences().autoTuckAfterHours = 1;
  tabs = [1, 2, 3].map(id => ({ ...tab, id }));
  tabs.push({ ...tab, id: 99, pinned: true });
  const module = await start();
  const group = chrome.tabs.group;
  context.mock.method(chrome.tabs, 'group', async (options: chrome.tabs.GroupOptions) => {
    const id = await group(options);
    if (moved.length === 2) {
      tabs[3].pinned = false; tabs[3].groupId = id;
      tabUpdatedEvent.emit(99, { groupId: id }, structuredClone(tabs[3]));
    }
    return id;
  });
  alarmEvent.emit(alarm!);
  await module.getTuckStatus(); await module.getTuckStatus();
  assert.deepEqual(moved, [1, 2]);
  assert.equal(tabs[2].groupId, -1);
  assert.equal(tabs[3].groupId, groups[0].id);
  assert.equal(module.tuckFlags(tabs[0]).tucked, false);
  assert.equal(module.canUndoTuck(10), false);
});

test('periodic membership checks stop a batch even if an external event is missing', async context => {
  getPreferences().autoTuckAfterHours = 1;
  tabs = Array.from({ length: 100 }, (_, index) => ({ ...tab, id: index + 1 }));
  tabs.push({ ...tab, id: 999, pinned: true });
  const module = await start();
  const group = chrome.tabs.group;
  context.mock.method(chrome.tabs, 'group', async (options: chrome.tabs.GroupOptions) => {
    const id = await group(options);
    if (moved.length === 2) { tabs[100].pinned = false; tabs[100].groupId = id; }
    return id;
  });
  alarmEvent.emit(alarm!);
  await module.getTuckStatus();
  assert.ok(moved.length < 40);
  assert.equal(module.tuckFlags(tabs[0]).tucked, false);
});

test('events arriving during reconciliation schedule a fresh pass', async context => {
  const module = await undoFixture();
  const set = chrome.storage.local.set;
  let changed = false;
  context.mock.method(chrome.storage.local, 'set', async (patch: Record<string, unknown>) => {
    await set(patch);
    if (changed) return;
    changed = true;
    tabs[1].groupId = -1;
    tabUpdatedEvent.emit(2, { groupId: -1 }, structuredClone(tabs[1]));
  });
  tabUpdatedEvent.emit(1, { pinned: false }, structuredClone(tabs[0]));
  await module.getTuckStatus(); await module.getTuckStatus();
  assert.deepEqual(session[sessionKey].groups[0].members, [1]);
  assert.equal(local[recoveryKey].records[0].urls.length, 1);
});

for (const change of [{ audible: true }, { highlighted: true }, { status: 'loading' },
  { lastAccessed: now }, { url: 'https://new.example' }]) {
  test(`automatic tuck rechecks live eligibility before grouping: ${JSON.stringify(change)}`, async context => {
    getPreferences().autoTuckAfterHours = 1;
    const module = await start();
    const get = chrome.tabs.get;
    let reads = 0;
    context.mock.method(chrome.tabs, 'get', async (id: number) => {
      if (++reads === 2) Object.assign(tabs[0], change);
      return get(id);
    });
    alarmEvent.emit(alarm!);
    await module.getTuckStatus();
    assert.deepEqual(moved, [], 'a newly protected or recently used tab must stay in place');
  });
}

test('disabling during the final idle query prevents grouping', async context => {
  getPreferences().autoTuckAfterHours = 1;
  const module = await start();
  const get = chrome.tabs.get;
  let reads = 0;
  context.mock.method(chrome.tabs, 'get', async (id: number) => {
    if (++reads === 1) queryIdle = () => { getPreferences().autoTuck = false; return 'idle'; };
    return get(id);
  });
  alarmEvent.emit(alarm!);
  await module.getTuckStatus();
  assert.deepEqual(moved, [], 'turning off the feature while an API is pending must stop the move');
});

for (const interrupt of ['focus', 'system active', 'disable', 'rename', 'foreign member'] as const) {
  test(`automatic tuck stops when ${interrupt} changes during its final tab read`, async context => {
    getPreferences().autoTuckAfterHours = 1;
    tabs = [1, 2, 3].map(id => ({ ...tab, id }));
    tabs.push({ ...tab, id: 99, pinned: true });
    const module = await start();
    const get = chrome.tabs.get;
    let reads = 0;
    context.mock.method(chrome.tabs, 'get', async (id: number) => {
      if (id === 3 && ++reads === 2) {
        if (interrupt === 'focus') { idle = 'active'; focusEvent.emit(10); }
        if (interrupt === 'system active') { idle = 'active'; idleEvent.emit('active' as chrome.idle.IdleState); }
        if (interrupt === 'disable') getPreferences().autoTuck = false;
        if (interrupt === 'rename') {
          groups[0].title = 'My group';
          groupUpdatedEvent.emit(structuredClone(groups[0]));
        }
        if (interrupt === 'foreign member') {
          tabs[3].pinned = false; tabs[3].groupId = groups[0].id;
          tabUpdatedEvent.emit(99, { groupId: groups[0].id }, structuredClone(tabs[3]));
        }
      }
      return get(id);
    });
    alarmEvent.emit(alarm!);
    await module.getTuckStatus(); await module.getTuckStatus();
    assert.deepEqual(moved, [1, 2]);
    assert.equal(tabs[2].groupId, -1);
    if (interrupt === 'rename' || interrupt === 'foreign member') {
      assert.equal(module.tuckFlags(tabs[0]).tucked, false);
      assert.equal(module.canUndoTuck(10), false);
    }
  });
}

test('a successful group survives a failed initial metadata read and worker restart', async context => {
  getPreferences().autoTuckAfterHours = 1;
  const module = await start();
  const get = chrome.tabGroups.get;
  let fail = true;
  context.mock.method(console, 'warn', () => {});
  context.mock.method(chrome.tabGroups, 'get', async (id: number) => {
    if (fail) { fail = false; throw new Error('metadata unavailable'); }
    return get(id);
  });
  alarmEvent.emit(alarm!);
  await module.getTuckStatus();
  assert.equal(module.canUndoTuck(10), true);
  assert.equal(module.tuckFlags(tabs[0]).tucked, true);
  assert.deepEqual(session[sessionKey].groups[0].members, [1]);
  const restarted = await start();
  assert.equal(groups[0].title, 'Tuck Away');
  await restarted.undoTuck(10);
  assert.equal(tabs[0].groupId, -1);
});

async function orderFixture() {
  getPreferences().autoTuckAfterHours = 1;
  tabs = [1, 2, 3, 4].map((id, index) => ({ ...tab, id, index, groupId: id % 2 === 0 ? 7 : -1 }));
  groups = [{ id: 7, windowId: 10, title: 'Tuck Away', color: 'grey', shared: false, collapsed: true }];
  session[sessionKey] = { version: 1, enabled: true,
    clocks: Object.fromEntries(tabs.map(tab => [tab.id, { url: tab.url, usedAt: now - 2 * hour }])),
    groups: [{ ...groups[0], key: 'owned', members: [2, 4] }], undo: {}, order: { 10: [1, 2, 3, 4] } };
  const module = await start();
  const group = chrome.tabs.group;
  mock.method(chrome.tabs, 'group', async (options: chrome.tabs.GroupOptions) => {
    const result = await group(options);
    const id = Array.isArray(options.tabIds) ? options.tabIds[0] : options.tabIds!;
    await chrome.tabs.move(id, { index: 3 });
    return result;
  });
  return module;
}
const orderedMembers = () => tabs.filter(tab => tab.groupId === 7).sort((a, b) => a.index - b.index).map(tab => tab.id);

for (const interruption of ['move failure', 'system active'] as const) {
  test(`unfinished order retries after ${interruption}, including with no new candidates`, async context => {
    const module = await orderFixture();
    tabs.find(tab => tab.id === 3)!.audible = true;
    const move = chrome.tabs.move;
    let fail = true;
    context.mock.method(console, 'warn', () => {});
    context.mock.method(chrome.tabs, 'move', async (id: number, properties: chrome.tabs.MoveProperties) => {
      if (properties.index !== 3 && fail && interruption === 'move failure') {
        fail = false; throw new Error('tab temporarily unavailable');
      }
      const result = await move(id, properties);
      if (properties.index === 3 && fail && interruption === 'system active') {
        fail = false; idle = 'active'; idleEvent.emit('active' as chrome.idle.IdleState);
      }
      return result;
    });
    alarmEvent.emit(alarm!);
    await module.getTuckStatus();
    assert.deepEqual(orderedMembers(), [2, 4, 1]);
    assert.deepEqual(session[sessionKey].pendingOrder[10], [{ id: 1, before: 2 }]);
    const restarted = await start();
    idle = 'idle';
    alarmEvent.emit(alarm!);
    await restarted.getTuckStatus();
    assert.deepEqual(orderedMembers(), [1, 2, 4]);
    tabs.find(tab => tab.id === 3)!.audible = false;
    alarmEvent.emit(alarm!);
    await restarted.getTuckStatus();
    assert.deepEqual(orderedMembers(), [1, 2, 3, 4]);
  });
}

test('a user reorder remains authoritative after the moved member leaves', async () => {
  const module = await orderFixture();
  await chrome.tabs.move(4, { index: 1 });
  tabs.find(tab => tab.id === 4)!.groupId = -1;
  tabs.find(tab => tab.id === 4)!.audible = true;
  tabUpdatedEvent.emit(4, { groupId: -1 }, structuredClone(tabs.find(tab => tab.id === 4)!));
  await module.getTuckStatus();
  alarmEvent.emit(alarm!);
  await module.getTuckStatus();
  assert.deepEqual(orderedMembers(), [1, 2, 3]);
  assert.deepEqual(session[sessionKey].order[10], [1, 4, 2, 3]);
  tabs.find(tab => tab.id === 4)!.audible = false;
  alarmEvent.emit(alarm!);
  await module.getTuckStatus();
  assert.deepEqual(orderedMembers(), [1, 4, 2, 3]);
});

test('user reordering during a candidate read stops the old order batch', async context => {
  const module = await orderFixture();
  const get = chrome.tabs.get;
  let reads = 0;
  context.mock.method(chrome.tabs, 'get', async (id: number) => {
    if (id === 1 && ++reads === 2) await chrome.tabs.move(4, { index: 1 });
    return get(id);
  });
  alarmEvent.emit(alarm!);
  await module.getTuckStatus(); await module.getTuckStatus();
  assert.deepEqual(moved, []);
  alarmEvent.emit(alarm!);
  await module.getTuckStatus();
  assert.deepEqual(orderedMembers(), [1, 4, 2, 3]);
});

test('user reordering while grouping is pending cancels historical insertion', async context => {
  const module = await orderFixture();
  const group = chrome.tabs.group;
  context.mock.method(chrome.tabs, 'group', async (options: chrome.tabs.GroupOptions) => {
    const result = await group(options);
    await chrome.tabs.move(4, { index: 0 });
    return result;
  });
  alarmEvent.emit(alarm!);
  await module.getTuckStatus(); await module.getTuckStatus();
  assert.deepEqual(moved, [1]);
  assert.deepEqual(orderedMembers(), [4, 2, 1]);
  assert.equal(session[sessionKey].pendingOrder?.[10]?.length || 0, 0);
});

test('pending insertion uses the next surviving successor when its target leaves', async context => {
  const module = await orderFixture();
  tabs.find(tab => tab.id === 3)!.audible = true;
  const move = chrome.tabs.move;
  let fail = true;
  context.mock.method(console, 'warn', () => {});
  context.mock.method(chrome.tabs, 'move', async (id: number, properties: chrome.tabs.MoveProperties) => {
    if (properties.index !== 3 && fail) { fail = false; throw new Error('temporary move failure'); }
    return move(id, properties);
  });
  alarmEvent.emit(alarm!);
  await module.getTuckStatus();
  tabs.find(tab => tab.id === 2)!.groupId = -1;
  tabs.find(tab => tab.id === 2)!.audible = true;
  tabUpdatedEvent.emit(2, { groupId: -1 }, structuredClone(tabs.find(tab => tab.id === 2)!));
  await module.getTuckStatus();
  alarmEvent.emit(alarm!);
  await module.getTuckStatus();
  assert.deepEqual(orderedMembers(), [1, 4]);
});

test('manual order survives activating and later retucking a member', async () => {
  const module = await undoFixture();
  tabs.forEach((tab, index) => { tab.index = index; });
  await chrome.tabs.move(2, { index: 0 });
  tabs[0].active = true;
  activatedEvent.emit({ tabId: 1, windowId: 10 });
  await module.getTuckStatus(); await module.getTuckStatus();
  assert.equal(tabs[0].groupId, -1);
  assert.deepEqual(session[sessionKey].order[10], [2, 1]);
  tabs[0].active = false;
  elapsed = 8 * 24 * hour;
  alarmEvent.emit(alarm!);
  await module.getTuckStatus();
  assert.deepEqual(orderedMembers(), [2, 1]);
});

for (const operation of ['undo', 'disable'] as const) {
  test(`${operation} bounds full membership queries for 200 native removals`, async context => {
    await undoFixture();
    tabs = Array.from({ length: 200 }, (_, index) => ({ ...tab, id: index + 1, index, groupId: 7 }));
    session[sessionKey].groups[0].members = tabs.map(tab => tab.id);
    session[sessionKey].undo[10].ids = tabs.map(tab => tab.id);
    const module = await start();
    const query = context.mock.method(chrome.tabs, 'query');
    const ungroup = chrome.tabs.ungroup;
    context.mock.method(chrome.tabs, 'ungroup', async (id: number) => {
      await ungroup(id);
      tabUpdatedEvent.emit(id, { groupId: -1 }, structuredClone(tabs.find(tab => tab.id === id)!));
    });
    if (operation === 'undo') await module.undoTuck(10);
    else { getPreferences().autoTuck = false; await module.getTuckStatus(); }
    await module.getTuckStatus(); await module.getTuckStatus();
    assert.ok(tabs.every(tab => tab.groupId === -1));
    assert.ok(query.mock.callCount() < 30, `${query.mock.callCount()} tab queries for 200 removals`);
  });
}

test('failed candidate checks do not stamp a successful scan', async context => {
  const module = await start();
  const warn = context.mock.method(console, 'warn', () => {});
  let fail = true;
  tabsQuery = async () => { if (fail) { fail = false; throw new Error('query failed'); } };
  alarmEvent.emit(alarm!);
  assert.equal((await module.getTuckStatus()).lastScanAt, undefined);
  assert.equal(warn.mock.callCount(), 1);
  assert.equal((await module.getTuckStatus()).lastFailureAt, now);
  assert.equal(session[sessionKey].lastFailureAt, now);
  alarmEvent.emit(alarm!);
  assert.equal((await module.getTuckStatus()).lastFailureAt, undefined);
  assert.equal((await module.getTuckStatus()).lastScanAt, now);
});
