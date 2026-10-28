import { groupFingerprint, matchRecovery, readTuckRecords, recoveryCandidates, type TuckRecord, type RecoveryGroup } from './tuckRecovery';
import type { TuckRecoveryItem, TuckStatus } from './types';
import { tuckOrderForBatch } from './tuckOrder';
import { getPreferences, isAutoTuckAfterHours, preferencesReady, subscribePreferences } from './preferences';
import { t } from './i18n';

export const TUCK_AFTER = 7 * 24 * 60 * 60 * 1000;
const ALARM = 'justonehop-auto-tuck';
const FOCUS_KEY = 'justonehopTabTuckFocus';
const FOCUS_GRACE = 30 * 60_000;
let unfocusedAt: number | undefined;
let focusRevision = 0;
const SESSION_KEY = 'justonehopTabTuckSession';
const RECOVERY_KEY = 'justonehopTabTuckRecovery';
const CLOCK_KEY = 'justonehopTabTuckClocks';
type Clock = { url: string; usedAt: number };
type Group = { key?: string; id: number; windowId: number; title: string; color?: chrome.tabGroups.TabGroup['color']; customTitle?: boolean; metadataPending?: boolean; members: number[] };
type Batch = { groupId: number; ids: number[] };
type State = { pendingOrder?: Record<number, { id: number; before: number }[]>; order?: Record<number, number[]>; version: 1; enabled: boolean; clocks: Record<number, Clock>; groups: Group[]; undo: Record<number, Batch>; active?: Record<number, number>; lastScanAt?: number; lastFailureAt?: number };
let state: State = { version: 1, enabled: false, clocks: {}, groups: [], undo: {} };
let ready = Promise.resolve();
let queue = Promise.resolve();
let notify = () => {};
let started = false;
const invalidGroups = new Set<number>();
const joiningTabs = new Set<number>();
const movingTabs = new Map<number, number>();
const movingGroups = new Set<number>();
const releasingTabs = new Set<number>();
let membershipRevision = 0;
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
    // an empty one) is custom; unchanged generated names can still follow the locale.
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
// Renames from JustOneHop update the expected name; external renames end ownership.
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
    const changed = (['title', 'color', 'collapsed'] as const).filter(key => changes[key] !== undefined && changes[key] !== native[key]);
    return t(!changed.length ? 'outcomeGroupUnchanged' : changed.length > 1 ? 'outcomeGroupUpdated'
      : changed[0] === 'title' ? 'outcomeGroupRenamed' : changed[0] === 'color' ? 'outcomeGroupRecolored'
        : changes.collapsed ? 'outcomeGroupCollapsed' : 'outcomeGroupExpanded');
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
  void serial(async () => { await ready; await work(); }).catch(error => console.warn('justonehop: tab tuck', error));
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
  }).catch(error => console.warn('justonehop: recover tab tuck', error));
}
const plain = (tab: chrome.tabs.Tab) => !tab.pinned && (tab.groupId ?? -1) === -1 &&
  !tab.incognito && (tab.splitViewId === undefined || tab.splitViewId === -1);
export function tuckFlags(tab: chrome.tabs.Tab): { tucked: boolean; canTuck: boolean } {
  return { tucked: !tab.pinned && state.groups.some(group => group.id === tab.groupId && group.windowId === tab.windowId && !invalidGroups.has(group.id)),
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
export function idleTabEligible(tab: chrome.tabs.Tab, lastUsed: number, now: number, thresholdMs = TUCK_AFTER): boolean {
  return tab.id !== undefined && plain(tab) && !tab.active && !tab.highlighted && !tab.audible && tab.status !== 'loading' &&
    Number.isFinite(lastUsed) && lastUsed > 0 && now - lastUsed >= thresholdMs;
}
const thresholdMs = () => getPreferences().autoTuckAfterHours * 60 * 60 * 1000;
async function waitingReason(): Promise<TuckStatus['waitingReason']> {
  const revision = focusRevision;
  const idle = await chrome.idle.queryState(60);
  if (revision !== focusRevision) return 'active';
  if (idle !== 'active') return 'scheduled';
  const windows = await chrome.windows.getAll({});
  if (revision !== focusRevision || windows.some(window => window.focused)) return 'active';
  return unfocusedAt !== undefined && Date.now() - unfocusedAt >= FOCUS_GRACE ? 'scheduled' : 'grace';
}
async function canAutoTuck() {
  return getPreferences().autoTuck && await waitingReason() === 'scheduled' && getPreferences().autoTuck;
}
async function syncFocus() {
  const revision = focusRevision;
  const windows = await chrome.windows.getAll({});
  if (revision !== focusRevision) return;
  if (windows.some(window => window.focused)) unfocusedAt = undefined;
  else unfocusedAt ??= Date.now();
  await chrome.storage.session.set({ [FOCUS_KEY]: { unfocusedAt } });
}
function recoveryBlocks(windowId: number) {
  return pendingRecovery.length > 0 && (!state.groups.some(group => group.windowId === windowId) ||
    pendingRecovery.some(item => item.candidates.some(group => group.windowId === windowId)));
}
export async function getTuckStatus(afterHours?: number): Promise<TuckStatus> {
  if (afterHours !== undefined && !isAutoTuckAfterHours(afterHours)) throw new Error('Invalid automatic tuck duration');
  await ready;
  return serial(async () => {
    // A settings read can arrive before the storage listener's queued transition.
    if (state.enabled !== getPreferences().autoTuck) await preferencesChanged();
    const tabs = await normalTabs();
    await recover(tabs);
    const checkedAt = Date.now();
    const threshold = afterHours === undefined ? thresholdMs() : afterHours * 60 * 60 * 1000;
    let eligibleCount = 0;
    let blockedCount = 0;
    let notDueCount = 0;
    let protectedCount = 0;
    for (const tab of tabs) {
      if (tab.incognito || tuckFlags(tab).tucked) continue;
      if (!plain(tab) || tab.active || tab.highlighted || tab.audible || tab.status === 'loading') protectedCount++;
      else if (!idleTabEligible(tab, usedAt(tab, checkedAt), checkedAt, threshold)) notDueCount++;
      else if (recoveryBlocks(tab.windowId)) blockedCount++;
      else eligibleCount++;
    }
    return { enabled: getPreferences().autoTuck, eligibleCount, blockedCount, notDueCount, protectedCount,
      waitingReason: await waitingReason(), checkedAt,
      ...(!getPreferences().autoTuck && state.enabled ? { pendingReleaseCount: tabs.filter(tab => tuckFlags(tab).tucked).length } : {}),
      ...(state.lastScanAt === undefined ? {} : { lastScanAt: state.lastScanAt }),
      ...(state.lastFailureAt === undefined ? {} : { lastFailureAt: state.lastFailureAt }) };
  });
}
async function normalTabs() { return chrome.tabs.query({ windowType: 'normal' }); }
function prune(tabs: chrome.tabs.Tab[]) {
  const live = new Map(tabs.map(tab => [tab.id, tab]));
  for (const id of Object.keys(state.clocks)) if (!live.has(Number(id))) delete state.clocks[Number(id)];
  for (const group of state.groups) group.members = tabs
    .filter(tab => tab.groupId === group.id && tab.windowId === group.windowId && !tab.pinned).map(tab => tab.id!);
  state.groups = state.groups.filter(group => group.members.length);
  for (const [windowId, order] of Object.entries(state.order || {})) {
    if (!state.groups.some(group => group.windowId === Number(windowId))) delete state.order![Number(windowId)];
    else state.order![Number(windowId)] = order.filter(id => live.get(id)?.windowId === Number(windowId));
  }
  for (const windowId of Object.keys(state.pendingOrder || {})) {
    if (!state.groups.some(group => group.windowId === Number(windowId))) delete state.pendingOrder![Number(windowId)];
  }
  for (const [windowId, batch] of Object.entries(state.undo)) {
    const group = state.groups.find(group => group.id === batch.groupId && group.windowId === Number(windowId));
    const members = new Set(group?.members);
    batch.ids = batch.ids.filter(id => members.has(id));
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
    const memberIds = new Set(group.members);
    const members = tabs.filter(tab => tab.groupId === group.id && memberIds.has(tab.id!));
    if (!members.length) continue;
    if (group.metadataPending) continue;
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
  await chrome.storage.local.set({ [CLOCK_KEY]: { version: 1, enabled: state.enabled, clocks, lastScanAt: state.lastScanAt },
    [RECOVERY_KEY]: { version: 1, records } });
  notify();
}
function groupMetadataMatches(group: Group, native: chrome.tabGroups.TabGroup | null) {
  return !invalidGroups.has(group.id) && native && native.windowId === group.windowId &&
    (native.title || '') === group.title;
}
async function validGroup(group: Group): Promise<chrome.tabs.Tab[] | null> {
  const native = await chrome.tabGroups.get(group.id).catch(error => {
    if (group.metadataPending) throw error;
    return null;
  });
  const tabs = native ? await chrome.tabs.query({ groupId: group.id }) : [];
  if (group.metadataPending && native && !invalidGroups.has(group.id)) {
    group.title = native.title || ''; group.color = native.color;
    delete group.metadataPending;
  }
  // Only an external rename or window change ends ownership of an existing group.
  if (!groupMetadataMatches(group, native)) {
    // Deliberate edits end ownership. Missing groups from closing windows keep
    // their evidence so Chrome session restore can reconnect them later.
    if (native || (await chrome.tabs.query({ windowId: group.windowId }).catch(() => [])).length) forgetRecord(recordKey(group));
    state.groups = state.groups.filter(item => item !== group);
    delete state.undo[group.windowId];
    return null;
  }
  group.color = native!.color;
  const members = tabs.filter(tab => !tab.pinned && tab.windowId === group.windowId);
  group.members = members.map(tab => tab.id!);
  return members;
}
function groupCheck(group: Group) {
  let revision = membershipRevision;
  let remaining = 0;
  return async () => {
    const native = await chrome.tabGroups.get(group.id).catch(() => null);
    if (!groupMetadataMatches(group, native) || revision !== membershipRevision || remaining-- <= 0) {
      revision = membershipRevision;
      if (!await validGroup(group)) return false;
      remaining = 32;
    }
    return true;
  };
}
async function moveTab(id: number, index: number) {
  movingTabs.set(id, index);
  try { await chrome.tabs.move(id, { index }); }
  catch (error) { movingTabs.delete(id); throw error; }
}
async function finishOrder(group: Group, automatic: boolean, check = groupCheck(group)) {
  const pending = state.pendingOrder?.[group.windowId];
  if (!pending?.length) return;
  while (pending.length) {
    if (automatic && !await canAutoTuck()) return;
    if (!await check()) { pending.length = 0; return; }
    const revision = focusRevision;
    const membersRevision = membershipRevision;
    const { id } = pending[0];
    const order = state.order?.[group.windowId] || [];
    const rank = order.indexOf(id);
    const successor = order.slice(rank + 1).find(candidate => group.members.includes(candidate));
    const neighbour = successor ?? order.slice(0, rank).reverse().find(candidate => group.members.includes(candidate));
    const [tab, target] = await Promise.all([
      chrome.tabs.get(id).catch(() => null), neighbour === undefined ? null : chrome.tabs.get(neighbour).catch(() => null),
    ]);
    if (automatic && (!getPreferences().autoTuck || revision !== focusRevision)) return;
    if (invalidGroups.has(group.id) || membersRevision !== membershipRevision || state.pendingOrder?.[group.windowId] !== pending) return;
    if (!tab || !target || tab.groupId !== group.id || target.groupId !== group.id ||
      tab.windowId !== group.windowId || target.windowId !== group.windowId || tab.pinned) {
      pending.shift(); continue;
    }
    if (tab.active) return;
    const index = target.index - (tab.index < target.index ? 1 : 0) + (successor === undefined ? 1 : 0);
    if (tab.index !== index) await moveTab(id, index);
    pending.shift();
  }
}
async function ungroupTab(id: number) {
  releasingTabs.add(id);
  try { await chrome.tabs.ungroup(id); }
  finally { releasingTabs.delete(id); }
}
async function updateGroupLabel(group: Group, changes: chrome.tabGroups.UpdateProperties) {
  const previous = { title: group.title, color: group.color };
  if (changes.title !== undefined) group.title = changes.title;
  if (changes.color !== undefined) group.color = changes.color;
  // Native events must see the expected metadata, but a rejected update must
  // not make our next ownership check mistake the old label for a user edit.
  try { await chrome.tabGroups.update(group.id, changes); }
  catch (error) { Object.assign(group, previous); throw error; }
}
async function label(group: Group, collapse = false) {
  const tabs = await validGroup(group);
  if (!tabs?.length) return;
  await updateGroupLabel(group, { title: group.customTitle ? group.title : t('tuckGroupTitle'),
    ...(collapse && !tabs.some(tab => tab.active) ? { collapsed: true } : {}) });
}
async function releaseTab(tab: chrome.tabs.Tab) {
  const group = state.groups.find(group => group.id === tab.groupId && group.windowId === tab.windowId);
  if (!group || !(await validGroup(group))) return;
  const live = await chrome.tabs.get(tab.id!).catch(() => null);
  if (!live || live.pinned || live.groupId !== group.id || live.windowId !== group.windowId) return;
  if (invalidGroups.has(group.id)) { await validGroup(group); return; }
  await ungroupTab(live.id!);
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
  if (recoveryBlocks(windowId)) {
    if (automatic) return 0;
    throw new Error(t('errorTuckRecoveryPending'));
  }
  const added: number[] = [];
  let created = false;
  let group = state.groups.find(item => item.windowId === windowId);
  let checkedRevision = membershipRevision;
  if (group && !(await validGroup(group))) group = undefined;
  if (group) {
    await finishOrder(group, automatic);
    if (state.pendingOrder?.[windowId]?.length) { await persist(); return 0; }
  }
  const strip = (await chrome.tabs.query({ windowId })).sort((a, b) => a.index - b.index);
  const existing = strip.filter(tab => tab.groupId === group?.id).map(tab => tab.id!);
  const order = tuckOrderForBatch(group ? state.order?.[windowId] : undefined, strip.map(tab => tab.id!), existing);
  (state.order ??= {})[windowId] = order;
  const ranks = new Map(order.map((id, index) => [id, index]));
  let membershipChecksLeft = 0;
  async function batchGroupValid() {
    if (!group) return true;
    // Metadata remains a live per-tab read. Membership is reused only within
    // this batch, with event invalidation and periodic full checks as a backstop.
    const native = await chrome.tabGroups.get(group.id).catch(() => null);
    if (!groupMetadataMatches(group, native) || checkedRevision !== membershipRevision || membershipChecksLeft-- <= 0) {
      checkedRevision = membershipRevision;
      if (!await validGroup(group)) return false;
      membershipChecksLeft = 32;
    }
    return true;
  }
  try {
    for (const id of ids) {
      if (automatic && !await canAutoTuck()) break;
      if (!await batchGroupValid()) break;
      const tab = await chrome.tabs.get(id).catch(() => null);
      if (!tab || tab.windowId !== windowId || !plain(tab)) continue;
      if (automatic && !idleTabEligible(tab, usedAt(tab, Date.now()), Date.now(), thresholdMs())) continue;
      if (tab.active) {
        const other = (await chrome.tabs.query({ windowId })).filter(item => item.id !== id && !tuckFlags(item).tucked)
          .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
        if (!other) continue;
        await chrome.tabs.update(other.id!, { active: true });
      }
      if (automatic && !await canAutoTuck()) break;
      if (group && (invalidGroups.has(group.id) || checkedRevision !== membershipRevision) && !await batchGroupValid()) break;
      const revision = focusRevision;
      const live = await chrome.tabs.get(id);
      if (automatic && (!getPreferences().autoTuck || revision !== focusRevision)) break;
      if (!plain(live) || live.active || live.windowId !== windowId) continue;
      // The candidate may have started playing, loading, or been used while
      // native checks were pending. Recheck all protections on the final read.
      if (automatic && !idleTabEligible(live, usedAt(live, Date.now()), Date.now(), thresholdMs())) continue;
      if (state.order?.[windowId] !== order) break;
      if (group && (invalidGroups.has(group.id) || checkedRevision !== membershipRevision)) break;
      joiningTabs.add(id);
      let groupId: number;
      try { groupId = await chrome.tabs.group({ tabIds: [id], ...(group ? { groupId: group.id } : { createProperties: { windowId } }) }); }
      finally { joiningTabs.delete(id); }
      if (!group) {
        // Chrome may omit an unnamed group's title and choose its initial color.
        // Validate against the group we just created, not assumed defaults.
        group = { key: crypto.randomUUID(), id: groupId, windowId, title: '', metadataPending: true, members: [id] };
        created = true;
        state.groups.push(group); added.push(id);
        const native = await chrome.tabGroups.get(groupId);
        group.title = native.title || ''; group.color = native.color;
        delete group.metadataPending;
      } else { group.members.push(id); added.push(id); }
      if (state.order?.[windowId] !== order) break;
      const rank = ranks.get(id);
      const successor = rank === undefined ? undefined : existing.find(member => (ranks.get(member) ?? -1) > rank);
      if (existing.length) {
        ((state.pendingOrder ??= {})[windowId] ??= []).push({ id, before: successor ?? -1 });
        await finishOrder(group, automatic, batchGroupValid);
        if (state.pendingOrder[windowId]?.length || state.order?.[windowId] !== order) break;
      }
      if (successor !== undefined) existing.splice(existing.indexOf(successor), 0, id);
      else existing.push(id);
    }
    if (group && added.length && await validGroup(group)) {
      await updateGroupLabel(group, { title: group.customTitle ? group.title : t('tuckGroupTitle'),
        color: created ? 'grey' : group.color || 'grey' });
      if (!automatic || await canAutoTuck()) {
        movingGroups.add(group.id);
        try { await chrome.tabGroups.move(group.id, { index: -1 }); }
        finally { movingGroups.delete(group.id); }
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
    const requested = batch.ids.length;
    const check = groupCheck(group);
    try {
      for (const id of [...batch.ids]) {
        if (!await check()) break;
        const tab = await chrome.tabs.get(id).catch(() => null);
        if (invalidGroups.has(group.id)) { await validGroup(group); break; }
        if (tab && tab.windowId === windowId && tab.groupId === group.id && group.members.includes(id)) {
          await ungroupTab(id); group.members = group.members.filter(member => member !== id); touch(tab); count++;
        }
      }
      delete state.undo[windowId];
      await label(group, true); await persist();
    } catch (error) {
      throw count ? new Error(t('errorUndoTuckPartialCount', [String(count), String(requested - count)])) : error;
    }
    if (!count) throw new Error(t('errorUndoTuck'));
    return requested > count ? t('outcomeUndoTuckSkipped', [String(count), String(requested - count)])
      : t('outcomeUndoTuckCount', String(count));
  });
}
async function scan() {
  if (state.enabled !== getPreferences().autoTuck) await preferencesChanged();
  if (!await canAutoTuck()) return;
  const tabs = (await normalTabs()).sort((a, b) => a.index - b.index);
  const now = Date.now();
  const windows = new Map<number, number[]>();
  for (const group of state.groups) if (state.pendingOrder?.[group.windowId]?.length) windows.set(group.windowId, []);
  for (const tab of tabs) if (idleTabEligible(tab, usedAt(tab, now), now, thresholdMs())) {
    const ids = windows.get(tab.windowId) || []; ids.push(tab.id!); windows.set(tab.windowId, ids);
  }
  for (const [windowId, ids] of windows) {
    if (!await canAutoTuck()) return;
    await tuckBatch(windowId, ids, true);
  }
  if (!await canAutoTuck()) return;
  state.lastScanAt = Date.now();
  delete state.lastFailureAt;
  await persist();
}
async function runScan() {
  const lastScanAt = state.lastScanAt;
  try { await scan(); }
  catch (error) {
    state.lastScanAt = lastScanAt;
    state.lastFailureAt = Date.now();
    // Preserve the failure independently of a failed tab query or partial batch.
    await chrome.storage.session.set({ [SESSION_KEY]: state }).catch(() => {});
    notify();
    throw error;
  }
}
async function ensureAlarm() {
  const alarm = await chrome.alarms.get(ALARM);
  if (alarm?.periodInMinutes !== 5) await chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 5 });
}
async function preferencesChanged() {
  const enabled = getPreferences().autoTuck;
  if (enabled !== state.enabled) {
    delete state.lastScanAt;
    delete state.lastFailureAt;
    if (enabled) {
      const tabs = await normalTabs();
      for (const tab of tabs) touch(tab);
      await ensureAlarm();
      await syncFocus();
    } else {
      // Keep the previous enabled state until release succeeds. If Chrome is
      // temporarily editing/closing a tab, the next alarm retries the remainder.
      let failed = false;
      for (const group of [...state.groups]) {
        const tabs = await validGroup(group);
        const check = groupCheck(group);
        for (const tab of tabs || []) {
          if (!await check()) break;
          const live = await chrome.tabs.get(tab.id!).catch(() => null);
          if (invalidGroups.has(group.id)) { await validGroup(group); break; }
          if (live?.groupId === group.id && live.windowId === group.windowId) {
            try { await ungroupTab(live.id!); touch(live); }
            catch { if (await chrome.tabs.get(live.id!).catch(() => null)) failed = true; }
          }
        }
        // Members added while releasing remain managed and are retried, rather
        // than silently abandoned when the preference transition completes.
        if (state.groups.includes(group) && (await validGroup(group))?.length) failed = true;
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
      chrome.storage.session.get([SESSION_KEY, FOCUS_KEY]), chrome.storage.local.get([CLOCK_KEY, RECOVERY_KEY]), normalTabs(),
    ]);
    const savedFocus = (session[FOCUS_KEY] as { unfocusedAt?: number } | undefined)?.unfocusedAt;
    if (focusRevision === 0 && typeof savedFocus === 'number' && Number.isFinite(savedFocus) && savedFocus > 0 && savedFocus <= Date.now()) unfocusedAt = savedFocus;
    records = readTuckRecords(local[RECOVERY_KEY]);
    const saved = session[SESSION_KEY] as State | undefined;
    const stored = local[CLOCK_KEY] as { version?: number; enabled?: boolean; clocks?: Record<string, number>; lastScanAt?: number } | undefined;
    if (saved?.version === 1 && saved.clocks && Array.isArray(saved.groups) && saved.undo) state = saved;
    else {
      // New Chrome sessions are reconciled against persisted evidence below,
      // never against old numeric group/tab IDs.
      state.enabled = stored?.enabled === true;
      for (const tab of tabs) {
        const timestamp = stored?.version === 1 ? stored.clocks?.[tab.url || ''] : undefined;
        touch(tab, typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0 ? Math.min(timestamp, Date.now()) : Date.now());
      }
    }
    const lastScanAt = state.lastScanAt ?? (stored?.version === 1 ? stored.lastScanAt : undefined);
    state.lastScanAt = state.enabled && typeof lastScanAt === 'number' && Number.isFinite(lastScanAt) && lastScanAt > 0
      ? lastScanAt : undefined;
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
    if (getPreferences().autoTuck) await ensureAlarm();
    await syncFocus();
  })();
  void ready.catch(error => console.warn('justonehop: initialize tab tuck', error));
  subscribePreferences(() => background(preferencesChanged));
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === ALARM) background(async () => {
      if (state.enabled && !getPreferences().autoTuck) await preferencesChanged();
      else await runScan();
    });
  });
  chrome.idle.onStateChanged.addListener(status => {
    focusRevision++;
    if (status !== 'active') background(runScan);
  });
  chrome.windows.onFocusChanged.addListener(windowId => {
    // Invalidate immediately, even while a batch is awaiting a Chrome API call.
    focusRevision++;
    unfocusedAt = windowId === chrome.windows.WINDOW_ID_NONE ? Date.now() : undefined;
    background(syncFocus);
  });
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
  let reconcileQueued = false;
  const reconcile = () => {
    // A batch emits one event per tab. Reconcile their final state once when the
    // serial queue reaches it; events during that read still schedule a follow-up.
    // Ownership invalidation below stays synchronous, even while work is queued.
    if (reconcileQueued) return;
    reconcileQueued = true;
    background(async () => {
      reconcileQueued = false;
      if (!state.enabled && !state.groups.length && !records.length) return;
      const tabs = await normalTabs();
      for (const group of [...state.groups]) await label(group);
      await persist(tabs);
    });
  };
  chrome.tabs.onMoved.addListener((id, info) => {
    const group = state.groups.find(group => group.windowId === info.windowId && group.members.includes(id));
    const expectedIndex = movingTabs.get(id);
    movingTabs.delete(id);
    if (!group || joiningTabs.has(id) || expectedIndex === info.toIndex || releasingTabs.has(id) || movingGroups.has(group.id)) return;
    // Invalidate at the move event, before a later removal can hide the user's
    // reorder from a comparison of the surviving members.
    membershipRevision++;
    delete state.order?.[info.windowId];
    delete state.pendingOrder?.[info.windowId];
    // Start the native snapshot now, before queued activation/return work can
    // move a member out and erase the order the user just chose.
    const snapshot = chrome.tabs.query({ windowId: info.windowId });
    background(async () => {
      const tabs = await snapshot;
      (state.order ??= {})[info.windowId] = tabs.sort((a, b) => a.index - b.index).map(tab => tab.id!);
      await persist();
    });
    reconcile();
  });
  const membershipChanged = () => { membershipRevision++; reconcile(); };
  chrome.tabs.onRemoved.addListener(membershipChanged);
  chrome.tabs.onAttached.addListener(membershipChanged);
  chrome.tabs.onDetached.addListener(membershipChanged);
  chrome.tabs.onUpdated.addListener((id, change, tab) => {
    if (change.url) background(async () => {
      if (!state.enabled && !state.groups.length && !records.length) return;
      touch(tab); await persist();
    });
    if (change.groupId !== undefined) {
      const group = state.groups.find(item => item.id === change.groupId);
      const expectedJoin = joiningTabs.has(id) || releasingTabs.has(id) || group?.members.includes(id);
      if (!expectedJoin) {
        membershipRevision++;
      }
    }
    if (change.pinned !== undefined) membershipRevision++;
    if (change.groupId !== undefined || change.pinned !== undefined) reconcile();
  });
  chrome.tabGroups.onCreated.addListener(reconcile);
  chrome.tabGroups.onRemoved.addListener(membershipChanged);
  chrome.tabGroups.onUpdated.addListener(group => {
    const owned = state.groups.find(item => item.id === group.id);
    if (!owned && pendingRecovery.length) reconcile();
    if (owned) {
      if ((group.title || '') !== owned.title || group.windowId !== owned.windowId) invalidGroups.add(group.id);
      if (invalidGroups.has(group.id) || group.color !== owned.color) reconcile();
    }
  });
}
