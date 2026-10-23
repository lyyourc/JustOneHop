import { paletteSender, getPaletteWindowState, performPaletteAction, cancelPaletteContinuation } from './paletteWindow';
import { launchPalette } from './paletteLaunch';
import { startTabTucking, getTuckStatus } from './tabTuck';
import { openRecentSwitcher } from './recentTabs';
import { readPageStorage, openCookieAccess } from './pageStorage';
import { preferencesReady } from './preferences';
import { errorMessage, t } from './i18n';
import { openChromePage } from './chromePages';
import { historyWindow, searchHistory, snapshot } from './browser';
import { refreshToolbarMenu, startToolbarMenu } from './toolbarMenu';
import { startToolbarIcon } from './toolbarIcon';
import { forgetUsage, resetUsage } from './usageStorage';
import type { Request, Snapshot, PageStorage, PaletteState, HistorySearchResult, TuckStatus, ExecutionOutcome } from './types';

chrome.action.onClicked.addListener(tab => launchPalette(tab).catch(error => console.warn('justonehop: unable to open palette.', error)));
chrome.commands.onCommand.addListener(async command => {
  if (command === 'switch-recent' || command === 'switch-recent-back') { await openRecentSwitcher(command); return; }
  if (command !== 'toggle-palette') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) await launchPalette(tab).catch(error => console.warn('justonehop: unable to open palette.', error));
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') void chrome.action.setPopup({ tabId, popup: '' }).catch(() => {});
});
chrome.runtime.onMessage.addListener((request: Request, sender, respond) => {
  if (sender.id !== chrome.runtime.id || request?.source !== 'justonehop') return;
  if (!['snapshot', 'tuck-status', 'search-history', 'palette-state', 'execute', 'cancel-palette-continuation', 'open-shortcuts', 'open-help-url', 'reset-usage', 'forget-usage', 'read-page-storage', 'open-cookie-access'].includes(request.type)) return;
  let responded = false;
  const success = (data?: void | Snapshot | PageStorage | PaletteState | HistorySearchResult | TuckStatus | ExecutionOutcome) => {
    if (responded) return;
    responded = true;
    // Switching/closing a tab can remove the caller before the reply. That
    // must not interrupt the successful action's queued usage write.
    try { respond({ ok: true, data }); } catch { /* Caller already gone. */ }
  };
  const result = request.type === 'cancel-palette-continuation' ? cancelPaletteContinuation(sender) : preferencesReady.then(async (): Promise<void | Snapshot | PageStorage | PaletteState | HistorySearchResult | TuckStatus | ExecutionOutcome> => {
    if (request.type === 'tuck-status') return getTuckStatus(request.afterHours);
    if (request.type === 'palette-state') return getPaletteWindowState(sender);
    sender = await paletteSender(sender);
    if (request.type === 'open-cookie-access') return openCookieAccess(request.payload, sender);
    if (request.type === 'read-page-storage') return readPageStorage(request.payload, sender);
    if (request.type === 'snapshot') { void refreshToolbarMenu(); return snapshot(sender.tab); }
    if (request.type === 'search-history') return searchHistory(request.payload, sender);
    if (request.type === 'execute') {
      if (request.payload?.action === 'openHistoryPage') {
        if (!Number.isInteger(request.payload.windowId)) throw new Error(t('errorWindow'));
        await historyWindow(sender, request.payload.windowId);
      }
      return performPaletteAction(request.payload, sender, success);
    }
    if (request.type === 'reset-usage') return resetUsage();
    if (request.type === 'forget-usage') return forgetUsage(request.payload?.target, request.payload?.query);
    if (request.type === 'open-help-url') {
      const url = typeof request.url === 'string' && (request.url === 'https://emoji.muan.co/' || /^https:\/\/github\.com\/lyyourc\/JustOneHop/i.test(request.url))
        ? request.url
        : 'https://github.com/lyyourc/JustOneHop/blob/main/docs/USAGE.md';
      const targetWindow = sender.tab?.windowId;
      if (targetWindow !== undefined) {
        await chrome.tabs.create({ windowId: targetWindow, url, active: true });
      } else {
        await chrome.tabs.create({ url, active: true });
      }
      return;
    }
    const windowId = sender.tab?.windowId ?? (await chrome.windows.getCurrent()).id;
    if (windowId === undefined) throw new Error(t('errorWindow'));
    if (request.type === 'open-shortcuts' && request.preserveBindingGuide) {
      const url = chrome.runtime.getURL('popup.html#binding');
      const existing = (await chrome.tabs.query({ windowId })).some(tab => tab.url === url || tab.pendingUrl === url);
      if (!existing) await chrome.tabs.create({ windowId, url, active: false });
    }
    return openChromePage('openExtensionShortcuts', windowId);
  });
  void result.then(success).catch(error => {
    if (!responded) respond({ ok: false, error: errorMessage(error) });
  });
  return true;
});

// Only visible palettes keep a port open; tab lifecycle checks use Chrome alarms.
const clients = new Set<chrome.runtime.Port>();
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'justonehop' || port.sender?.id !== chrome.runtime.id) return;
  clients.add(port);
  port.onDisconnect.addListener(() => { clients.delete(port); });
});
const changed = () => {
  for (const port of clients) {
    try { port.postMessage({ source: 'justonehop', type: 'changed' }); }
    catch { clients.delete(port); }
  }
};
chrome.tabs.onCreated.addListener(changed);
chrome.tabs.onRemoved.addListener(changed);
chrome.tabs.onUpdated.addListener(changed);
chrome.tabs.onMoved.addListener(changed);
chrome.tabs.onAttached.addListener(changed);
chrome.tabs.onDetached.addListener(changed);
chrome.tabs.onActivated.addListener(info => {
  for (const port of clients) {
    const source = port.sender?.tab;
    if (source?.id !== undefined && source.windowId === info.windowId && source.id !== info.tabId) {
      void chrome.tabs.sendMessage(source.id, { source: 'justonehop', type: 'source-deactivated' }, { frameId: 0 }).catch(() => {});
    }
  }
  changed();
});
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
startToolbarIcon();
