import { errorMessage, t } from './i18n';
import { nativePanelBounds } from './panelGeometry';
// The page owns key-up until the independent window has installed its listeners.
// An actual observed release is buffered; elapsed time never implies a release.
interface Session {
  id: string;
  offset: number;
  source?: chrome.tabs.Tab;
  popup?: number;
  tabs: chrome.tabs.Tab[];
  released: boolean;
  ready: boolean;
  handingOff: boolean;
  frame?: number;
  overlay?: boolean;
}
let current: Session | undefined;
const send = (message: object) => {
  const payload = { source: 'justonehop-recent', ...message };
  return (current?.overlay && current.source?.id !== undefined
    ? chrome.tabs.sendMessage(current.source.id, payload, { frameId: 0 })
    : chrome.runtime.sendMessage(payload)).catch(() => {});
};
function clear(session: Session, close = true) {
  if (current !== session) return;
  current = undefined;
  if (session.source?.id !== undefined) void chrome.tabs.sendMessage(session.source.id, { source: 'justonehop-recent', type: 'disarm', session: session.id }).catch(() => {});
  if (close && session.popup !== undefined) void chrome.windows.remove(session.popup).catch(() => {});
}
async function sourceStillFocused(session: Session) {
  if (current !== session || !session.source?.id) return false;
  const [tab, owner] = await Promise.all([chrome.tabs.get(session.source.id), chrome.windows.get(session.source.windowId)]);
  return current === session && tab.active && tab.windowId === session.source.windowId && owner.focused;
}
export async function openRecentSwitcher(command: string) {
  const direction = command === 'switch-recent-back' ? -1 : 1;
  if (current) {
    if (!current.released) {
      if (current.ready) await send({ type: 'step', session: current.id, direction });
      else current.offset += direction;
    }
    return;
  }
  const session: Session = { id: crypto.randomUUID(), offset: direction, tabs: [], released: false, ready: false, handingOff: false };
  current = session;
  try {
    const owner = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (!owner.focused || owner.id === undefined) { clear(session); return; }
    const [all, bindings] = await Promise.all([chrome.tabs.query({ windowId: owner.id }), chrome.commands.getAll()]);
    session.source = all.find(tab => tab.active);
    if (session.source?.id === undefined || current !== session) { clear(session); return; }
    const source = session.source;
    session.tabs = all.filter(tab => tab.id !== undefined).sort((a, b) => Number(b.id === source.id) - Number(a.id === source.id) || (b.lastAccessed || 0) - (a.lastAccessed || 0) || a.index - b.index);
    const shortcut = bindings.find(binding => binding.name === command)?.shortcut || '';
    const modifier = /Command|⌘/.test(shortcut) ? 'Meta' : /Alt|Option|⌥/.test(shortcut) ? 'Alt' : 'Control';
    try {
      const state = await chrome.tabs.sendMessage(source.id!, { source: 'justonehop-recent', type: 'arm', session: session.id, modifier });
      session.released ||= state?.held === false;
    } catch { /* Restricted / not-yet-injected page: keep the existing window fallback. */ }
    if (!await sourceStillFocused(session)) { clear(session); return; }
    if (session.released) {
      const target = session.tabs[(session.offset % session.tabs.length + session.tabs.length) % session.tabs.length];
      const live = await chrome.tabs.get(target.id!);
      if (live.windowId === source.windowId && await sourceStillFocused(session)) {
        session.handingOff = true;
        await chrome.tabs.update(live.id!, { active: true });
      }
      clear(session); return;
    }
    // The source page retains focus for the whole selection. Native pages,
    // missing activeTab access, and Chrome UI focus keep the window fallback.
    if (/^https?:/.test(source.url || '')) {
      try {
        const installed = await chrome.tabs.sendMessage(source.id!, { source: 'justonehop', type: 'ping' }, { frameId: 0 }).catch(() => false);
        if (installed !== true) await chrome.scripting.executeScript({ target: { tabId: source.id! }, files: ['content.js'] });
        if (!await sourceStillFocused(session)) { clear(session); return; }
        const initialOffset = session.offset;
        session.overlay = true;
        const shown = await chrome.tabs.sendMessage(source.id!, { source: 'justonehop-recent', type: 'open-overlay',
          session: session.id, tabs: session.tabs, sourceId: source.id, offset: initialOffset, modifier, shortcut }, { frameId: 0 });
        if (current !== session) {
          if (shown === true) await chrome.tabs.sendMessage(source.id!, { source: 'justonehop-recent', type: 'disarm', session: session.id }, { frameId: 0 }).catch(() => {});
          return;
        }
        if (shown === true) {
          session.ready = true;
          if (session.offset !== initialOffset) await send({ type: 'step', session: session.id, direction: session.offset - initialOffset });
          if (session.released) await send({ type: 'released', session: session.id });
          return;
        }
      } catch { /* Retain the existing independent-window fallback. */ }
      session.overlay = false;
    }
    const zoom = await chrome.tabs.getZoom(source.id!);
    if (!await sourceStillFocused(session)) { clear(session); return; }
    const params = new URLSearchParams({ tab: String(source.id), window: String(owner.id), direction: String(direction), session: session.id, modifier });
    const popup = await chrome.windows.create({
      url: `switcher.html?${params}`, type: 'popup', state: 'normal', focused: false,
      ...nativePanelBounds(owner, source, undefined, zoom),
    });
    if (current !== session) { if (popup?.id !== undefined) await chrome.windows.remove(popup.id); return; }
    session.popup = popup?.id;
  } catch (error) { clear(session); console.warn('justonehop: unable to open recent tabs.', error); }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const session = current;
  if (sender.id !== chrome.runtime.id || message?.source !== 'justonehop-recent' || !session || message.session !== session.id) return;
  if (['accept-overlay', 'cancel-overlay'].includes(message.type)) {
    if (!session.overlay || sender.tab?.id !== session.source?.id || sender.frameId !== 0) return;
    if (message.type === 'cancel-overlay') { clear(session); respond({ ok: true }); return; }
    void (async () => {
      if (!session.tabs.some(tab => tab.id === message.tabId) || !await sourceStillFocused(session)) {
        clear(session); respond({ ok: false, error: t('errorMovedTab') }); return;
      }
      const target = await chrome.tabs.get(message.tabId);
      if (target.windowId !== session.source!.windowId) throw new Error(t('errorMovedTab'));
      // Recheck after the asynchronous lookup so an interrupted accept cannot
      // activate a tab in a background window.
      if (!await sourceStillFocused(session)) { clear(session); respond({ ok: false, error: t('errorMovedTab') }); return; }
      session.handingOff = true;
      await chrome.tabs.update(target.id!, { active: true });
      clear(session); respond({ ok: true });
    })().catch(error => { respond({ ok: false, error: errorMessage(error) }); });
    return true;
  }
  if (message.type === 'release' && sender.tab?.id === session.source?.id) {
    // Only the focused frame arms itself; accept its trusted key-up relay.
    if (session.frame !== undefined && session.frame !== sender.frameId) return;
    session.frame = sender.frameId;
    session.released = true;
    if (session.ready) void send({ type: 'released', session: session.id });
    respond(true);
  }
  if (message.type !== 'ready' || !sender.url?.startsWith(chrome.runtime.getURL('switcher.html') + '?') || sender.tab?.windowId === session.source?.windowId) return;
  void (async () => {
    if (!await sourceStillFocused(session)) { clear(session); respond(null); return; }
    session.popup = sender.tab?.windowId;
    session.handingOff = true;
    await chrome.windows.update(session.popup!, { focused: true });
    session.ready = true;
    respond({ tabs: session.tabs, offset: session.offset, released: session.released });
  })().catch(() => { clear(session); respond(null); });
  return true;
});
chrome.windows.onFocusChanged.addListener(id => {
  const session = current;
  if (session?.source && !session.handingOff && id !== session.source.windowId) clear(session);
});
chrome.windows.onRemoved.addListener(id => {
  if (current && id === current.popup) clear(current, false);
  else if (current && id === current.source?.windowId) clear(current);
});
function removed(id: number) {
  if (current?.source?.id === id) clear(current);
  else if (current?.overlay) {
    current.tabs = current.tabs.filter(tab => tab.id !== id);
    void send({ type: 'removed', session: current.id, tabId: id });
  }
}
chrome.tabs.onRemoved.addListener(removed);
chrome.tabs.onDetached.addListener(removed);
chrome.tabs.onUpdated.addListener((id, change) => { if (current?.source?.id === id && change.status === 'loading') clear(current); });
chrome.tabs.onActivated.addListener(info => {
  if (current?.source && !current.handingOff && info.windowId === current.source.windowId && info.tabId !== current.source.id) clear(current);
});
