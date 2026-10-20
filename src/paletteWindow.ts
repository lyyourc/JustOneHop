import { t } from './i18n';
import { nativePanelBounds } from './panelGeometry';
import { perform } from './browser';
import type { Execution, ExecutionOutcome, PaletteState } from './types';

const KEY = 'justonehopPaletteWindow';
interface Session { token: string; sourceTabId: number; sourceWindowId: number; popupWindowId?: number }

// Older clients may still send this request; source closure never continues.
export async function cancelPaletteContinuation(_sender: chrome.runtime.MessageSender) {}
let session: Session | undefined;
let opening = false;
let awayFromChrome = false;
const ready = chrome.storage.session.get(KEY).then(value => { session = value[KEY] as Session | undefined; }).catch(() => {});
const urlFor = (token: string) => chrome.runtime.getURL(`popup.html#window=${token}`);
const isPaletteSender = (sender: chrome.runtime.MessageSender) => sender.url?.startsWith(chrome.runtime.getURL('popup.html#window='));

export function isNativePage(tab: chrome.tabs.Tab) {
  return /^(chrome|chrome-search|chrome-untrusted|devtools):/.test(tab.pendingUrl || tab.url || '');
}
async function close() {
  const old = session;
  session = undefined;
  awayFromChrome = false;
  await chrome.storage.session.remove(KEY).catch(() => {});
  if (old?.popupWindowId !== undefined) await chrome.windows.remove(old.popupWindowId).catch(() => {});
}

async function focusBelongsTo(ownerId: number, popupId?: number) {
  const focused = await chrome.windows.getLastFocused();
  return focused.focused && (focused.id === ownerId || (popupId !== undefined && focused.id === popupId));
}

async function open(source: chrome.tabs.Tab) {
  if (source.id === undefined || opening) return;
  opening = true;
  try {
    const [owner, zoom] = await Promise.all([chrome.windows.get(source.windowId), chrome.tabs.getZoom(source.id)]);
    if (owner.type !== 'normal' || !await focusBelongsTo(source.windowId)) return;
    const bounds = nativePanelBounds(owner, source, undefined, zoom);
    const current: Session = { token: crypto.randomUUID(), sourceTabId: source.id, sourceWindowId: source.windowId };
    session = current;
    await chrome.storage.session.set({ [KEY]: current });
    const popup = await chrome.windows.create({ url: `${urlFor(current.token)}&tab=${source.id}&owner=${source.windowId}`, type: 'popup', focused: false, ...bounds });
    if (popup?.id === undefined) throw new Error(t('errorWindow'));
    if (session !== current) { await chrome.windows.remove(popup.id); return; }
    current.popupWindowId = popup.id;
    await chrome.storage.session.set({ [KEY]: current });
    const [liveOwner, liveTab] = await Promise.all([chrome.windows.get(source.windowId), chrome.tabs.get(source.id)]);
    // Chrome can focus its new popup before create() resolves even when asked
    // for focused:false. Accept either side of our handoff, never another window.
    if (liveOwner.type !== 'normal' || !liveTab.active || liveTab.windowId !== source.windowId ||
        !await focusBelongsTo(source.windowId, popup.id)) { await close(); return; }
    await chrome.windows.update(popup.id, { focused: true });
  } catch (error) { await close(); throw error; }
  finally { opening = false; }
}

export async function togglePaletteWindow(source: chrome.tabs.Tab) {
  await ready;
  if (opening) return;
  if (session) { await close(); return; }
  await open(source);
}

/** Resolve context from our session, never from the popup's newly active tab. */
export async function paletteSender(sender: chrome.runtime.MessageSender): Promise<chrome.runtime.MessageSender> {
  if (!isPaletteSender(sender)) return sender;
  await ready;
  const current = session;
  if (!current || new URLSearchParams(new URL(sender.url!).hash.slice(1)).get('window') !== current.token || !sender.tab ||
      (current.popupWindowId !== undefined && sender.tab.windowId !== current.popupWindowId)) throw new Error(t('errorWindow'));
  const source = await chrome.tabs.get(current.sourceTabId);
  if (session !== current || source.windowId !== current.sourceWindowId || !source.active) throw new Error(t('errorMovedTab'));
  return { ...sender, tab: source, frameId: 0, url: chrome.runtime.getURL('popup.html') };
}

export async function getPaletteWindowState(sender: chrome.runtime.MessageSender): Promise<PaletteState | undefined> {
  if (isPaletteSender(sender)) await paletteSender(sender);
  return undefined;
}

/** Legacy paletteState is accepted but can never create or rebind a host. */
export async function performPaletteAction(payload: Execution, sender: chrome.runtime.MessageSender, onPerformed: (outcome?: ExecutionOutcome) => void) {
  if (!payload || !Number.isInteger(payload.windowId)) throw new Error(t('errorWindow'));
  const addressAction = ['navigateAddress', 'openAddressNewTab', 'openBookmark', 'openHistoryPage'].includes(payload.action);
  if (addressAction || ['close', 'closeOthers', 'closeRight', 'closeGroup'].includes(payload.action)) {
    // Validate the source independently of optional state from older clients.
    const source = sender.tab?.id !== undefined ? await chrome.tabs.get(sender.tab.id)
      : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!source?.id || !source.active || source.windowId !== payload.windowId ||
        (sender.tab && source.windowId !== sender.tab.windowId)) throw new Error(t('errorMovedTab'));
    if (addressAction && (payload.tabId !== source.id || (sender.tab && source.id !== sender.tab.id))) {
      throw new Error(t('errorTabChanged'));
    }
  }
  return perform(payload, onPerformed);
}

export async function closePaletteWindowForShortcut(tab: chrome.tabs.Tab) {
  await ready;
  if (opening) return true;
  if (session && (session.popupWindowId === undefined || !await chrome.windows.get(session.popupWindowId).catch(() => null))) { await close(); return false; }
  if (session && (tab.windowId === session.popupWindowId || tab.windowId === session.sourceWindowId)) {
    await close(); return true;
  }
  return false;
}
chrome.windows.onFocusChanged.addListener(id => {
  void ready.then(async () => {
    if (opening || session?.popupWindowId === undefined) return;
    const current = session;
    const focused = await chrome.windows.getLastFocused().catch(() => null);
    if (session !== current) return;
    // Chrome may reactivate the source window before its popup on app return.
    // Keep that handoff passive: never focus a window on the user's behalf.
    if (!focused?.focused) { awayFromChrome = true; return; }
    if (id === chrome.windows.WINDOW_ID_NONE) return;
    if (focused.id === current.popupWindowId) { awayFromChrome = false; return; }
    if (awayFromChrome && focused.id === current.sourceWindowId) return;
    awayFromChrome = false;
    await close();
  }).catch(() => {});
});
chrome.windows.onRemoved.addListener(id => {
  void ready.then(async () => {
    if (session && [session.popupWindowId, session.sourceWindowId].includes(id)) await close();
  }).catch(() => {});
});
chrome.tabs.onActivated.addListener(info => {
  void ready.then(async () => {
    if (session?.sourceWindowId === info.windowId && session.sourceTabId !== info.tabId) await close();
  }).catch(() => {});
});
chrome.tabs.onUpdated.addListener((id, change) => {
  void ready.then(async () => {
    // The source may still be completing its initial load during launch.
    if (!opening && session?.sourceTabId === id && change.status === 'loading') await close();
  }).catch(() => {});
});
chrome.tabs.onDetached.addListener(id => {
  void ready.then(async () => {
    if (session?.sourceTabId === id) await close();
  }).catch(() => {});
});
chrome.tabs.onRemoved.addListener(id => {
  void ready.then(async () => {
    if (id === session?.sourceTabId) await close();
  }).catch(() => {});
});
