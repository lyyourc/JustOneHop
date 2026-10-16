import { t } from './i18n';

const KEY = 'zingPaletteWindow';
interface Session { token: string; sourceTabId: number; sourceWindowId: number; popupWindowId?: number }
let session: Session | undefined;
let opening = false;
const ready = chrome.storage.session.get(KEY).then(value => { session = value[KEY] as Session | undefined; }).catch(() => {});
const urlFor = (token: string) => chrome.runtime.getURL(`popup.html#window=${token}`);

export function isNativePage(tab: chrome.tabs.Tab) {
  return /^(chrome|chrome-search|chrome-untrusted|devtools):/.test(tab.pendingUrl || tab.url || '');
}
async function close() {
  const old = session;
  session = undefined;
  await chrome.storage.session.remove(KEY);
  if (old?.popupWindowId !== undefined) await chrome.windows.remove(old.popupWindowId).catch(() => {});
}

export async function togglePaletteWindow(source: chrome.tabs.Tab) {
  await ready;
  if (opening) return;
  if (session) { await close(); return; }
  if (source.id === undefined) return;
  opening = true;
  try {
    const owner = await chrome.windows.get(source.windowId);
    if (!owner.focused || owner.type !== 'normal') return;
    const width = Math.min(750, owner.width || 750);
    const height = Math.min(560, owner.height || 560);
    const current = { token: crypto.randomUUID(), sourceTabId: source.id, sourceWindowId: source.windowId } as Session;
    session = current;
    await chrome.storage.session.set({ [KEY]: current });
    const popup = await chrome.windows.create({ url: urlFor(current.token), type: 'popup', focused: false,
      width, height, left: Math.round((owner.left || 0) + ((owner.width || width) - width) / 2),
      top: Math.round((owner.top || 0) + ((owner.height || height) - height) / 2) });
    if (popup?.id === undefined) throw new Error(t('errorWindow'));
    if (session !== current) { await chrome.windows.remove(popup.id); return; }
    current.popupWindowId = popup.id;
    await chrome.storage.session.set({ [KEY]: session });
    const [liveOwner, liveTab] = await Promise.all([chrome.windows.get(source.windowId), chrome.tabs.get(source.id)]);
    if (!liveOwner.focused || !liveTab.active || liveTab.windowId !== source.windowId) { await close(); return; }
    await chrome.windows.update(popup.id, { focused: true });
  } catch (error) { await close(); throw error; }
  finally { opening = false; }
}

/** Resolve context from our session, never from the popup's newly active tab. */
export async function paletteSender(sender: chrome.runtime.MessageSender): Promise<chrome.runtime.MessageSender> {
  if (!sender.url?.startsWith(chrome.runtime.getURL('popup.html#window='))) return sender;
  await ready;
  const current = session;
  if (!current || sender.url !== urlFor(current.token) || !sender.tab ||
      (current.popupWindowId !== undefined && sender.tab.windowId !== current.popupWindowId)) throw new Error(t('errorWindow'));
  const source = await chrome.tabs.get(current.sourceTabId);
  if (source.windowId !== current.sourceWindowId || !source.active) throw new Error(t('errorMovedTab'));
  return { ...sender, tab: source, frameId: 0, url: chrome.runtime.getURL('popup.html') };
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
    if (!opening && session?.popupWindowId !== undefined && id !== session.popupWindowId) {
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
    if (session && [session.popupWindowId, session.sourceWindowId].includes(id)) await close();
  }).catch(() => {});
});
chrome.tabs.onRemoved.addListener(id => {
  void ready.then(async () => { if (id === session?.sourceTabId) await close(); }).catch(() => {});
});
