import { groupFingerprint, matchRecovery, readTuckRecords, recoveryCandidates, type TuckRecord, type RecoveryGroup } from './tuckRecovery';
import type { TuckRecoveryItem } from './types';
import { getPreferences, preferencesReady, subscribePreferences } from './preferences';
import { t } from './i18n';

export const TUCK_AFTER = 7 * 24 * 60 * 60 * 1000;
const ALARM = 'zing-auto-tuck';
const SESSION_KEY = 'zingTabTuckSession';
const RECOVERY_KEY = 'zingTabTuckRecovery';
const CLOCK_KEY = 'zingTabTuckClocks';
type Clock = { url: string; usedAt: number };
type Group = { key?: string; id: number; windowId: number; title: string; color?: chrome.tabGroups.TabGroup['color']; customTitle?: boolean; members: number[] };
type Batch = { groupId: number; ids: number[] };
type State = { version: 1; enabled: boolean; clocks: Record<number, Clock>; groups: Group[]; undo: Record<number, Batch>; active?: Record<number, number> };
let state: State = { version: 1, enabled: false, clocks: {}, groups: [], undo: {} };
let ready = Promise.resolve();
let queue = Promise.resolve();
let notify = () => {};
let started = false;
const invalidGroups = new Set<number>();
const joiningTabs = new Set<number>();
const activeTabs = new Map<number, number>();
let records: TuckRecord[] = [];
let pendingRecovery: TuckRecoveryItem[] = [];
let restoring = false;
export const tuckRecoveries = () => pendingRecovery;
const recordKey = (group: Group) => group.key ??= crypto.randomUUID();
const forgetRecord = (key: string) => { records = records.filter(record => record.key !== key); };
// Extension pages are transient UI, not part of the user's window context.
const contextUrls = (tabs: chrome.tabs.Tab[], windowId: number, groupId: number) => tabs
  .filter(tab => tab.windowId === windowId && tab.groupId !== groupId && !tab.incognito && /^https?:/.test(tab.url || ''))
  .map(tab => tab.url!);
async function nativeGroups(tabs: chrome.tabs.Tab[]): Promise<RecoveryGroup[]> {
  const groups = await chrome.tabGroups.query({});
  return groups.flatMap(group => {
    const members = tabs.filter(tab => tab.groupId === group.id && !tab.incognito);
    return members.length ? [{ id: group.id, windowId: group.windowId, title: group.title || '', color: group.color,
      tabs: members.map(tab => ({ id: tab.id!, title: tab.title || tab.url || '', url: tab.url || '' })),
      context: contextUrls(tabs, group.windowId, group.id) }] : [];
  });
}
async function recover(tabs?: chrome.tabs.Tab[]) {
  if (restoring) return;
  restoring = true;
  try {
    tabs ??= await normalTabs();
    const unresolved = records.filter(record => !state.groups.some(group => recordKey(group) === record.key));
    if (!unresolved.length) { pendingRecovery = []; return; }
    const groups = (await nativeGroups(tabs)).filter(group => !state.groups.some(owned => owned.id === group.id));
    for (const [key, group] of matchRecovery(unresolved, groups)) {
      state.groups.push({ key, id: group.id, windowId: group.windowId, title: group.title, color: group.color as chrome.tabGroups.TabGroup['color'], customTitle: unresolved.find(record => record.key === key)?.customTitle, members: group.tabs.map(tab => tab.id) });
    }
    pendingRecovery = unresolved.filter(record => !state.groups.some(group => recordKey(group) === record.key)).map(record => ({
      id: record.key, title: record.title, urls: record.urls,
      candidates: recoveryCandidates(record, groups).filter(group => !state.groups.some(owned => owned.id === group.id)).map(group => ({
        id: group.id, windowId: group.windowId, title: group.title, tabs: group.tabs, fingerprint: groupFingerprint(group),
      })),
    }));
  } finally { restoring = false; }
}
export async function resumeTuck(windowId: number, recoveryId: string, groupId: number, fingerprint: string) {
  await ready;
  return serial(async () => {
    const record = records.find(record => record.key === recoveryId);
    const groups = await nativeGroups(await normalTabs());
    const group = record && recoveryCandidates(record, groups).find(group => group.id === groupId && group.windowId === windowId);
    if (!record || !group || groupFingerprint(group) !== fingerprint ||
      state.groups.some(owned => owned.id === groupId || recordKey(owned) === recoveryId)) throw new Error(t('errorTuckRecoveryChanged'));
    invalidGroups.delete(groupId);
    // Explicit confirmation adopts the current metadata. A changed name (even
    // an empty one) is custom; unchanged generated names can still track counts.
    const owned: Group = { key: record.key, id: group.id, windowId, title: group.title,
      color: group.color as chrome.tabGroups.TabGroup['color'], customTitle: record.customTitle || group.title !== record.title,
      members: group.tabs.map(tab => tab.id) };
    state.groups.push(owned);
    try { await chrome.tabGroups.update(group.id, {
      collapsed: !(await chrome.tabs.query({ groupId })).some(tab => tab.active) }); }
    catch (error) { state.groups = state.groups.filter(item => item !== owned); throw error; }
    for (const tab of await chrome.tabs.query({ groupId })) if (tab.active) await releaseTab(tab);
    await persist();
  });
}
// Group edits from zing preserve ownership; edits made outside zing still
// follow the conservative reconciliation rule and relinquish ownership.
export async function updateManagedGroup(windowId: number, groupId: number, changes: { title?: string; color?: chrome.tabGroups.TabGroup['color']; collapsed?: boolean }) {
  await ready;
  return serial(async () => {
    const native = await chrome.tabGroups.get(groupId);
    if (native.windowId !== windowId) throw new Error(t('errorGroup'));
    let owned = state.groups.find(group => group.id === groupId && group.windowId === windowId);
    if (owned && !await validGroup(owned)) owned = undefined;
    const previous = owned ? { title: owned.title, color: owned.color, customTitle: owned.customTitle } : undefined;
    if (owned) {
      if (changes.title !== undefined) { owned.title = changes.title; owned.customTitle = true; }
      if (changes.color !== undefined) owned.color = changes.color;
    }
    try { await chrome.tabGroups.update(groupId, changes); }
    catch (error) { if (owned && previous) Object.assign(owned, previous); throw error; }
    await persist();
  });
}

export async function forgetTuckRecovery(recoveryId: string) {
  await ready;
  return serial(async () => {
    if (!pendingRecovery.some(item => item.id === recoveryId)) throw new Error(t('errorTuckRecoveryChanged'));
    forgetRecord(recoveryId); await persist();
  });
}

function serial<T>(work: () => Promise<T>): Promise<T> {
  const pending = queue.then(work);
  queue = pending.then(() => {}, () => {});
  return pending;
}
function background(work: () => Promise<unknown>) {
  void serial(async () => { await ready; await work(); }).catch(error => console.warn('zing: tab tuck', error));
}
// A failed optional feature must not prevent the command palette from opening.
export async function tabTuckingReady() {
  await ready.catch(() => {});
  if (!pendingRecovery.length) return;
  // Session restoration can update native metadata without delivering a group
  // event. Opening the palette retries unresolved evidence; unchanged reads do
  // not notify, avoiding a snapshot → notification → snapshot loop.
  await serial(async () => {
    const before = JSON.stringify([state.groups, pendingRecovery]);
    await recover();
    if (JSON.stringify([state.groups, pendingRecovery]) !== before) await persist();
  }).catch(error => console.warn('zing: recover tab tuck', error));
}
const plain = (tab: chrome.tabs.Tab) => !tab.pinned && (tab.groupId ?? -1) === -1 &&
  !tab.incognito && (tab.splitViewId === undefined || tab.splitViewId === -1);
export function tuckFlags(tab: chrome.tabs.Tab): { tucked: boolean; canTuck: boolean } {
  return { tucked: state.groups.some(group => group.id === tab.groupId && group.windowId === tab.windowId && group.members.includes(tab.id!)),
    canTuck: plain(tab) };
}
export function canUndoTuck(windowId: number) { return Boolean(state.undo[windowId]?.ids.length); }
function touch(tab: chrome.tabs.Tab, now = Date.now()) {
  if (tab.id !== undefined && !tab.incognito) state.clocks[tab.id] = { url: tab.url || '', usedAt: now };
}
function usedAt(tab: chrome.tabs.Tab, now: number) {
  if (tab.active) return now;
  const clock = state.clocks[tab.id!];
  const recorded = clock?.url === (tab.url || '') ? clock.usedAt : now;
  const accessed = tab.lastAccessed;
  return Math.max(recorded, typeof accessed === 'number' && Number.isFinite(accessed) ? Math.min(accessed, now) : 0);
}
export function idleTabEligible(tab: chrome.tabs.Tab, lastUsed: number, now: number): boolean {
  return tab.id !== undefined && plain(tab) && !tab.active && !tab.highlighted && !tab.audible && tab.status !== 'loading' &&
    Number.isFinite(lastUsed) && lastUsed > 0 && now - lastUsed >= TUCK_AFTER;
}
async function normalTabs() { return chrome.tabs.query({ windowType: 'normal' }); }
function prune(tabs: chrome.tabs.Tab[]) {
  const live = new Map(tabs.map(tab => [tab.id, tab]));
  for (const id of Object.keys(state.clocks)) if (!live.has(Number(id))) delete state.clocks[Number(id)];
  for (const group of state.groups) group.members = group.members.filter(id => {
    const tab = live.get(id);
    return tab && tab.groupId === group.id && tab.windowId === group.windowId && !tab.pinned;
  });
  state.groups = state.groups.filter(group => group.members.length);
  for (const [windowId, batch] of Object.entries(state.undo)) {
    const group = state.groups.find(group => group.id === batch.groupId && group.windowId === Number(windowId));
    batch.ids = batch.ids.filter(id => group?.members.includes(id));
    if (!batch.ids.length) delete state.undo[Number(windowId)];
  }
}
async function persist(tabs?: chrome.tabs.Tab[]) {
  tabs ??= await normalTabs();
  // A closing browser window may be restored later. Preserve its last evidence;
  // normal last-tab removal in a still-open window retires the record.
  for (const group of state.groups) {
    if (tabs.some(tab => tab.windowId === group.windowId) && !tabs.some(tab => tab.groupId === group.id)) forgetRecord(recordKey(group));
  }
  prune(tabs);
  for (const group of state.groups) {
    const members = tabs.filter(tab => tab.groupId === group.id && group.members.includes(tab.id!));
    if (!members.length) continue;
    const record: TuckRecord = { key: recordKey(group), title: group.title, color: group.color, customTitle: group.customTitle, urls: members.map(tab => tab.url || ''),
      context: contextUrls(tabs, group.windowId, group.id) };
    forgetRecord(record.key); records.push(record);
  }
  await recover(tabs);
  if (!state.enabled) state.clocks = {};
  // Only clocks for currently open, ordinary tabs survive browser restarts. URL
  // duplicates share the newest clock, so ambiguity always delays tucking.
  const clocks: Record<string, number> = Object.create(null);
  for (const tab of tabs) {
    if (!state.enabled || tab.incognito || !tab.url) continue;
    const timestamp = usedAt(tab, Date.now());
    clocks[tab.url] = Math.max(clocks[tab.url] || 0, timestamp);
  }
  state.active = Object.fromEntries(activeTabs);
  await chrome.storage.session.set({ [SESSION_KEY]: state });
  await chrome.storage.local.set({ [CLOCK_KEY]: { version: 1, enabled: state.enabled, clocks },
    [RECOVERY_KEY]: { version: 1, records } });
  notify();
}
async function validGroup(group: Group): Promise<chrome.tabs.Tab[] | null> {
  const native = await chrome.tabGroups.get(group.id).catch(() => null);
  const tabs = native ? await chrome.tabs.query({ groupId: group.id }) : [];
  // A renamed/recolored group or one the user added pages to is now theirs.
  if (invalidGroups.has(group.id) || !native || native.windowId !== group.windowId || native.title !== group.title || native.color !== (group.color || 'grey') ||
    tabs.some(tab => !group.members.includes(tab.id!))) {
    // Deliberate edits end ownership. Missing groups from closing windows keep
    // their evidence so Chrome session restore can reconnect them later.
    if (native || (await chrome.tabs.query({ windowId: group.windowId }).catch(() => [])).length) forgetRecord(recordKey(group));
    state.groups = state.groups.filter(item => item !== group);
    delete state.undo[group.windowId];
    return null;
  }
  group.members = group.members.filter(id => tabs.some(tab => tab.id === id && !tab.pinned));
  return tabs;
}
async function label(group: Group, collapse = false) {
  const tabs = await validGroup(group);
  if (!tabs?.length) return;
  if (!group.customTitle) group.title = `${t('tuckGroupTitle')} · ${tabs.length}`;
  await chrome.tabGroups.update(group.id, { title: group.title, ...(collapse && !tabs.some(tab => tab.active) ? { collapsed: true } : {}) });
}
async function releaseTab(tab: chrome.tabs.Tab) {
  const group = state.groups.find(group => group.id === tab.groupId && group.windowId === tab.windowId && group.members.includes(tab.id!));
  if (!group || !(await validGroup(group))) return;
  const live = await chrome.tabs.get(tab.id!).catch(() => null);
  if (!live || live.groupId !== group.id || live.windowId !== group.windowId) return;
  await chrome.tabs.ungroup(live.id!);
  group.members = group.members.filter(id => id !== live.id);
  touch(live);
  // The group stays at the end; a returned page goes just before it. No other
  // ordinary tabs are reordered and no loading/discard operation is involved.
  const remaining = await chrome.tabs.query({ groupId: group.id });
  if (remaining.length) {
    const all = await chrome.tabs.query({ windowId: live.windowId });
    const withoutReturned = all.filter(item => item.id !== live.id).sort((a, b) => a.index - b.index);
    const index = withoutReturned.findIndex(item => item.groupId === group.id);
    await chrome.tabs.move(live.id!, { index: index < 0 ? -1 : index });
    await label(group, true);
  }
}
async function tuckBatch(windowId: number, ids: number[], automatic: boolean) {
  await recover();
  const unresolved = pendingRecovery.length > 0;
  if (unresolved && (!state.groups.some(group => group.windowId === windowId) ||
    pendingRecovery.some(item => item.candidates.some(group => group.windowId === windowId)))) {
    if (automatic) return 0;
    throw new Error(t('errorTuckRecoveryPending'));
  }
  const added: number[] = [];
  let group = state.groups.find(item => item.windowId === windowId);
  if (group && !(await validGroup(group))) group = undefined;
  try {
    for (const id of ids) {
      if (automatic && (!getPreferences().autoTuck || await chrome.idle.queryState(60) === 'active')) break;
      if (group && !(await validGroup(group))) break;
      const tab = await chrome.tabs.get(id).catch(() => null);
      if (!tab || tab.windowId !== windowId || !plain(tab)) continue;
      if (automatic && !idleTabEligible(tab, usedAt(tab, Date.now()), Date.now())) continue;
      if (tab.active) {
        const other = (await chrome.tabs.query({ windowId })).filter(item => item.id !== id && !tuckFlags(item).tucked)
          .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
        if (!other) continue;
        await chrome.tabs.update(other.id!, { active: true });
      }
      const live = await chrome.tabs.get(id);
      if (!plain(live) || live.active || live.windowId !== windowId) continue;
      joiningTabs.add(id);
      let groupId: number;
      try { groupId = await chrome.tabs.group({ tabIds: [id], ...(group ? { groupId: group.id } : { createProperties: { windowId } }) }); }
      finally { joiningTabs.delete(id); }
      if (!group) {
        group = { key: crypto.randomUUID(), id: groupId, windowId, title: '', members: [] };
        state.groups.push(group);
      }
      group.members.push(id); added.push(id);
    }
    if (group && added.length && await validGroup(group)) {
      // Set our expected name before Chrome emits onUpdated for it.
      if (!group.customTitle) group.title = `${t('tuckGroupTitle')} · ${group.members.length}`;
      await chrome.tabGroups.update(group.id, { title: group.title, color: group.color || 'grey' });
      if (!automatic || (getPreferences().autoTuck && await chrome.idle.queryState(60) !== 'active')) {
        await chrome.tabGroups.move(group.id, { index: -1 });
        const live = await chrome.tabs.query({ groupId: group.id });
        if (!live.some(tab => tab.active)) await chrome.tabGroups.update(group.id, { collapsed: true });
      }
    }
  } finally {
    if (group && added.length) state.undo[windowId] = { groupId: group.id, ids: added };
    await persist();
  }
  return added.length;
}
export async function tuckTab(tabId: number, windowId: number) {
  await ready;
  return serial(async () => {
    const window = await chrome.windows.get(windowId);
    if (window.type !== 'normal' || window.incognito) throw new Error(t('errorTuckTab'));
    if (!await tuckBatch(windowId, [tabId], false)) throw new Error(t('errorTuckTab'));
  });
}
export async function undoTuck(windowId: number) {
  await ready;
  return serial(async () => {
    const batch = state.undo[windowId];
    const group = state.groups.find(item => item.id === batch?.groupId && item.windowId === windowId);
    if (!batch || !group || !(await validGroup(group))) { await persist(); throw new Error(t('errorUndoTuck')); }
    let count = 0;
    for (const id of [...batch.ids]) {
      const tab = await chrome.tabs.get(id).catch(() => null);
      if (tab && tab.windowId === windowId && tab.groupId === group.id && group.members.includes(id)) {
        await chrome.tabs.ungroup(id); group.members = group.members.filter(member => member !== id); touch(tab); count++;
      }
    }
    delete state.undo[windowId];
    await label(group, true); await persist();
    if (!count) throw new Error(t('errorUndoTuck'));
  });
}
async function scan() {
  if (!getPreferences().autoTuck || await chrome.idle.queryState(60) === 'active') return;
  const tabs = (await normalTabs()).sort((a, b) => a.index - b.index);
  const now = Date.now();
  const windows = new Map<number, number[]>();
  for (const tab of tabs) if (idleTabEligible(tab, usedAt(tab, now), now)) {
    const ids = windows.get(tab.windowId) || []; ids.push(tab.id!); windows.set(tab.windowId, ids);
  }
  for (const [windowId, ids] of windows) {
    if (!getPreferences().autoTuck || await chrome.idle.queryState(60) === 'active') break;
    await tuckBatch(windowId, ids, true);
  }
}
async function preferencesChanged() {
  const enabled = getPreferences().autoTuck;
  if (enabled !== state.enabled) {
    if (enabled) {
      const tabs = await normalTabs();
      for (const tab of tabs) touch(tab);
      await chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 30 });
    } else {
      // Keep the previous enabled state until release succeeds. If Chrome is
      // temporarily editing/closing a tab, the next alarm retries the remainder.
      let failed = false;
      for (const group of [...state.groups]) {
        const tabs = await validGroup(group);
        for (const tab of tabs || []) {
          const live = await chrome.tabs.get(tab.id!).catch(() => null);
          if (live?.groupId === group.id && live.windowId === group.windowId) {
            try { await chrome.tabs.ungroup(live.id!); touch(live); }
            catch { if (await chrome.tabs.get(live.id!).catch(() => null)) failed = true; }
          }
        }
      }
      if (failed) {
        await chrome.alarms.create(ALARM, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
        await persist(); return;
      }
      await chrome.alarms.clear(ALARM);
      for (const group of state.groups) forgetRecord(recordKey(group));
      state.groups = []; state.undo = {};
    }
    state.enabled = enabled;
  }
  for (const group of [...state.groups]) await label(group);
  await persist();
}

export function startTabTucking(changed: () => void) {
  if (started) return;
  started = true; notify = changed;
  ready = (async () => {
    await preferencesReady;
    const [session, local, tabs] = await Promise.all([
      chrome.storage.session.get(SESSION_KEY), chrome.storage.local.get([CLOCK_KEY, RECOVERY_KEY]), normalTabs(),
    ]);
    records = readTuckRecords(local[RECOVERY_KEY]);
    const saved = session[SESSION_KEY] as State | undefined;
    if (saved?.version === 1 && saved.clocks && Array.isArray(saved.groups) && saved.undo) state = saved;
    else {
      // New Chrome sessions are reconciled against persisted evidence below,
      // never against old numeric group/tab IDs.
      const stored = local[CLOCK_KEY] as { version?: number; enabled?: boolean; clocks?: Record<string, number> } | undefined;
      state.enabled = stored?.enabled === true;
      for (const tab of tabs) {
        const timestamp = stored?.version === 1 ? stored.clocks?.[tab.url || ''] : undefined;
        touch(tab, typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0 ? Math.min(timestamp, Date.now()) : Date.now());
      }
    }
    // Migrate groups from the earlier session-only release with explicit review.
    // Their title is a discovery hint, never evidence for automatic ownership.
    if (!local[RECOVERY_KEY]) {
      for (const group of await nativeGroups(tabs)) {
        if (state.groups.some(owned => owned.id === group.id) || group.color !== 'grey' ||
          !/^(已收起|Tucked Away) · \d+$/.test(group.title)) continue;
        records.push({ key: crypto.randomUUID(), title: group.title, urls: group.tabs.map(tab => tab.url),
          context: group.context, requiresConfirmation: true });
      }
    }
    await recover(tabs);
    prune(tabs);
    for (const [windowId, tabId] of Object.entries(state.active || {})) {
      if (tabs.some(tab => tab.id === tabId && tab.windowId === Number(windowId))) activeTabs.set(Number(windowId), tabId);
    }
    for (const tab of tabs) if (tab.active && tab.id !== undefined && !activeTabs.has(tab.windowId)) activeTabs.set(tab.windowId, tab.id);
    for (const group of [...state.groups]) await validGroup(group);
    await preferencesChanged();
    if (getPreferences().autoTuck && !await chrome.alarms.get(ALARM)) await chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 30 });
  })();
  void ready.catch(error => console.warn('zing: initialize tab tuck', error));
  subscribePreferences(() => background(preferencesChanged));
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === ALARM) background(async () => {
      if (state.enabled && !getPreferences().autoTuck) await preferencesChanged();
      else await scan();
    });
  });
  chrome.idle.onStateChanged.addListener(status => { if (status !== 'active') background(scan); });
  chrome.tabs.onActivated.addListener(({ tabId, windowId }) => background(async () => {
    const previous = activeTabs.get(windowId);
    activeTabs.set(windowId, tabId);
    if (!state.enabled && !state.groups.length && !records.length) return;
    if (previous !== undefined && previous !== tabId) {
      const old = await chrome.tabs.get(previous).catch(() => null);
      if (old?.windowId === windowId) touch(old);
    }
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return;
    touch(tab); await releaseTab(tab); await persist();
  }));
  chrome.tabs.onCreated.addListener(tab => background(async () => {
    if (!state.enabled && !state.groups.length && !records.length) return;
    touch(tab); await recover(); await persist();
  }));
  const reconcile = () => background(async () => {
    if (!state.enabled && !state.groups.length && !records.length) return;
    const tabs = await normalTabs();
    for (const group of [...state.groups]) await label(group);
    await persist(tabs);
  });
  chrome.tabs.onRemoved.addListener(reconcile);
  chrome.tabs.onAttached.addListener(reconcile);
  chrome.tabs.onDetached.addListener(reconcile);
  chrome.tabs.onUpdated.addListener((id, change, tab) => {
    if (change.url) background(async () => {
      if (!state.enabled && !state.groups.length && !records.length) return;
      touch(tab); await persist();
    });
    if (change.groupId !== undefined) {
      const group = state.groups.find(item => item.id === change.groupId);
      if (group && !group.members.includes(id) && !joiningTabs.has(id)) invalidGroups.add(group.id);
    }
    if (change.groupId !== undefined || change.pinned !== undefined) reconcile();
  });
  chrome.tabGroups.onCreated.addListener(reconcile);
  chrome.tabGroups.onRemoved.addListener(reconcile);
  chrome.tabGroups.onUpdated.addListener(group => {
    const owned = state.groups.find(item => item.id === group.id);
    if (!owned && pendingRecovery.length) reconcile();
    if (owned && (group.title !== owned.title || group.color !== (owned.color || 'grey'))) {
      invalidGroups.add(group.id); reconcile();
    }
  });
}
