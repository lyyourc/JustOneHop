import { addressNewTabShortcut, addressUrl } from './address';
import { t } from './i18n';
import type { Entry, Snapshot } from './types';

export function addressEntry(query: string, data: Snapshot, results: Entry[] = []): Entry | undefined {
  const url = addressUrl(query);
  const source = data.tabs.find(tab => tab.id === data.currentTabId);
  if (!url || !source || results.some(entry => ['tab', 'bookmark', 'history'].includes(entry.kind) && entry.url && addressUrl(entry.url) === url)) return;
  return {
    id: `address:${url}`, kind: 'command', action: 'navigateAddress', icon: 'tab',
    title: t('goToUrl'), subtitle: url, url, keywords: url,
    tabId: source.id, expectedUrl: source.url, disabled: source.pinned,
  };
}

export function isPageNavigation(entry?: Entry): boolean {
  return !!entry && ['navigateAddress', 'openBookmark', 'openHistoryPage'].includes(entry.action);
}

export function pageNavigationEntry(entry: Entry, data: Snapshot): Entry {
  if (!isPageNavigation(entry)) return entry;
  const source = data.tabs.find(tab => tab.id === data.currentTabId);
  return { ...entry, tabId: source?.id, expectedUrl: source?.url, disabled: !source || source.pinned };
}

function newTabAction(entry: Omit<Entry, 'title' | 'keywords'>, isMac: boolean): Entry {
  return { ...entry, id: `${entry.id}:new`, action: entry.action === 'navigateAddress' ? 'openAddressNewTab' : entry.action, newTab: true, title: t('openNewTab'),
    keywords: 'open new tab 新标签页打开', disabled: false, shortcut: addressNewTabShortcut(isMac) };
}

export function tabNewTabAction(entry: Entry, data: Snapshot, isMac: boolean): Entry | undefined {
  const url = entry.url;
  if (entry.kind !== 'tab' || entry.action !== 'switch' || !url || !/^https?:\/\//i.test(url) || addressUrl(url) !== url) return;
  const source = data.tabs.find(tab => tab.id === data.currentTabId);
  if (!source?.url) return;
  return newTabAction({
    id: entry.id, url, kind: 'command', action: 'openAddressNewTab', icon: 'plus', subtitle: '',
    tabId: source.id, expectedUrl: source.url,
    aliases: ['open in new tab', 'open new tab', 'new tab', '在新标签页打开', '新标签页打开', '新标签页'],
  }, isMac);
}

export function addressActions(entry: Entry, isMac: boolean): Entry[] {
  return [
    { ...entry, id: `${entry.id}:current`, title: t('openCurrentTab'), keywords: 'open current tab 当前页打开 当前标签页打开' },
    newTabAction(entry, isMac),
  ];
}
