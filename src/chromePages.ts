import type { MessageKey } from './i18n';
import type { ChromePageAction, IconName } from './types';

export const chromePages = {
  openExtensions: { url: 'chrome://extensions/', title: 'chromeExtensions', icon: 'extension',
    aliases: ['extension', 'extensions', 'manage extensions', '扩展', '扩展管理', '扩展程序', '插件'] },
  openPasswords: { url: 'chrome://password-manager/passwords', title: 'chromePasswords', icon: 'password',
    aliases: ['password', 'passwords', 'password manager', '密码', '密码管理器'] },
  openDownloads: { url: 'chrome://downloads/', title: 'chromeDownloads', icon: 'download',
    aliases: ['download', 'downloads', '下载', '下载内容'] },
  openHistory: { url: 'chrome://history/', title: 'chromeHistory', icon: 'history',
    aliases: ['history', 'browsing history', '历史', '历史记录', '浏览记录'] },
  openBookmarks: { url: 'chrome://bookmarks/', title: 'chromeBookmarks', icon: 'bookmark',
    aliases: ['bookmark manager', 'manage bookmarks', '书签管理', '书签管理器', '管理书签'] },
  openChromeSettings: { url: 'chrome://settings/', title: 'chromeSettings', icon: 'settings',
    aliases: ['chrome settings', 'browser settings', 'chrome 设置', '浏览器设置'] },
  openExtensionShortcuts: { url: 'chrome://extensions/shortcuts', title: 'chromeExtensionShortcuts', icon: 'keyboard',
    aliases: ['extension shortcuts', 'extension keyboard shortcuts', '扩展快捷键'] },
} as const satisfies Record<ChromePageAction, { url: string; title: MessageKey; icon: IconName; aliases: readonly string[] }>;

export function isChromePageAction(action: string): action is ChromePageAction {
  return Object.hasOwn(chromePages, action);
}

function matchesPage(tab: chrome.tabs.Tab, url: string): boolean {
  // A pending navigation supersedes the previous page. Preserve subpages,
  // searches and details instead of treating every URL on one host as identical.
  try {
    const current = new URL(tab.pendingUrl || tab.url || '');
    if (!current.pathname) current.pathname = '/';
    return current.href === url;
  } catch { return false; }
}

export async function openChromePage(action: ChromePageAction, windowId: number): Promise<void> {
  const { url } = chromePages[action];
  const tabs = await chrome.tabs.query({ windowId });
  for (const candidate of tabs.filter(tab => matchesPage(tab, url)).sort((a, b) => Number(b.active) - Number(a.active) || a.index - b.index)) {
    if (candidate.id === undefined) continue;
    const tab = await chrome.tabs.get(candidate.id).catch(() => undefined);
    if (tab?.windowId !== windowId || !matchesPage(tab, url)) continue;
    await chrome.tabs.update(candidate.id, { active: true });
    return;
  }
  await chrome.tabs.create({ windowId, url });
}
