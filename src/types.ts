export type ChromePageAction = 'openExtensions' | 'openPasswords' | 'openDownloads' | 'openHistory' | 'openBookmarks' | 'openChromeSettings' | 'openExtensionShortcuts';
export type ActionId = ChromePageAction | 'switch' | 'openBookmark' | 'newTab' | 'reload' | 'reloadExtension' | 'close' | 'closeOthers' | 'closeRight' | 'restore' | 'pin' | 'mute' | 'tuck' | 'undoTuck' | 'resumeTuck' | 'forgetTuckRecovery' | 'updateGroup' | 'ungroupTab';

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
  tucked?: boolean;
  canTuck?: boolean;
  groupId?: number;
}
export interface BookmarkItem { id: string; title: string; url: string; folder: string }
export interface TuckRecoveryItem {
  id: string; title: string; urls: string[];
  candidates: { id: number; windowId: number; title: string; fingerprint: string;
    tabs: { id: number; title: string; url: string }[] }[];
}
export interface TabGroupItem { id: number; windowId: number; title: string; color: chrome.tabGroups.TabGroup['color']; collapsed: boolean }
export interface Snapshot {
  groups?: TabGroupItem[];
  windowId: number;
  currentTabId: number;
  tabs: TabItem[];
  bookmarks: BookmarkItem[];
  shortcut: string;
  canUndoTuck?: boolean;
  tuckRecoveries?: TuckRecoveryItem[];
}
export interface PaletteState {
  query: string;
  selection: string | null;
  caret: [number, number];
  group?: { id: number; query: string; selection: string | null; caret: [number, number] };
}
export interface Execution {
  paletteState?: PaletteState;
  action: ActionId | 'settings';
  windowId: number;
  tabId?: number;
  bookmarkId?: string;
  query?: string;
  recoveryId?: string;
  groupId?: number;
  fingerprint?: string;
  groupChanges?: { title?: string; color?: chrome.tabGroups.TabGroup['color']; collapsed?: boolean };
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
  | { source: 'zing'; type: 'palette-state' }
  | { source: 'zing'; type: 'cancel-palette-continuation' }
  | { source: 'zing'; type: 'read-page-storage'; payload: StorageRead }
  | { source: 'zing'; type: 'open-cookie-access'; payload: CookieAccessRequest }
  | { source: 'zing'; type: 'open-shortcuts' }
  | { source: 'zing'; type: 'reset-usage' }
  | { source: 'zing'; type: 'execute'; payload: Execution };
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };
export type IconName = 'extension' | 'password' | 'download' | 'history' | 'keyboard' | 'tab' | 'bookmark' | 'plus' | 'reload' | 'close' | 'others' | 'right' | 'restore' | 'pin' | 'volume' | 'settings' | 'database' | 'cookie' | 'script' | 'edit' | 'tuck';
export type SettingsSection = 'language' | 'theme' | 'keyboard' | 'ranking' | 'tabs';
export interface Entry {
  category?: 'tabGroup' | 'tab' | 'script' | 'storage' | 'settings' | 'chromePages' | 'zing';
  shortcut?: string;
  faviconPageUrl?: string;
  id: string;
  kind: 'command' | 'tab' | 'bookmark' | 'script';
  title: string;
  subtitle: string;
  keywords: string;
  icon: IconName;
  action: ActionId | 'settings' | StorageAction | 'copyScript' | 'editScript' | 'deleteScript' | 'newScript' | 'scriptLibrary' | 'runScript' | 'runCopyScript' | 'reviewTuck' | 'manageGroup';
  settingsSection?: SettingsSection;
  recoveryId?: string;
  groupId?: number;
  groupTitle?: string;
  groupCount?: number;
  groupColor?: chrome.tabGroups.TabGroup['color'];
  aliases?: string[];
  searchOnly?: boolean;
  scriptId?: string;
  tabId?: number;
  bookmarkId?: string;
  pinned?: boolean;
  muted?: boolean;
  active?: boolean;
  tucked?: boolean;
  canTuck?: boolean;
  danger?: boolean;
}
