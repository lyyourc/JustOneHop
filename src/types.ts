export type ActionId = 'switch' | 'openBookmark' | 'newTab' | 'reload' | 'close' | 'closeOthers' | 'closeRight' | 'restore' | 'pin' | 'mute';

export interface TabItem {
  id: number;
  windowId: number;
  index: number;
  title: string;
  url: string;
  active: boolean;
  pinned: boolean;
  muted: boolean;
  audible: boolean;
}
export interface BookmarkItem { id: string; title: string; url: string; folder: string }
export interface Snapshot {
  windowId: number;
  currentTabId: number;
  tabs: TabItem[];
  bookmarks: BookmarkItem[];
  shortcut: string;
}
export interface Execution {
  action: ActionId | 'settings';
  windowId: number;
  tabId?: number;
  bookmarkId?: string;
  query?: string;
}
export type StorageKind = 'local' | 'session' | 'cookies';
export type StorageAction = 'localStorage' | 'sessionStorage' | 'cookies';
export interface StorageRead {
  kind: StorageKind; tabId: number; windowId: number; expectedUrl: string; query?: string;
}
export type CookieAccessRequest = Pick<StorageRead, 'tabId' | 'windowId' | 'expectedUrl'>;
export interface StorageEntry {
  id: string; name: string; value: string;
  cookie?: Pick<chrome.cookies.Cookie, 'domain' | 'path' | 'secure' | 'httpOnly' | 'sameSite' | 'session' | 'expirationDate' | 'partitionKey'>;
}
export interface PageStorage { kind: StorageKind; url: string; entries: StorageEntry[] }
export interface ScriptRun { scriptId: string; tabId: number; windowId: number; expectedUrl: string }
export interface ScriptResult { success: boolean; text: string }
export type Request =
  | { source: 'zing'; type: 'run-saved-script'; payload: ScriptRun }
  | { source: 'zing'; type: 'open-script-settings' }
  | { source: 'zing'; type: 'snapshot' }
  | { source: 'zing'; type: 'read-page-storage'; payload: StorageRead }
  | { source: 'zing'; type: 'open-cookie-access'; payload: CookieAccessRequest }
  | { source: 'zing'; type: 'open-shortcuts' }
  | { source: 'zing'; type: 'reset-usage' }
  | { source: 'zing'; type: 'execute'; payload: Execution };
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };
export type IconName = 'tab' | 'bookmark' | 'plus' | 'reload' | 'close' | 'others' | 'right' | 'restore' | 'pin' | 'volume' | 'settings' | 'database' | 'cookie' | 'script' | 'edit';
export type SettingsSection = 'language' | 'theme' | 'keyboard' | 'ranking';
export interface Entry {
  category?: 'tab' | 'script' | 'storage' | 'settings';
  shortcut?: string;
  faviconPageUrl?: string;
  id: string;
  kind: 'command' | 'tab' | 'bookmark' | 'script';
  title: string;
  subtitle: string;
  keywords: string;
  icon: IconName;
  action: ActionId | 'settings' | StorageAction | 'copyScript' | 'editScript' | 'deleteScript' | 'newScript' | 'scriptLibrary' | 'runScript' | 'runCopyScript';
  settingsSection?: SettingsSection;
  aliases?: string[];
  searchOnly?: boolean;
  scriptId?: string;
  tabId?: number;
  bookmarkId?: string;
  pinned?: boolean;
  muted?: boolean;
  active?: boolean;
  danger?: boolean;
}
