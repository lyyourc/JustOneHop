import { tuckFlags, canUndoTuck, tabTuckingReady, tuckTab, undoTuck, tuckRecoveries, resumeTuck, forgetTuckRecovery, updateManagedGroup } from './tabTuck';
import { t } from './i18n';
import { addressUrl } from './address';
import { reloadExtension } from './reloadExtension';
import { isChromePageAction, openChromePage } from './chromePages';
import { closeTargets, search } from './model';
import { historyEntries } from './historySearch';
import { isPinyinTerm, pinyinMatches } from './pinyinMatch';
import { termMatches } from './searchMatch';
import { recordUsage } from './usageStorage';
import { getSearchContinuation, recordSearchContinuation } from './searchContinuation';
import { settingsUsageTarget } from './usage';
import { getBookmarks, performBookmarkAction, safeBookmarkUrl } from './bookmarks';
import type { Execution, ExecutionOutcome, HistorySearchResult, Snapshot, TabItem } from './types';

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
  // History reads are independent of the source page's current URL. Opening a
  // result separately checks expectedUrl before changing the source tab.
  if (!source?.id || !source.active || source.incognito || sender.tab?.incognito ||
      (sender.tab && source.windowId !== sender.tab.windowId) ||
      (expectedWindowId !== undefined && source.windowId !== expectedWindowId)) throw new Error(t('errorHistorySearch'));
  const window = await chrome.windows.get(source.windowId);
  if (window.incognito) throw new Error(t('errorHistorySearch'));
  return source.windowId;
}

export async function searchHistory(request: { query: string; scope: 'week' | 'all' }, sender: chrome.runtime.MessageSender): Promise<HistorySearchResult> {
  if (!request || typeof request.query !== 'string' || !['week', 'all'].includes(request.scope)) throw new Error(t('errorHistorySearch'));
  await historyWindow(sender);
  const startTime = request.scope === 'week' ? Date.now() - 7 * 24 * 60 * 60 * 1000 : 0;
  const terms = request.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  // Chrome only recalls literal text. Supplement it with a bounded local scan,
  // keeping the native query so older literal hits are not lost to the scan cap.
  const [results, recent] = await Promise.all([
    chrome.history.search({ text: request.query, startTime, maxResults: 100 }),
    terms.some(isPinyinTerm) ? chrome.history.search({ text: '', startTime, maxResults: 1000 }) : Promise.resolve([]),
  ]);
  const phonetic = recent.filter(item => {
    const text = `${item.title || ''} ${item.url || ''}`;
    return terms.some(term => pinyinMatches(text, term).length > 0) &&
      terms.every(term => termMatches(text, term, false).length > 0);
  });
  const unique = new Map([...results, ...phonetic].map(item => [item.id, item]));
  const pages = [...unique.values()].filter(item => typeof item.id === 'string' && safeHistoryUrl(item.url)).map(item => ({
    id: item.id, url: item.url!, title: typeof item.title === 'string' && item.title ? item.title : item.url!,
    lastVisitTime: typeof item.lastVisitTime === 'number' && Number.isFinite(item.lastVisitTime) ? item.lastVisitTime : 0,
  }));
  const byId = new Map(pages.map(page => [`history:${page.id}`, page]));
  return {
    items: (phonetic.length ? search(historyEntries(pages), request.query).map(entry => byId.get(entry.id)!) : pages).slice(0, 100),
    limited: results.length >= 100 || recent.length >= 1000 || pages.length > 100,
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
    searchContinuation: active.incognito || window.incognito ? undefined : await getSearchContinuation(active.windowId).catch(() => undefined),
    incognito: !!(active.incognito || window.incognito),
    groups: groups.map(group => ({ ...group, title: group.title || t('unnamedGroup') })),
    currentTabId: active.id, windowId: active.windowId, canUndoTuck: canUndoTuck(active.windowId), tuckRecoveries: tuckRecoveries(),
    tabs: tabs.sort((a, b) => Number(a.id === active.id) - Number(b.id === active.id) ||
      (b.lastAccessed || 0) - (a.lastAccessed || 0) || a.index - b.index).map(toTab), bookmarks,
    shortcut: bindings.find(binding => binding.name === 'toggle-palette')?.shortcut || '',
    tabSwitcherShortcut: bindings.find(binding => binding.name === 'switch-recent')?.shortcut || '',
  };
}

export async function perform(payload: Execution, onPerformed?: (outcome?: ExecutionOutcome) => void): Promise<ExecutionOutcome | undefined> {
  const result = await performAction(payload);
  const target = typeof result === 'string' ? result : result.target;
  const outcome = typeof result === 'string' ? undefined : { message: result.message };
  if (payload.action === 'reloadExtension') { await reloadExtension(onPerformed); return; }
  // Let the panel refresh or dismiss as soon as Chrome finishes the action,
  // while this promise still owns queued persistence in the service worker.
  const continuation = recordSearchContinuation(payload, target).catch(() => {});
  onPerformed?.(outcome);
  await continuation;
  // An explicit empty query is a home choice; switcher navigation omits it.
  if (target && (typeof payload.query === 'string' || target.startsWith('command:')) &&
      (payload.action !== 'openHistoryPage' || payload.query?.trim())) {
    // Learning is secondary: a storage failure must not turn a successful browser
    // action into an error or encourage the user to execute it a second time.
    await recordUsage(typeof payload.query === 'string' ? payload.query : '', target).catch(() => {});
  }
  return outcome;
}

function closeOutcome(closed: number, protectedCount = 0): string {
  return protectedCount ? t('outcomeClosedProtected', [String(closed), String(protectedCount)])
    : closed ? t('outcomeClosedCount', String(closed)) : t('outcomeClosedNone');
}

async function performAction(payload: Execution): Promise<string | (ExecutionOutcome & { target: string })> {
  if (!payload || !Number.isInteger(payload.windowId)) throw new Error(t('errorWindow'));
  const { action, windowId, tabId, bookmarkId } = payload;
  if (action === 'bookmarkTab' || action === 'unbookmarkTab' || action === 'removeBookmark') return performBookmarkAction(payload);
  // Validate the original window even when the command does not target a tab.
  const window = await chrome.windows.get(windowId);
  const target = (key: string) => window.incognito ? '' : key;
  if (action === 'navigateAddress' || action === 'openAddressNewTab') {
    if (!Number.isInteger(tabId) || typeof payload.url !== 'string' || !/^https?:\/\//i.test(payload.url) ||
        addressUrl(payload.url) !== payload.url || typeof payload.expectedUrl !== 'string' || !payload.expectedUrl) {
      throw new Error(t('errorInvalidRequest'));
    }
    const source = await chrome.tabs.get(tabId!);
    if (source.id !== tabId || !source.active || source.windowId !== windowId || source.url !== payload.expectedUrl ||
        (source.pendingUrl && source.pendingUrl !== source.url)) throw new Error(t('errorTabChanged'));
    if (action === 'navigateAddress') {
      if (source.pinned) throw new Error(t('errorPinned'));
      await chrome.tabs.update(source.id!, { url: payload.url });
    } else {
      await chrome.tabs.create({ windowId: source.windowId, url: payload.url, active: true });
    }
    // Query-only history supplies completion without promoting a navigation result.
    return typeof payload.query === 'string' && payload.query.trim() ? target('query:navigation') : '';
  }
  if (action === 'updateGroup') {
    if (!Number.isInteger(payload.groupId) || !payload.groupChanges) throw new Error(t('errorGroup'));
    const changes = payload.groupChanges;
    if ((changes.title !== undefined && typeof changes.title !== 'string') ||
        (changes.collapsed !== undefined && typeof changes.collapsed !== 'boolean') ||
        (changes.color !== undefined && !['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'].includes(changes.color))) throw new Error(t('errorGroup'));
    return { target: '', message: await updateManagedGroup(windowId, payload.groupId!, changes) };
  }
  if (action === 'ungroupGroup' || action === 'closeGroup') {
    if (!Number.isInteger(payload.groupId) || payload.groupId! < 0) throw new Error(t('errorGroup'));
    const group = await chrome.tabGroups.get(payload.groupId!);
    if (group.windowId !== windowId) throw new Error(t('errorGroup'));
    const members = (await chrome.tabs.query({ windowId })).filter(tab => tab.groupId === group.id);
    if (!members.length) throw new Error(t('errorGroup'));
    if (action === 'ungroupGroup') {
      await chrome.tabs.ungroup(members.map(tab => tab.id!) as [number, ...number[]]);
      return { target: '', message: t('outcomeUngroupedCount', String(members.length)) };
    }
    const expected = payload.groupTabIds;
    if (!Array.isArray(expected) || !expected.length || expected.some(id => !Number.isInteger(id)) || new Set(expected).size !== expected.length) {
      throw new Error(t('errorInvalidRequest'));
    }
    if (expected.length !== members.length || members.some(tab => !expected.includes(tab.id!))) throw new Error(t('errorGroupMembersChanged'));
    let closed = 0, protectedCount = 0;
    try {
      for (const member of members) {
        const tab = await chrome.tabs.get(member.id!);
        if (tab.windowId !== windowId || tab.groupId !== group.id) throw new Error(t('errorGroupMembersChanged'));
        if (tab.pinned) { protectedCount++; continue; }
        await chrome.tabs.remove(tab.id!); closed++;
      }
    } catch (reason) {
      throw closed ? new Error(t('errorGroupPartialCount', [String(closed), String(members.length - closed)])) : reason;
    }
    return { target: '', message: closeOutcome(closed, protectedCount) };
  }
  if (action === 'ungroupTab') {
    if (!Number.isInteger(tabId) || !Number.isInteger(payload.groupId) || payload.groupId! < 0) throw new Error(t('errorGroup'));
    const tab = await chrome.tabs.get(tabId!);
    if (tab.windowId !== windowId || tab.groupId !== payload.groupId) throw new Error(t('errorGroup'));
    await chrome.tabs.ungroup(tab.id!); return { target: '', message: t('outcomeUngroupedCount', '1') };
  }
  if (isChromePageAction(action)) { await openChromePage(action, windowId); return target(`command:${action}`); }
  if (action === 'openHistoryPage' || action === 'openBookmark') {
    let url = payload.url;
    if (action === 'openHistoryPage') {
      if (window.incognito || !safeHistoryUrl(url)) throw new Error(t('errorHistorySearch'));
    } else {
      if (typeof bookmarkId !== 'string') throw new Error(t('errorBookmark'));
      const [bookmark] = await chrome.bookmarks.get(bookmarkId);
      if (!bookmark?.url || !safeBookmarkUrl(bookmark.url)) throw new Error(t('errorBookmarkUrl'));
      url = bookmark.url;
    }
    if (!Number.isInteger(tabId) || typeof payload.expectedUrl !== 'string' || !payload.expectedUrl ||
        (payload.newTab !== undefined && typeof payload.newTab !== 'boolean')) throw new Error(t('errorInvalidRequest'));
    const source = await chrome.tabs.get(tabId!);
    if (source.id !== tabId || !source.active || source.windowId !== windowId || source.url !== payload.expectedUrl ||
        (source.pendingUrl && source.pendingUrl !== source.url)) throw new Error(t('errorTabChanged'));
    if (payload.newTab) await chrome.tabs.create({ windowId, url, active: true });
    else {
      if (source.pinned) throw new Error(t('errorPinned'));
      await chrome.tabs.update(source.id!, { url });
    }
    return target(action === 'openBookmark' ? `bookmark:${bookmarkId}` : `tab:${url}`);
  }
  if (action === 'settings') {
    if (payload.settingsSection !== undefined && !['language', 'theme', 'keyboard', 'binding', 'ranking', 'tabs'].includes(payload.settingsSection)) throw new Error(t('errorCommand'));
    return target(settingsUsageTarget(payload.settingsSection));
  }
  if (action === 'reloadExtension') return '';
  if (action === 'resumeTuck') { await resumeTuck(windowId, payload.recoveryId!, payload.groupId!, payload.fingerprint!); return ''; }
  if (action === 'forgetTuckRecovery') { await forgetTuckRecovery(payload.recoveryId!); return ''; }
  if (action === 'undoTuck') return { target: target('command:undoTuck'), message: await undoTuck(windowId) };
  if (action === 'newTab') { await chrome.tabs.create({ windowId }); return target('command:newTab'); }
  if (action === 'restore') {
    const recent = await chrome.sessions.getRecentlyClosed({ maxResults: 1 });
    const id = recent[0]?.tab?.sessionId || recent[0]?.window?.sessionId;
    if (!id) throw new Error(t('errorRestore'));
    await chrome.sessions.restore(id); return target('command:restore');
  }
  if (!Number.isInteger(tabId)) throw new Error(t('errorNoTab'));
  const tab = await chrome.tabs.get(tabId!);
  if (tab.windowId !== windowId) throw new Error(t('errorMovedTab'));
  if (payload.groupId !== undefined && tab.groupId !== payload.groupId) throw new Error(t('errorGroup'));
  let message: string | undefined;
  switch (action) {
    case 'tuck': await tuckTab(tab.id!, windowId); message = t('outcomeTucked'); break;
    case 'switch': await chrome.tabs.update(tab.id!, { active: true }); break;
    case 'reload': await chrome.tabs.reload(tab.id!); break;
    case 'close': await chrome.tabs.remove(tab.id!); message = closeOutcome(1); break;
    case 'pin':
      await chrome.tabs.update(tab.id!, { pinned: !tab.pinned });
      message = t(tab.pinned ? 'outcomeUnpinned' : 'outcomePinned'); break;
    case 'mute':
      await chrome.tabs.update(tab.id!, { muted: !tab.mutedInfo?.muted });
      message = t(tab.mutedInfo?.muted ? 'outcomeUnmuted' : 'outcomeMuted'); break;
    case 'closeOthers':
    case 'closeRight': {
      const tabs = (await chrome.tabs.query({ windowId })).map(toTab);
      const ids = closeTargets(tabs, toTab(tab), action).map(target => target.id);
      const protectedCount = tabs.filter(candidate => candidate.id !== tab.id && candidate.pinned &&
        (action === 'closeOthers' || candidate.index > tab.index)).length;
      if (ids.length) {
        try { await chrome.tabs.remove(ids); }
        catch (error) {
          // A batch removal may reject after Chrome has already closed some tabs.
          const remaining = await chrome.tabs.query({}).catch(() => undefined);
          const closed = remaining ? ids.filter(id => !remaining.some(tab => tab.id === id)).length : 0;
          throw closed ? new Error(t('errorGroupPartialCount', [String(closed), String(ids.length - closed + protectedCount)])) : error;
        }
      }
      message = closeOutcome(ids.length, protectedCount);
      break;
    }
    default: throw new Error(t('errorCommand'));
  }
  const usageTarget = target(action === 'switch' ? (tab.url ? `tab:${tab.url}` : '') : `command:${action}`);
  return message === undefined ? usageTarget : { target: usageTarget, message };
}
