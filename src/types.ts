export type ChromePageAction = 'openExtensions' | 'openPasswords' | 'openDownloads' | 'openHistory' | 'openBookmarks' | 'openChromeSettings' | 'openExtensionShortcuts';
export type ActionId = ChromePageAction | 'switch' | 'bookmarkTab' | 'unbookmarkTab' | 'removeBookmark' | 'openBookmark' | 'openHistoryPage' | 'newTab' | 'navigateAddress' | 'openAddressNewTab' | 'reload' | 'reloadExtension' | 'close' | 'closeOthers' | 'closeRight' | 'restore' | 'pin' | 'mute' | 'tuck' | 'undoTuck' | 'resumeTuck' | 'forgetTuckRecovery' | 'updateGroup' | 'ungroupTab' | 'ungroupGroup' | 'closeGroup';

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
export interface BookmarkItem { id: string; title: string; url: string; folder: string; unmodifiable?: 'managed' }
export interface HistoryPage { id: string; url: string; title: string; lastVisitTime: number }
export interface HistorySearchResult { items: HistoryPage[]; limited: boolean }
export interface TuckStatus {
  enabled: boolean;
  eligibleCount: number;
  blockedCount: number;
  notDueCount: number;
  protectedCount: number;
  waitingReason: 'active' | 'grace' | 'scheduled';
  checkedAt: number;
  lastScanAt?: number;
  lastFailureAt?: number;
  pendingReleaseCount?: number;
}
export interface TuckRecoveryItem {
  id: string; title: string; urls: string[];
  candidates: { id: number; windowId: number; title: string; fingerprint: string;
    tabs: { id: number; title: string; url: string }[] }[];
}
export interface TabGroupItem { id: number; windowId: number; title: string; color: chrome.tabGroups.TabGroup['color']; collapsed: boolean }
export interface SearchContinuation { query: string; target: string; at: number }
export interface Snapshot {
  searchContinuation?: SearchContinuation;
  incognito?: boolean;
  groups?: TabGroupItem[];
  windowId: number;
  currentTabId: number;
  tabs: TabItem[];
  bookmarks: BookmarkItem[];
  shortcut: string;
  tabSwitcherShortcut?: string;
  canUndoTuck?: boolean;
  tuckRecoveries?: TuckRecoveryItem[];
}
export interface PaletteState {
  query: string;
  selection: string | null;
  caret: [number, number];
  group?: { id: number; query: string; selection: string | null; caret: [number, number] };
}
export interface ExecutionOutcome { message?: string }
export interface Execution {
  continueSearch?: boolean;
  paletteState?: PaletteState;
  action: ActionId | 'settings';
  settingsSection?: SettingsSection;
  windowId: number;
  tabId?: number;
  bookmarkId?: string;
  newTab?: boolean;
  expectedUrl?: string;
  bookmarkIds?: string[];
  url?: string;
  query?: string;
  recoveryId?: string;
  groupId?: number;
  fingerprint?: string;
  groupChanges?: { title?: string; color?: chrome.tabGroups.TabGroup['color']; collapsed?: boolean };
  groupTabIds?: number[];
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
export type Request =
  | { source: 'justonehop'; type: 'snapshot' }
  | { source: 'justonehop'; type: 'tuck-status'; afterHours?: number }
  | { source: 'justonehop'; type: 'search-history'; payload: { query: string; scope: 'week' | 'all' } }
  | { source: 'justonehop'; type: 'palette-state' }
  | { source: 'justonehop'; type: 'cancel-palette-continuation' }
  | { source: 'justonehop'; type: 'read-page-storage'; payload: StorageRead }
  | { source: 'justonehop'; type: 'open-cookie-access'; payload: CookieAccessRequest }
  | { source: 'justonehop'; type: 'open-shortcuts'; preserveBindingGuide?: boolean }
  | { source: 'justonehop'; type: 'open-help-url'; url?: string }
  | { source: 'justonehop'; type: 'reset-usage' }
  | { source: 'justonehop'; type: 'forget-usage'; payload: { target: string | string[]; query?: string } }
  | { source: 'justonehop'; type: 'execute'; payload: Execution };
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };
export type IconName = 'search' | 'copy' | 'help' | 'extension' | 'password' | 'download' | 'history' | 'keyboard' | 'tab' | 'bookmark' | 'plus' | 'reload' | 'close' | 'others' | 'right' | 'restore' | 'pin' | 'volume' | 'settings' | 'database' | 'cookie' | 'tuck';
export type SettingsSection = 'language' | 'theme' | 'keyboard' | 'binding' | 'ranking' | 'tabs';
export interface Entry {
  category?: 'tabGroup' | 'tab' | 'storage' | 'settings' | 'chromePages' | 'justonehop';
  shortcut?: string;
  faviconPageUrl?: string;
  url?: string;
  lastVisitTime?: number;
  id: string;
  kind: 'command' | 'tab' | 'bookmark' | 'history';
  title: string;
  subtitle: string;
  keywords: string;
  icon: IconName;
  action: ActionId | 'copyUrl' | 'settings' | 'help' | 'tabSwitcher' | 'searchAllHistory' | StorageAction | 'reviewTuck' | 'manageGroup' | 'renameGroup';
  settingsSection?: SettingsSection;
  recoveryId?: string;
  groupId?: number;
  groupTitle?: string;
  groupCount?: number;
  groupChanges?: Execution['groupChanges'];
  groupTabIds?: number[];
  groupColor?: chrome.tabGroups.TabGroup['color'];
  aliases?: string[];
  searchOnly?: boolean;
  tabId?: number;
  bookmarkId?: string;
  newTab?: boolean;
  expectedUrl?: string;
  bookmarkIds?: string[];
  pinned?: boolean;
  muted?: boolean;
  active?: boolean;
  tucked?: boolean;
  canTuck?: boolean;
  danger?: boolean;
  disabled?: boolean;
}
