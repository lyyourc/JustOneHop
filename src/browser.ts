import { tuckFlags, canUndoTuck, tabTuckingReady, tuckTab, undoTuck, tuckRecoveries, resumeTuck, forgetTuckRecovery, updateManagedGroup } from './tabTuck';
import { t } from './i18n';
import { reloadExtension } from './reloadExtension';
import { isChromePageAction, openChromePage } from './chromePages';
import { closeTargets } from './model';
import { recordUsage } from './usageStorage';
import { settingsUsageTarget } from './usage';
import { getBookmarks, performBookmarkAction, safeBookmarkUrl } from './bookmarks';
import type { Execution, HistorySearchResult, Snapshot, TabItem } from './types';

function safeHistoryUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return false;
  try { return ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}

/** Called after paletteSender resolves a native palette to its original tab. */
export async function historyWindow(sender: chrome.runtime.MessageSender, expectedWindowId?: number): Promise<number> {
  const popup = sender.url === chrome.runtime.getURL('popup.html');
  if (sender.id !== chrome.runtime.id || (sender.frameId !== undefined && sender.frameId !== 0) ||
      (!popup && (sender.frameId !== 0 || !sender.tab || !safeHistoryUrl(sender.url)))) {
    throw new Error(t('errorHistorySearch'));
  }
  const source = sender.tab?.id !== undefined ? await chrome.tabs.get(sender.tab.id)
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!source?.id || !source.active || source.incognito || sender.tab?.incognito ||
      (sender.tab && source.windowId !== sender.tab.windowId) ||
      (!popup && source.url !== sender.url) ||
      (expectedWindowId !== undefined && source.windowId !== expectedWindowId)) throw new Error(t('errorHistorySearch'));
  const window = await chrome.windows.get(source.windowId);
  if (window.incognito) throw new Error(t('errorHistorySearch'));
  return source.windowId;
}

export async function searchHistory(request: { query: string; scope: 'week' | 'all' }, sender: chrome.runtime.MessageSender): Promise<HistorySearchResult> {
  if (!request || typeof request.query !== 'string' || !['week', 'all'].includes(request.scope)) throw new Error(t('errorHistorySearch'));
  await historyWindow(sender);
  const results = await chrome.history.search({ text: request.query, startTime: request.scope === 'week' ? Date.now() - 7 * 24 * 60 * 60 * 1000 : 0, maxResults: 100 });
  return {
    items: results.filter(item => typeof item.id === 'string' && safeHistoryUrl(item.url)).map(item => ({
      id: item.id, url: item.url!, title: typeof item.title === 'string' && item.title ? item.title : item.url!,
      lastVisitTime: typeof item.lastVisitTime === 'number' && Number.isFinite(item.lastVisitTime) ? item.lastVisitTime : 0,
    })),
    limited: results.length >= 100,
  };
}

export function toTab(tab: chrome.tabs.Tab): TabItem {
  return {
    id: tab.id!, groupId: tab.groupId === -1 ? undefined : tab.groupId, windowId: tab.windowId, index: tab.index,
    title: tab.title || tab.url || t('untitledTab'), url: tab.url || '',
    active: tab.active, pinned: tab.pinned, muted: tab.mutedInfo?.muted || false,
    audible: tab.audible || false, ...tuckFlags(tab),
  };
}

export async function snapshot(senderTab?: chrome.tabs.Tab): Promise<Snapshot> {
  const active = senderTab?.id !== undefined ? await chrome.tabs.get(senderTab.id)
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!active?.id) throw new Error(t('errorNoCurrent'));
  await tabTuckingReady();
  const [tabs, bookmarks, bindings, groups, window] = await Promise.all([
    chrome.tabs.query({ windowId: active.windowId }), getBookmarks(), chrome.commands.getAll(), chrome.tabGroups.query({ windowId: active.windowId }), chrome.windows.get(active.windowId),
  ]);
  return {
    incognito: !!(active.incognito || window.incognito),
    groups: groups.map(group => ({ ...group, title: group.title || t('unnamedGroup') })),
    currentTabId: active.id, windowId: active.windowId, canUndoTuck: canUndoTuck(active.windowId), tuckRecoveries: tuckRecoveries(),
    tabs: tabs.sort((a, b) => Number(a.id === active.id) - Number(b.id === active.id) ||
      (b.lastAccessed || 0) - (a.lastAccessed || 0) || a.index - b.index).map(toTab), bookmarks,
    shortcut: bindings.find(binding => binding.name === 'toggle-palette')?.shortcut || '',
    tabSwitcherShortcut: bindings.find(binding => binding.name === 'switch-recent')?.shortcut || '',
  };
}

export async function perform(payload: Execution, onPerformed?: () => void): Promise<void> {
  const target = await performAction(payload);
  if (payload.action === 'reloadExtension') { await reloadExtension(onPerformed); return; }
  // Let the panel refresh or dismiss as soon as Chrome finishes the action,
  // while this promise still owns queued persistence in the service worker.
  onPerformed?.();
  // An explicit empty query is a home choice; switcher navigation omits it.
  if (target && (typeof payload.query === 'string' || target.startsWith('command:')) &&
      (payload.action !== 'openHistoryPage' || payload.query?.trim())) {
    // Learning is secondary: a storage failure must not turn a successful browser
    // action into an error or encourage the user to execute it a second time.
    await recordUsage(typeof payload.query === 'string' ? payload.query : '', target).catch(() => {});
  }
}

async function performAction(payload: Execution): Promise<string> {
  if (!payload || !Number.isInteger(payload.windowId)) throw new Error(t('errorWindow'));
  const { action, windowId, tabId, bookmarkId } = payload;
  if (action === 'bookmarkTab' || action === 'unbookmarkTab' || action === 'removeBookmark') return performBookmarkAction(payload);
  // Validate the original window even when the command does not target a tab.
  const window = await chrome.windows.get(windowId);
  const target = (key: string) => window.incognito ? '' : key;
  if (action === 'updateGroup') {
    if (!Number.isInteger(payload.groupId) || !payload.groupChanges) throw new Error(t('errorGroup'));
    const changes = payload.groupChanges;
    if ((changes.title !== undefined && typeof changes.title !== 'string') ||
        (changes.collapsed !== undefined && typeof changes.collapsed !== 'boolean') ||
        (changes.color !== undefined && !['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'].includes(changes.color))) throw new Error(t('errorGroup'));
    await updateManagedGroup(windowId, payload.groupId!, changes); return '';
  }
  if (action === 'ungroupTab') {
    if (!Number.isInteger(tabId) || !Number.isInteger(payload.groupId) || payload.groupId! < 0) throw new Error(t('errorGroup'));
    const tab = await chrome.tabs.get(tabId!);
    if (tab.windowId !== windowId || tab.groupId !== payload.groupId) throw new Error(t('errorGroup'));
    await chrome.tabs.ungroup(tab.id!); return '';
  }
  if (isChromePageAction(action)) { await openChromePage(action, windowId); return target(`command:${action}`); }
  if (action === 'openHistoryPage') {
    if (window.incognito || !safeHistoryUrl(payload.url)) throw new Error(t('errorHistorySearch'));
    await chrome.tabs.create({ windowId, url: payload.url }); return target(`tab:${payload.url}`);
  }
  if (action === 'settings') {
    if (payload.settingsSection !== undefined && !['language', 'theme', 'keyboard', 'binding', 'ranking', 'tabs'].includes(payload.settingsSection)) throw new Error(t('errorCommand'));
    return target(settingsUsageTarget(payload.settingsSection));
  }
  if (action === 'reloadExtension') return '';
  if (action === 'resumeTuck') { await resumeTuck(windowId, payload.recoveryId!, payload.groupId!, payload.fingerprint!); return ''; }
  if (action === 'forgetTuckRecovery') { await forgetTuckRecovery(payload.recoveryId!); return ''; }
  if (action === 'undoTuck') { await undoTuck(windowId); return target('command:undoTuck'); }
  if (action === 'newTab') { await chrome.tabs.create({ windowId }); return target('command:newTab'); }
  if (action === 'restore') {
    const recent = await chrome.sessions.getRecentlyClosed({ maxResults: 1 });
    const id = recent[0]?.tab?.sessionId || recent[0]?.window?.sessionId;
    if (!id) throw new Error(t('errorRestore'));
    await chrome.sessions.restore(id); return target('command:restore');
  }
  if (action === 'openBookmark') {
    if (typeof bookmarkId !== 'string') throw new Error(t('errorBookmark'));
    const [bookmark] = await chrome.bookmarks.get(bookmarkId);
    if (!bookmark?.url || !safeBookmarkUrl(bookmark.url)) {
      throw new Error(t('errorBookmarkUrl'));
    }
    await chrome.tabs.create({ windowId, url: bookmark.url }); return target(`bookmark:${bookmarkId}`);
  }
  if (!Number.isInteger(tabId)) throw new Error(t('errorNoTab'));
  const tab = await chrome.tabs.get(tabId!);
  if (tab.windowId !== windowId) throw new Error(t('errorMovedTab'));
  if (payload.groupId !== undefined && tab.groupId !== payload.groupId) throw new Error(t('errorGroup'));
  switch (action) {
    case 'tuck': await tuckTab(tab.id!, windowId); break;
    case 'switch': await chrome.tabs.update(tab.id!, { active: true }); break;
    case 'reload': await chrome.tabs.reload(tab.id!); break;
    case 'close': await chrome.tabs.remove(tab.id!); break;
    case 'pin': await chrome.tabs.update(tab.id!, { pinned: !tab.pinned }); break;
    case 'mute': await chrome.tabs.update(tab.id!, { muted: !tab.mutedInfo?.muted }); break;
    case 'closeOthers':
    case 'closeRight': {
      const tabs = (await chrome.tabs.query({ windowId })).map(toTab);
      const ids = closeTargets(tabs, toTab(tab), action).map(target => target.id);
      if (ids.length) await chrome.tabs.remove(ids);
      break;
    }
    default: throw new Error(t('errorCommand'));
  }
  return target(action === 'switch' ? (tab.url ? `tab:${tab.url}` : '') : `command:${action}`);
}
