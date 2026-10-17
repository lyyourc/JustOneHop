import { t } from './i18n';
import { nativePanelBounds } from './panelGeometry';
import { perform, toTab } from './browser';
import { closeTargets } from './model';
import type { Execution, PaletteState } from './types';

const KEY = 'zingPaletteWindow';
interface Session { token: string; sourceTabId: number; sourceWindowId: number; popupWindowId?: number; state?: PaletteState }
interface ContinuationTicket { sender: chrome.runtime.MessageSender; cancelled: boolean }
const tickets = new Set<ContinuationTicket>();
interface Handoff {
  sourceTabId: number; sourceWindowId: number; current?: Session; state: PaletteState; ticket?: ContinuationTicket;
  cancelled: boolean; done: Promise<void>; release: () => void;
}

export function registerPaletteContinuation(sender: chrome.runtime.MessageSender) {
  const ticket: ContinuationTicket = { sender, cancelled: false };
  tickets.add(ticket);
  return ticket;
}
export function releasePaletteContinuation(ticket: ContinuationTicket | undefined) {
  if (ticket) tickets.delete(ticket);
}
function sameSender(a: chrome.runtime.MessageSender, b: chrome.runtime.MessageSender) {
  return a.id === b.id && a.tab?.id === b.tab?.id && a.tab?.windowId === b.tab?.windowId &&
    a.documentId === b.documentId && a.frameId === b.frameId && a.url === b.url;
}
export async function cancelPaletteContinuation(sender: chrome.runtime.MessageSender) {
  await ready;
  if (isPaletteSender(sender) && (!session || !sender.tab ||
      new URLSearchParams(new URL(sender.url!).hash.slice(1)).get('window') !== session.token ||
      (session.popupWindowId !== undefined && sender.tab.windowId !== session.popupWindowId))) return;
  for (const ticket of tickets) {
    if (!sameSender(ticket.sender, sender)) continue;
    ticket.cancelled = true;
    if (pending?.ticket === ticket) {
      pending.cancelled = true;
      if (session?.sourceWindowId === pending.sourceWindowId) await close();
    }
  }
}
let session: Session | undefined;
let pending: Handoff | undefined;
let opening = false;
const ready = chrome.storage.session.get(KEY).then(value => { session = value[KEY] as Session | undefined; }).catch(() => {});
const urlFor = (token: string) => chrome.runtime.getURL(`popup.html#window=${token}`);
const isPaletteSender = (sender: chrome.runtime.MessageSender) => sender.url?.startsWith(chrome.runtime.getURL('popup.html#window='));

export function isNativePage(tab: chrome.tabs.Tab) {
  return /^(chrome|chrome-search|chrome-untrusted|devtools):/.test(tab.pendingUrl || tab.url || '');
}
async function close() {
  const old = session;
  session = undefined;
  await chrome.storage.session.remove(KEY).catch(() => {});
  if (old?.popupWindowId !== undefined) await chrome.windows.remove(old.popupWindowId).catch(() => {});
}

async function focusBelongsTo(ownerId: number, popupId?: number) {
  const focused = await chrome.windows.getLastFocused();
  return focused.focused && (focused.id === ownerId || (popupId !== undefined && focused.id === popupId));
}

async function open(source: chrome.tabs.Tab, state?: PaletteState, ticket?: ContinuationTicket) {
  if (source.id === undefined || opening) return;
  opening = true;
  try {
    const [owner, zoom] = await Promise.all([chrome.windows.get(source.windowId), chrome.tabs.getZoom(source.id)]);
    if (owner.type !== 'normal' || !await focusBelongsTo(source.windowId) || ticket?.cancelled) return;
    const bounds = nativePanelBounds(owner, source, undefined, zoom);
    const current: Session = { token: crypto.randomUUID(), sourceTabId: source.id, sourceWindowId: source.windowId, state };
    session = current;
    await chrome.storage.session.set({ [KEY]: current });
    if (ticket?.cancelled) { if (session === current) await close(); return; }
    const popup = await chrome.windows.create({ url: `${urlFor(current.token)}&tab=${source.id}&owner=${source.windowId}`, type: 'popup', focused: false, ...bounds });
    if (popup?.id === undefined) throw new Error(t('errorWindow'));
    if (session !== current || ticket?.cancelled) { await chrome.windows.remove(popup.id); if (session === current) await close(); return; }
    current.popupWindowId = popup.id;
    await chrome.storage.session.set({ [KEY]: current });
    const [liveOwner, liveTab] = await Promise.all([chrome.windows.get(source.windowId), chrome.tabs.get(source.id)]);
    // Chrome can focus its new popup before create() resolves even when asked
    // for focused:false. Accept either side of our handoff, never another window.
    if (liveOwner.type !== 'normal' || !liveTab.active || liveTab.windowId !== source.windowId ||
        !await focusBelongsTo(source.windowId, popup.id) || ticket?.cancelled) { await close(); return; }
    await chrome.windows.update(popup.id, { focused: true });
  } catch (error) { await close(); throw error; }
  finally { opening = false; }
}

export async function togglePaletteWindow(source: chrome.tabs.Tab) {
  await ready;
  if (opening || pending) return;
  if (session) { await close(); return; }
  await open(source);
}

/** Resolve context from our session, never from the popup's newly active tab. */
export async function paletteSender(sender: chrome.runtime.MessageSender): Promise<chrome.runtime.MessageSender> {
  if (!isPaletteSender(sender)) return sender;
  await ready;
  while (pending) await pending.done;
  const current = session;
  if (!current || new URLSearchParams(new URL(sender.url!).hash.slice(1)).get('window') !== current.token || !sender.tab ||
      (current.popupWindowId !== undefined && sender.tab.windowId !== current.popupWindowId)) throw new Error(t('errorWindow'));
  let source: chrome.tabs.Tab;
  try { source = await chrome.tabs.get(current.sourceTabId); }
  catch (error) { if (pending) return paletteSender(sender); throw error; }
  if (pending) return paletteSender(sender);
  if (session !== current || source.windowId !== current.sourceWindowId || !source.active) throw new Error(t('errorMovedTab'));
  return { ...sender, tab: source, frameId: 0, url: chrome.runtime.getURL('popup.html') };
}

export async function getPaletteWindowState(sender: chrome.runtime.MessageSender): Promise<PaletteState | undefined> {
  if (!isPaletteSender(sender)) return undefined;
  await paletteSender(sender);
  const current = session;
  const state = current?.state;
  if (current && state) {
    delete current.state;
    await chrome.storage.session.set({ [KEY]: current });
  }
  return state;
}

async function prepareHandoff(payload: Execution, sender: chrome.runtime.MessageSender, ticket?: ContinuationTicket): Promise<Handoff | undefined> {
  if (!payload.paletteState || !['close', 'closeOthers', 'closeRight'].includes(payload.action)) return;
  await ready;
  while (pending) await pending.done;
  // An action popup has no sender.tab. Resolve its actual current window rather
  // than trusting the requested target window to identify the source.
  const source = sender.tab?.id !== undefined ? await chrome.tabs.get(sender.tab.id)
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!source?.id || !source.active || source.windowId !== payload.windowId ||
      (sender.tab && source.windowId !== sender.tab.windowId)) throw new Error(t('errorMovedTab'));
  if (!Number.isInteger(payload.windowId)) throw new Error(t('errorWindow'));
  await chrome.windows.get(payload.windowId);
  if (!Number.isInteger(payload.tabId)) throw new Error(t('errorNoTab'));
  const target = await chrome.tabs.get(payload.tabId!);
  if (target.windowId !== payload.windowId) throw new Error(t('errorMovedTab'));
  if (payload.groupId !== undefined && target.groupId !== payload.groupId) throw new Error(t('errorGroup'));
  const removed = payload.action === 'close' ? [target.id]
    : closeTargets((await chrome.tabs.query({ windowId: payload.windowId })).map(toTab), toTab(target), payload.action as 'closeOthers' | 'closeRight').map(tab => tab.id);
  if (!removed.includes(source.id)) return;
  const current = session?.sourceTabId === source.id && session.sourceWindowId === source.windowId ? session : undefined;
  let release!: () => void;
  const done = new Promise<void>(resolve => { release = resolve; });
  const state: PaletteState = { ...payload.paletteState, selection: null,
    ...(payload.paletteState.group ? { group: { ...payload.paletteState.group, selection: null } } : {}) };
  return pending = { sourceTabId: source.id, sourceWindowId: source.windowId, current, state, ticket, cancelled: ticket?.cancelled ?? false, done, release };
}

async function finishHandoff(handoff: Handoff, succeeded: boolean) {
  try {
    const source = await chrome.tabs.get(handoff.sourceTabId).catch(() => undefined);
    if (source) return;
    if (!succeeded || handoff.cancelled || handoff.ticket?.cancelled || (handoff.current && session !== handoff.current)) {
      if (session === handoff.current) await close();
      return;
    }
    const owner = await chrome.windows.get(handoff.sourceWindowId).catch(() => undefined);
    const [next] = owner ? await chrome.tabs.query({ active: true, windowId: handoff.sourceWindowId }) : [];
    if (!next?.id || owner?.type !== 'normal' || !await focusBelongsTo(handoff.sourceWindowId, handoff.current?.popupWindowId) || handoff.ticket?.cancelled) {
      if (session === handoff.current) await close();
      return;
    }
    if (handoff.current) {
      handoff.current.sourceTabId = next.id;
      // The mounted App already owns its live state. Only a newly created host
      // consumes a bootstrap state; saving one here would resurrect it on reload.
      delete handoff.current.state;
      await chrome.storage.session.set({ [KEY]: handoff.current });
    } else if (!session) {
      await open(next, handoff.state, handoff.ticket);
    }
  } catch {
    // Continuation is secondary to the completed browser action. A failed
    // popup/storage operation must not turn a successful close into a retry.
    if (session === handoff.current || !handoff.current) await close();
  } finally {
    if (pending === handoff) pending = undefined;
    handoff.release();
  }
}

/** Keep the worker's usage-write promise alive, but acknowledge after the host
 * handoff alone. Both failure and success release native snapshot requests. */
export async function performWithPaletteContinuation(payload: Execution, sender: chrome.runtime.MessageSender, onPerformed: () => void, ticket?: ContinuationTicket) {
  const handoff = await prepareHandoff(payload, sender, ticket);
  let continuation: Promise<void> | undefined;
  try {
    await perform(payload, () => {
      if (handoff) continuation = finishHandoff(handoff, true).then(onPerformed);
      else onPerformed();
    });
  } catch (error) {
    if (handoff && !continuation) await finishHandoff(handoff, false);
    throw error;
  }
  await continuation;
}

export async function closePaletteWindowForShortcut(tab: chrome.tabs.Tab) {
  await ready;
  if (opening) return true;
  if (pending) pending.cancelled = true;
  if (session && (session.popupWindowId === undefined || !await chrome.windows.get(session.popupWindowId).catch(() => null))) { await close(); return false; }
  if (session && (tab.windowId === session.popupWindowId || tab.windowId === session.sourceWindowId)) {
    await close(); return true;
  }
  return false;
}
chrome.windows.onFocusChanged.addListener(id => {
  void ready.then(async () => {
    if (pending && !opening && id !== chrome.windows.WINDOW_ID_NONE &&
        id !== pending.sourceWindowId && id !== pending.current?.popupWindowId) pending.cancelled = true;
    if (!opening && session?.popupWindowId !== undefined && id !== session.popupWindowId) {
      if (pending?.current === session && !pending.cancelled) return;
      const current = session;
      const popup = await chrome.windows.get(current.popupWindowId!).catch(() => null);
      // Focus events may arrive after the opening handoff. Check live state
      // before treating an older event as a reason to dismiss the new window.
      if (session === current && !popup?.focused) await close();
    }
  }).catch(() => {});
});
chrome.windows.onRemoved.addListener(id => {
  void ready.then(async () => {
    if (pending && [pending.sourceWindowId, pending.current?.popupWindowId].includes(id)) pending.cancelled = true;
    if (session && [session.popupWindowId, session.sourceWindowId].includes(id)) await close();
  }).catch(() => {});
});
chrome.tabs.onRemoved.addListener(id => {
  void ready.then(async () => {
    if (id === session?.sourceTabId && !(pending?.current === session && pending.sourceTabId === id)) await close();
  }).catch(() => {});
});
