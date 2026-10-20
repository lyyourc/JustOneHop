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
    ungroup: async (id: number) => { tabs.find(tab => tab.id === id)!.groupId = -1; },
    onActivated: ignoredEvent, onCreated: ignoredEvent, onRemoved: ignoredEvent, onAttached: ignoredEvent,
    onDetached: ignoredEvent, onUpdated: ignoredEvent,
  },
  tabGroups: {
    query: async () => structuredClone(groups),
    get: async (id: number) => structuredClone(groups.find(group => group.id === id)),
    update: async (id: number, changes: chrome.tabGroups.UpdateProperties) => { Object.assign(groups.find(group => group.id === id)!, changes); },
    move: async () => {}, onCreated: ignoredEvent, onRemoved: ignoredEvent, onUpdated: ignoredEvent,
  },
} as unknown as typeof chrome;
const { idleTabEligible, TUCK_AFTER } = await import('../src/tabTuck');
const { getPreferences, preferencesReady } = await import('../src/preferences');
await preferencesReady;
let importId = 0;
async function start() {
  const module = await import(new URL(`../src/tabTuck.ts?case=${++importId}`, import.meta.url).href) as typeof import('../src/tabTuck');
  module.startTabTucking(() => {});
  await module.tabTuckingReady();
  return module;
}
afterEach(() => mock.restoreAll());
beforeEach(() => {
  mock.method(Date, 'now', () => now);
  local = { [clockKey]: { version: 1, enabled: true, clocks: { 'https://example.com': now - 2 * hour } },
    [recoveryKey]: { version: 1, records: [] } };
  session = {}; tabs = [{ ...tab }]; groups = []; alarm = undefined; alarmWrites = []; moved = [];
  idle = 'idle'; idleQueries = 0; queryIdle = () => idle; tabsQuery = undefined;
  alarmEvent.clear(); idleEvent.clear();
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
  assert.deepEqual(await module.getTuckStatus(), { enabled: true, eligibleCount: 0, blockedCount: 0, checkedAt: now });
  assert.deepEqual(await module.getTuckStatus(1), { enabled: true, eligibleCount: 1, blockedCount: 0, checkedAt: now });
  tabs[0].audible = true;
  assert.equal((await module.getTuckStatus(1)).eligibleCount, 0, 'reads current native tab state');
  assert.deepEqual({ local, session }, before);
  assert.deepEqual(moved, []);
  assert.equal(idleQueries, 0, 'status can preview while the browser is active');
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
  tabs.push({ ...tab, id: 2 });
  const module = await start();
  queryIdle = () => moved.length ? 'active' : 'idle';
  alarmEvent.emit(alarm!);
  assert.equal((await module.getTuckStatus()).lastScanAt, undefined);
  assert.deepEqual(moved, [1]);
});

test('failed candidate checks do not stamp a successful scan', async context => {
  const module = await start();
  const warn = context.mock.method(console, 'warn', () => {});
  let fail = true;
  tabsQuery = async () => { if (fail) { fail = false; throw new Error('query failed'); } };
  alarmEvent.emit(alarm!);
  assert.equal((await module.getTuckStatus()).lastScanAt, undefined);
  assert.equal(warn.mock.callCount(), 1);
});
