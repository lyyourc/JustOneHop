import { isNativePage, togglePaletteWindow, paletteSender, closePaletteWindowForShortcut, getPaletteWindowState, performWithPaletteContinuation, registerPaletteContinuation, releasePaletteContinuation, cancelPaletteContinuation } from './paletteWindow';
import { startTabTucking } from './tabTuck';
import { runSavedScript } from './scriptExecution';
import { openRecentSwitcher } from './recentTabs';
import { readPageStorage, openCookieAccess } from './pageStorage';
import { preferencesReady } from './preferences';
import { errorMessage, t } from './i18n';
import { openChromePage } from './chromePages';
import { historyWindow, searchHistory, snapshot } from './browser';
import { refreshToolbarMenu, startToolbarMenu } from './toolbarMenu';
import { forgetUsage, resetUsage } from './usageStorage';
import type { Request, Snapshot, PageStorage, ScriptResult, PaletteState, HistorySearchResult } from './types';

const opening = new Set<number>();
async function launch(tab: chrome.tabs.Tab) {
  if (tab.id === undefined || opening.has(tab.id)) return;
  if (await closePaletteWindowForShortcut(tab)) return;
  if (isNativePage(tab)) {
    await chrome.action.setPopup({ tabId: tab.id, popup: '' });
    await togglePaletteWindow(tab); return;
  }
  opening.add(tab.id);
  try {
    // Other content listeners can accept a message without answering it. Only
    // the palette's explicit acknowledgement proves its handler is installed.
    const ready = await chrome.tabs.sendMessage(tab.id, { source: 'zing', type: 'ping' }, { frameId: 0 }).catch(() => false);
    if (ready !== true) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    const shown = await chrome.tabs.sendMessage(tab.id, { source: 'zing', type: 'toggle' }, { frameId: 0 });
    if (!shown) throw new Error('Unable to show page overlay');
    await chrome.action.setPopup({ tabId: tab.id, popup: '' });
  } catch {
    // Restricted pages and overlays that cannot receive browser keyboard focus.
    await chrome.action.setPopup({ tabId: tab.id, popup: 'popup.html' });
    try { await chrome.action.openPopup({ windowId: tab.windowId }); }
    catch (error) { console.warn('zing: click the toolbar icon to open the fallback.', error); }
  } finally { opening.delete(tab.id); }
}

chrome.action.onClicked.addListener(tab => { void launch(tab); });
chrome.commands.onCommand.addListener(async command => {
  if (command === 'switch-recent' || command === 'switch-recent-back') { await openRecentSwitcher(command); return; }
  if (command !== 'toggle-palette') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) await launch(tab);
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') void chrome.action.setPopup({ tabId, popup: '' }).catch(() => {});
});
chrome.runtime.onMessage.addListener((request: Request, sender, respond) => {
  if (sender.id !== chrome.runtime.id || request?.source !== 'zing') return;
  if (!['run-saved-script', 'open-script-settings', 'snapshot', 'search-history', 'palette-state', 'execute', 'cancel-palette-continuation', 'open-shortcuts', 'reset-usage', 'forget-usage', 'read-page-storage', 'open-cookie-access'].includes(request.type)) return;
  // Register before any await so a dismissal arriving during preflight also
  // cancels this caller's continuation, without cancelling its browser action.
  const ticket = request.type === 'execute' && request.payload?.paletteState && ['close', 'closeOthers', 'closeRight'].includes(request.payload.action)
    ? registerPaletteContinuation(sender) : undefined;
  let responded = false;
  const success = (data?: void | Snapshot | PageStorage | ScriptResult | PaletteState | HistorySearchResult) => {
    if (responded) return;
    responded = true;
    // Switching/closing a tab can remove the caller before the reply. That
    // must not interrupt the successful action's queued usage write.
    try { respond({ ok: true, data }); } catch { /* Caller already gone. */ }
  };
  const result = request.type === 'cancel-palette-continuation' ? cancelPaletteContinuation(sender) : preferencesReady.then(async (): Promise<void | Snapshot | PageStorage | ScriptResult | PaletteState | HistorySearchResult> => {
    if (request.type === 'palette-state') return getPaletteWindowState(sender);
    sender = await paletteSender(sender);
    if (request.type === 'run-saved-script') return runSavedScript(request.payload, sender);
    if (request.type === 'open-script-settings') return chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}`, ...(sender.tab ? { windowId: sender.tab.windowId } : {}) }).then(() => undefined);
    if (request.type === 'open-cookie-access') return openCookieAccess(request.payload, sender);
    if (request.type === 'read-page-storage') return readPageStorage(request.payload, sender);
    if (request.type === 'snapshot') { void refreshToolbarMenu(); return snapshot(sender.tab); }
    if (request.type === 'search-history') return searchHistory(request.payload, sender);
    if (request.type === 'execute') {
      if (request.payload?.action === 'openHistoryPage') {
        if (!Number.isInteger(request.payload.windowId)) throw new Error(t('errorWindow'));
        await historyWindow(sender, request.payload.windowId);
      }
      return performWithPaletteContinuation(request.payload, sender, () => success(), ticket);
    }
    if (request.type === 'reset-usage') return resetUsage();
    if (request.type === 'forget-usage') return forgetUsage(request.payload?.target, request.payload?.query);
    const windowId = sender.tab?.windowId ?? (await chrome.windows.getCurrent()).id;
    if (windowId === undefined) throw new Error(t('errorWindow'));
    if (request.type === 'open-shortcuts' && request.preserveBindingGuide) {
      const url = chrome.runtime.getURL('popup.html#binding');
      const existing = (await chrome.tabs.query({ windowId })).some(tab => tab.url === url || tab.pendingUrl === url);
      if (!existing) await chrome.tabs.create({ windowId, url, active: false });
    }
    return openChromePage('openExtensionShortcuts', windowId);
  });
  void result.finally(() => releasePaletteContinuation(ticket)).then(success).catch(error => {
    if (!responded) respond({ ok: false, error: errorMessage(error) });
  });
  return true;
});

// Only visible palettes keep a port open; tab lifecycle checks use Chrome alarms.
const clients = new Set<chrome.runtime.Port>();
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'zing' || port.sender?.id !== chrome.runtime.id) return;
  clients.add(port);
  port.onDisconnect.addListener(() => { clients.delete(port); });
});
const changed = () => {
  for (const port of clients) {
    try { port.postMessage({ source: 'zing', type: 'changed' }); }
    catch { clients.delete(port); }
  }
};
chrome.tabs.onCreated.addListener(changed);
chrome.tabs.onRemoved.addListener(changed);
chrome.tabs.onUpdated.addListener(changed);
chrome.tabs.onMoved.addListener(changed);
chrome.tabs.onAttached.addListener(changed);
chrome.tabs.onDetached.addListener(changed);
chrome.tabs.onActivated.addListener(changed);
chrome.bookmarks.onCreated.addListener(changed);
chrome.bookmarks.onRemoved.addListener(changed);
chrome.bookmarks.onChanged.addListener(changed);
chrome.bookmarks.onMoved.addListener(changed);

chrome.tabGroups.onCreated.addListener(changed);
chrome.tabGroups.onUpdated.addListener(changed);
chrome.tabGroups.onRemoved.addListener(changed);
chrome.tabGroups.onMoved.addListener(changed);
startTabTucking(changed);
startToolbarMenu();
