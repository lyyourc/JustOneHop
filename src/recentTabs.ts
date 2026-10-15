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
}
let current: Session | undefined;
const send = (message: object) => chrome.runtime.sendMessage({ source: 'zing-recent', ...message }).catch(() => {});
function clear(session: Session, close = true) {
  if (current !== session) return;
  current = undefined;
  if (session.source?.id !== undefined) void chrome.tabs.sendMessage(session.source.id, { source: 'zing-recent', type: 'disarm', session: session.id }).catch(() => {});
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
      const state = await chrome.tabs.sendMessage(source.id!, { source: 'zing-recent', type: 'arm', session: session.id, modifier });
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
    const params = new URLSearchParams({ tab: String(source.id), window: String(owner.id), direction: String(direction), session: session.id, modifier });
    const popup = await chrome.windows.create({
      url: `switcher.html?${params}`, type: 'popup', state: 'normal', focused: false,
      width: 500, height: 500,
      left: Math.round((owner.left || 0) + Math.max(0, ((owner.width || 1000) - 500) / 2)),
      top: Math.round((owner.top || 0) + Math.max(0, ((owner.height || 800) - 500) / 3)),
    });
    if (current !== session) { if (popup?.id !== undefined) await chrome.windows.remove(popup.id); return; }
    session.popup = popup?.id;
  } catch (error) { clear(session); console.warn('zing: unable to open recent tabs.', error); }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const session = current;
  if (sender.id !== chrome.runtime.id || message?.source !== 'zing-recent' || !session || message.session !== session.id) return;
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
chrome.tabs.onRemoved.addListener(id => { if (current?.source?.id === id) clear(current); });
chrome.tabs.onDetached.addListener(id => { if (current?.source?.id === id) clear(current); });
chrome.tabs.onUpdated.addListener((id, change) => { if (current?.source?.id === id && change.status === 'loading') clear(current); });
chrome.tabs.onActivated.addListener(info => {
  if (current?.source && !current.handingOff && info.windowId === current.source.windowId && info.tabId !== current.source.id) clear(current);
});
