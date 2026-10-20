import { getPreferences, preferencesReady, subscribePreferences } from './preferences';
import { errorMessage, t } from './i18n';
import { openChromePage } from './chromePages';

const shortcutId = 'justonehop-toolbar-shortcut';
const helpId = 'justonehop-toolbar-help';
const titles = new Map<string, string>();
let pending = Promise.resolve();

async function setItem(id: string, title: string) {
  if (titles.get(id) === title) return;
  const properties = { title, contexts: ['action'] as ['action'] };
  try { await chrome.contextMenus.update(id, properties); }
  catch {
    await new Promise<void>((resolve, reject) => {
      chrome.contextMenus.create({ id, ...properties }, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message)); else resolve();
      });
    });
  }
  titles.set(id, title);
}

export function refreshToolbarMenu(): Promise<void> {
  pending = pending.then(async () => {
    await preferencesReady;
    const commands = await chrome.commands.getAll();
    const shortcut = commands.find(command => command.name === 'toggle-palette')?.shortcut;
    await setItem(shortcutId, t('toolbarShortcut', shortcut || t('notAssigned')));
    await setItem(helpId, t('help'));
  }).catch(error => { console.warn('justonehop: unable to update toolbar menu.', error); });
  return pending;
}

export function startToolbarMenu() {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== shortcutId && info.menuItemId !== helpId) return;
    void (async () => {
      const windowId = tab?.windowId ?? (await chrome.windows.getCurrent()).id;
      if (windowId === undefined) throw new Error(t('errorWindow'));
      if (info.menuItemId === shortcutId) await openChromePage('openExtensionShortcuts', windowId);
      else await chrome.tabs.create({ windowId, url: chrome.runtime.getURL('help.html') });
      await Promise.all([chrome.action.setBadgeText({ text: '' }), chrome.action.setTitle({ title: t('extensionName') })]);
    })().catch(async error => {
      console.warn('justonehop: unable to open toolbar menu target.', error);
      // No panel exists for toolbar failures; keep a visible marker and a readable retry hint on the originating icon.
      await Promise.allSettled([
        chrome.action.setBadgeText({ text: '!' }),
        chrome.action.setTitle({ title: `${t('extensionName')}: ${errorMessage(error)} ${t('toolbarRetry')}` }),
      ]);
    });
    void refreshToolbarMenu();
  });
  // Chrome has no action-menu onShown or command-binding change event. Refresh
  // on browser activity as well as palette snapshots, without polling.
  chrome.runtime.onInstalled.addListener(() => { void refreshToolbarMenu(); });
  chrome.runtime.onStartup.addListener(() => { void refreshToolbarMenu(); });
  chrome.tabs.onActivated.addListener(() => { void refreshToolbarMenu(); });
  chrome.windows.onFocusChanged.addListener(windowId => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) void refreshToolbarMenu();
  });
  chrome.tabs.onUpdated.addListener((_id, _change, tab) => {
    if (tab.url === 'chrome://extensions/shortcuts') void refreshToolbarMenu();
  });
  let language = getPreferences().language;
  subscribePreferences(() => {
    if (language === getPreferences().language) return;
    language = getPreferences().language;
    void refreshToolbarMenu();
  });
  void refreshToolbarMenu();
}
