import { cookiePatterns } from './cookieAccess';
import { t } from './i18n';
import { recordUsage } from './usageStorage';
import type { PageStorage, StorageRead, StorageEntry, CookieAccessRequest } from './types';

async function storageTab(request: CookieAccessRequest, sender: chrome.runtime.MessageSender) {
  if (!request || !Number.isInteger(request.tabId) || !Number.isInteger(request.windowId) || typeof request.expectedUrl !== 'string') {
    throw new Error(t('errorStorageTarget'));
  }
  const popup = sender.url === chrome.runtime.getURL('popup.html');
  if (!popup && (!sender.tab || sender.tab.id !== request.tabId || sender.frameId !== 0)) throw new Error(t('errorStorageTarget'));
  const tab = await chrome.tabs.get(request.tabId);
  if (tab.windowId !== request.windowId || tab.url !== request.expectedUrl || tab.pendingUrl) throw new Error(t('errorStorageChanged'));
  if (!/^https?:\/\//.test(tab.url)) throw new Error(t('errorStorageUnsupported'));
  return tab;
}

export async function openCookieAccess(request: CookieAccessRequest, sender: chrome.runtime.MessageSender): Promise<void> {
  const tab = await storageTab(request, sender);
  const params = new URLSearchParams({ tab: String(tab.id), window: String(tab.windowId), origin: new URL(tab.url!).origin });
  await chrome.windows.create({ url: chrome.runtime.getURL(`cookie-access.html?${params}`), type: 'popup', width: 460, height: 350, focused: true });
}

/** Read only the captured top-level page, never a newly focused tab or child frame. */
export async function readPageStorage(request: StorageRead, sender: chrome.runtime.MessageSender): Promise<PageStorage> {
  if (!request || !['local', 'session', 'cookies'].includes(request.kind)) throw new Error(t('errorStorageTarget'));
  const tab = await storageTab(request, sender);
  if (request.kind === 'cookies' && !await chrome.permissions.contains({ origins: cookiePatterns(tab.url!) })) {
    throw new Error(t('errorStoragePermission'));
  }
  let entries: StorageEntry[];
  try {
    if (request.kind === 'cookies') {
      const stores = await chrome.cookies.getAllCookieStores();
      const storeId = stores.find(store => store.tabIds.includes(request.tabId))?.id;
      if (storeId === undefined) throw new Error('Cookie store unavailable');
      const scope = { url: tab.url!, storeId };
      const cookies = await chrome.cookies.getAll(scope);
      // Chrome 127 supports ordinary cookies; newer versions also expose the
      // exact frame partition key, avoiding guesses about registrable domains.
      if (chrome.cookies.getPartitionKey) {
        const { partitionKey } = await chrome.cookies.getPartitionKey({ tabId: request.tabId, frameId: 0 });
        cookies.push(...await chrome.cookies.getAll({ ...scope, partitionKey }));
      }
      const unique = new Map<string, StorageEntry>();
      for (const cookie of cookies) {
        const id = JSON.stringify([cookie.storeId, cookie.domain, cookie.path, cookie.name, cookie.partitionKey || null]);
        const { name, value, domain, path, secure, httpOnly, sameSite, session, expirationDate, partitionKey } = cookie;
        unique.set(id, { id, name, value, cookie: { domain, path, secure, httpOnly, sameSite, session, expirationDate, partitionKey } });
      }
      entries = [...unique.values()];
    } else {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: request.tabId, frameIds: [0] },
        func: (kind: 'local' | 'session', expectedUrl: string) => {
          if (location.href !== expectedUrl) return null;
          const storage = kind === 'local' ? localStorage : sessionStorage;
          return { url: location.href, entries: Object.keys(storage).map(name => ({ id: name, name, value: storage.getItem(name) ?? '' })) };
        },
        args: [request.kind, request.expectedUrl],
      });
      if (!result?.result || result.result.url !== request.expectedUrl) throw new Error(t('errorStorageChanged'));
      entries = result.result.entries;
    }
  } catch (error) {
    if (error instanceof Error && error.message === t('errorStorageChanged')) throw error;
    if (request.kind === 'cookies' && error instanceof Error && /host permissions/i.test(error.message)) throw new Error(t('errorStoragePermission'));
    throw new Error(t('errorStorageRead'));
  }
  await storageTab(request, sender);
  if (typeof request.query === 'string' && !tab.incognito) {
    const action = request.kind === 'local' ? 'localStorage' : request.kind === 'session' ? 'sessionStorage' : 'cookies';
    await recordUsage(request.query, `command:${action}`).catch(() => {});
  }
  return { kind: request.kind, url: tab.url!, entries: entries.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) };
}
