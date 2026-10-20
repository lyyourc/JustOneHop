import { t, type MessageKey } from './i18n';
import type { BookmarkItem, Execution, ExecutionOutcome } from './types';

export function safeBookmarkUrl(url: string | undefined): boolean {
  if (typeof url !== 'string' || url !== url.trim() || /[\u0000-\u001f\u007f]/.test(url)) return false;
  try { return ['http:', 'https:', 'file:', 'ftp:', 'chrome:'].includes(new URL(url).protocol); }
  catch { return false; }
}

function flattenBookmarks(nodes: chrome.bookmarks.BookmarkTreeNode[], folder = '', managed = false): BookmarkItem[] {
  return nodes.flatMap(node => {
    const restricted = managed || node.unmodifiable === 'managed';
    return node.url
      ? [{ id: node.id, title: node.title || node.url, url: node.url, folder, ...(restricted ? { unmodifiable: 'managed' as const } : {}) }]
      : flattenBookmarks(node.children || [], [folder, node.title].filter(Boolean).join(' / '), restricted);
  });
}

// Shared across windows, but never across different Chrome API instances.
const bookmarkCaches = new WeakMap<typeof chrome.bookmarks, { pending?: Promise<BookmarkItem[]> }>();
function invalidateBookmarks(source: typeof chrome.bookmarks): void {
  const cache = bookmarkCaches.get(source);
  if (cache) cache.pending = undefined;
}
export function getBookmarks(source = chrome.bookmarks): Promise<BookmarkItem[]> {
  let cache = bookmarkCaches.get(source);
  if (!cache) {
    cache = {};
    bookmarkCaches.set(source, cache);
    for (const event of [source.onCreated, source.onRemoved, source.onChanged, source.onMoved, source.onChildrenReordered, source.onImportEnded]) {
      event?.addListener(() => invalidateBookmarks(source));
    }
  }
  if (!cache.pending) {
    const pending: Promise<BookmarkItem[]> = source.getTree().then(nodes => {
      // A change during the read must not publish the superseded tree.
      return cache!.pending === pending ? flattenBookmarks(nodes) : getBookmarks(source);
    }).catch(error => {
      if (cache!.pending === pending) cache!.pending = undefined;
      throw error;
    });
    cache.pending = pending;
  }
  return cache.pending;
}

class BookmarkActionError extends Error {
  constructor(key: MessageKey) { super(t(key)); }
}
function fail(key: MessageKey): never { throw new BookmarkActionError(key); }
const writes = new WeakMap<typeof chrome.bookmarks, Promise<unknown>>();

/** Serialize before reading any mutable context, including the originating window. */
export function performBookmarkAction(payload: Execution): Promise<ExecutionOutcome & { target: string }> {
  const api = chrome;
  const source = api.bookmarks;
  const result: Promise<ExecutionOutcome & { target: string }> = (writes.get(source) || Promise.resolve()).catch(() => {}).then(async () => {
    let removed = 0;
    let message: string;
    try {
      if (payload.action === 'removeBookmark') {
        const window = await api.windows.get(payload.windowId).catch(() => fail('errorWindow'));
        if (typeof payload.bookmarkId !== 'string' || !payload.bookmarkId || typeof payload.expectedUrl !== 'string' || !payload.expectedUrl) fail('errorBookmarkChanged');
        const item = flattenBookmarks(await source.getTree()).find(bookmark => bookmark.id === payload.bookmarkId);
        if (!item || item.url !== payload.expectedUrl) fail('errorBookmarkChanged');
        if (item.unmodifiable) fail('errorBookmarkItemManaged');
        const [live] = await source.get(item.id);
        if (!live || live.url !== payload.expectedUrl) fail('errorBookmarkChanged');
        if (live.unmodifiable) fail('errorBookmarkItemManaged');
        await source.remove(item.id);
        return { target: window.incognito ? '' : 'command:removeBookmark', message: t('outcomeBookmarksRemoved', '1') };
      }
      const context = async () => {
        if (!Number.isInteger(payload.tabId)) fail('errorNoTab');
        const window = await api.windows.get(payload.windowId).catch(() => fail('errorWindow'));
        const tab = await api.tabs.get(payload.tabId!).catch(() => fail('errorNoTab'));
        if (tab.windowId !== payload.windowId) fail('errorMovedTab');
        if (payload.groupId !== undefined) {
          if (!Number.isInteger(payload.groupId) || payload.groupId < 0 || tab.groupId !== payload.groupId) fail('errorGroup');
          const group = await api.tabGroups.get(payload.groupId).catch(() => fail('errorGroup'));
          if (group.windowId !== payload.windowId) fail('errorGroup');
        }
        if (!safeBookmarkUrl(payload.expectedUrl) || !safeBookmarkUrl(tab.url)) fail('errorBookmarkUrl');
        if (tab.url !== payload.expectedUrl || (tab.pendingUrl && tab.pendingUrl !== tab.url)) fail('errorBookmarkChanged');
        return { tab, private: !!(window.incognito || tab.incognito) };
      };
      let live = await context();
      // Always use the live tree: a cached snapshot cannot authorize a write.
      const read = async () => {
        const tree = await source.getTree();
        const ids = new Set<string>();
        const visit = (nodes: chrome.bookmarks.BookmarkTreeNode[]) => {
          for (const node of nodes) { ids.add(node.id); visit(node.children || []); }
        };
        visit(tree);
        return { ids, matches: flattenBookmarks(tree).filter(item => item.url === payload.expectedUrl) };
      };
      let current = await read();
      if (payload.action === 'bookmarkTab') {
        if (!current.matches.length) {
          live = await context();
          // Chrome chooses its native default destination when parentId is absent.
          await source.create({ url: live.tab.url!, title: live.tab.title || live.tab.url! });
          message = t('outcomeBookmarked');
        } else message = t('outcomeAlreadyBookmarked');
      } else {
        const ids = payload.bookmarkIds;
        if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) fail('errorBookmarkChanged');
        const remaining = new Set(ids);
        const validate = () => {
          if (current.matches.length !== remaining.size || current.matches.some(item => !remaining.has(item.id))) fail('errorBookmarkChanged');
          if (current.matches.some(item => item.unmodifiable === 'managed')) fail('errorBookmarkManaged');
        };
        // A repeated cancellation is harmless only if every observed ID vanished.
        if (!current.matches.length && ids.every(id => !current.ids.has(id))) {
          return { target: live.private ? '' : 'command:unbookmarkTab', message: t('outcomeAlreadyUnbookmarked') };
        }
        validate();
        for (const id of ids) {
          current = await read();
          validate();
          live = await context();
          // Check the individual URL again after the asynchronous context reads.
          const [bookmark] = await source.get(id);
          if (!bookmark || bookmark.url !== payload.expectedUrl) fail('errorBookmarkChanged');
          if (bookmark.unmodifiable === 'managed') fail('errorBookmarkManaged');
          await source.remove(id);
          removed++;
          remaining.delete(id);
        }
        current = await read();
        validate();
        message = t('outcomeBookmarksRemoved', String(removed));
      }
      return { target: live.private ? '' : `command:${payload.action}`, message };
    } catch (error) {
      if (removed) throw new Error(t('errorBookmarkPartialCount', String(removed)));
      if (error instanceof BookmarkActionError) throw error;
      fail('errorBookmarkWrite');
    } finally {
      // Native events also invalidate and broadcast; this covers an immediate snapshot.
      invalidateBookmarks(source);
      if (writes.get(source) === result) writes.delete(source);
    }
  });
  writes.set(source, result);
  return result;
}
