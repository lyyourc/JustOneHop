import { categoryTerms, entrySearchQuery, entryTitle } from './entryPresentation';
import { t } from './i18n';
import { chromePages } from './chromePages';
import Fuse, { type Expression } from 'fuse.js';
import { termMatches } from './searchMatch';
import { usageTarget } from './usage';
import type { ActionId, ChromePageAction, Entry, Snapshot, TabItem } from './types';

export function labelUrl(raw: string): string {
  try { const url = new URL(raw); return (url.hostname || url.protocol.replace(':', '')) + (url.pathname === '/' ? '' : url.pathname); }
  catch { return raw; }
}

export function commands(current?: TabItem): Entry[] {
  const definitions: [ActionId, string, string, Entry['icon'], boolean?][] = [
    ['newTab', t('newTab'), 'new tab create xinjian 新建标签页', 'plus'],
    ['close', t('close'), 'close current tab guanbi 关闭当前标签页', 'close', true],
    ['closeOthers', t('closeOthers'), 'close other tabs guanbi qita 关闭其他标签页', 'others', true],
    ['closeRight', t('closeRight'), 'close tabs to the right guanbi youce 关闭右侧标签页', 'right', true],
    ['restore', t('restore'), 'reopen restore undo closed tab huifu 恢复关闭的标签页', 'restore'],
    ['reload', t('reload'), 'reload refresh shuaxin 刷新标签页', 'reload'],
    ['pin', current?.pinned ? t('unpin') : t('pin'), 'toggle guding 标签页', 'pin'],
    ['mute', current?.muted ? t('unmute') : t('mute'), 'sound audio jingyin 标签页', 'volume'],
  ];
  if (current?.canTuck) definitions.push(['tuck', t('tuck'), 'tuck away tab 收起 标签页', 'tuck']);
  return definitions.map(([action, title, keywords, icon, danger]) => ({
    id: `command:${action}`, kind: 'command', category: 'tab', title, keywords, icon, action, danger,
    aliases: action === 'pin' ? (current?.pinned
      ? ['unpin', 'unpin tab', '取消固定', '取消固定标签页']
      : ['pin', 'pin tab', '固定', '固定标签页']) : action === 'mute' ? (current?.muted
      ? ['unmute', 'unmute tab', '取消静音', '恢复声音']
      : ['mute', 'mute tab', '静音', '静音标签页', '关闭声音']) : undefined,
    shortcut: ({ newTab: 'Mod+T', close: 'Mod+W', restore: 'Mod+Shift+T', reload: 'Mod+R' } as Partial<Record<ActionId, string>>)[action],
    tabId: current?.id,
    searchOnly: action === 'tuck' || undefined,
    subtitle: action === 'newTab' ? t('newTabHint') : action === 'restore' ? t('restoreHint') :
      action === 'closeOthers' || action === 'closeRight' ? t('closeHint') : current?.title || t('currentTab'),
  }));
}

export function entries(snapshot: Snapshot): Entry[] {
  const groups = new Map((snapshot.groups || []).map(group => [group.id, group]));
  return [
    ...(snapshot.groups || []).map((group): Entry => ({
      id: `group:${group.id}`, kind: 'command', category: 'tabGroup', title: group.title, groupCount: snapshot.tabs.filter(tab => tab.groupId === group.id).length,
      subtitle: '', keywords: 'tab group 标签组', icon: 'others', action: 'manageGroup', searchOnly: true,
      groupId: group.id, groupColor: group.color,
    })),
    ...snapshot.tabs.map((tab): Entry => ({
      id: `tab:${tab.id}`, kind: 'tab', title: tab.title, subtitle: labelUrl(tab.url),
      groupTitle: groups.get(tab.groupId!)?.title, groupColor: groups.get(tab.groupId!)?.color,
      keywords: `${tab.url}${tab.tucked ? ' tucked away 已收起' : ''}`, faviconPageUrl: tab.url, icon: 'tab', action: 'switch', tabId: tab.id,
      active: tab.id === snapshot.currentTabId, pinned: tab.pinned, muted: tab.muted, tucked: tab.tucked, canTuck: tab.canTuck,
    })),
    ...snapshot.bookmarks.map((bookmark): Entry => ({
      id: `bookmark:${bookmark.id}`, kind: 'bookmark', title: bookmark.title,
      subtitle: labelUrl(bookmark.url), faviconPageUrl: bookmark.url, keywords: `${bookmark.url} ${bookmark.folder}`,
      icon: 'bookmark', action: 'openBookmark', bookmarkId: bookmark.id,
    })),
    ...(snapshot.tuckRecoveries || []).map((item): Entry => ({
      id: `recovery:${item.id}`, kind: 'command', category: 'tab', action: 'reviewTuck', icon: 'tuck',
      title: t('reviewTuck'), subtitle: `${item.title} — ${item.urls.length}`, recoveryId: item.id,
      keywords: '恢复 收起 继续管理 检查 分组 recover resume tuck group', aliases: ['recover tucked tabs', 'resume tuck', '继续管理', '恢复收起组'],
    })),
    ...commands(snapshot.tabs.find(tab => tab.id === snapshot.currentTabId)),
    { id: 'command:reloadExtension', kind: 'command', category: 'zing', action: 'reloadExtension', icon: 'reload',
      title: t('reloadExtension'), subtitle: t('reloadExtensionHint'), searchOnly: true,
      keywords: 'reload restart zing extension extention 重载 重新加载 重启 扩展',
      aliases: ['reload zing', 'reload zing extension', 'reload extension', 'reload zing extention', 'restart zing', '重载 zing', '重载扩展', '重新加载扩展', '重新加载 zing 扩展', '重启扩展'] },
    ...(Object.keys(chromePages) as ChromePageAction[]).map((action): Entry => {
      const page = chromePages[action];
      return { id: `command:${action}`, kind: 'command', category: 'chromePages', action, icon: page.icon,
        title: t(page.title), subtitle: page.url, keywords: page.url, aliases: [...page.aliases], searchOnly: true };
    }),
    ...(snapshot.canUndoTuck ? [{ id: 'command:undoTuck', kind: 'command' as const, category: 'tab' as const, action: 'undoTuck' as const,
      icon: 'restore' as const, title: t('undoTuck'), subtitle: '', keywords: 'undo tuck away 撤销 收起' }] : []),
    { id: 'command:runScript', kind: 'command', category: 'script', action: 'runScript', icon: 'script', title: t('runScript'), subtitle: '',
      keywords: 'javascript js 执行 运行 脚本', aliases: ['run script', 'execute script', '执行脚本', '运行脚本'], searchOnly: true },
    { id: 'command:runCopyScript', kind: 'command', category: 'script', action: 'runCopyScript', icon: 'script', title: t('runCopyScript'), subtitle: '',
      keywords: 'javascript js result 结果', aliases: ['run and copy result', 'run copy script', '运行并复制结果', '执行并复制'], searchOnly: true },
    { id: 'command:newScript', kind: 'command', category: 'script', action: 'newScript', icon: 'plus', title: t('newScript'), subtitle: '',
      keywords: 'javascript js snippet 脚本 代码 新增 添加', aliases: ['new script', 'create script', 'add script', '新建脚本', '添加脚本'], searchOnly: true },
    { id: 'command:scriptLibrary', kind: 'command', category: 'script', action: 'scriptLibrary', icon: 'script', title: t('manageScripts'), subtitle: '',
      keywords: 'scripts snippets javascript js 收藏 脚本', aliases: ['scripts', 'script library', 'manage scripts', '脚本', '脚本收藏', '管理脚本'], searchOnly: true },
    ...([
      ['language', 'changeLanguage', ['language', 'change language', 'English', '中文', '英文', '语言', '切换语言', '语言设置']],
      ['theme', 'changeTheme', ['theme', 'appearance', 'change theme', 'dark mode', 'light mode', '深色模式', '浅色模式', '主题', '外观', '换主题', '切换主题']],
      ['keyboard', 'keyboardShortcuts', ['hotkey', 'shortcut', 'keyboard shortcuts', '快捷键', '快捷键设置']],
      ['ranking', 'searchRanking', ['search ranking', 'reset search ranking', 'reset ranking', '搜索排序', '重置搜索排序', '重置排序', '清除排序', '使用习惯']],
      ['tabs', 'autoTuck', ['auto tuck tabs', 'auto tuck', 'automatic tuck', '自动收起闲置标签页', '自动收起', '收起设置']],
    ] as const).map(([settingsSection, title, aliases]): Entry => ({
      id: `command:settings:${settingsSection}`, kind: 'command', category: 'settings', action: 'settings', settingsSection, icon: 'settings',
      title: t(title), subtitle: '', keywords: '', aliases: [...aliases], searchOnly: true,
    })),
    ...(['localStorage', 'sessionStorage', 'cookies'] as const).map((action): Entry => ({
      id: `command:${action}`, kind: 'command', category: 'storage', action, icon: action === 'cookies' ? 'cookie' : 'database',
      title: t(action), subtitle: '', keywords: action === 'localStorage' ? 'local storage 本地存储' : action === 'sessionStorage' ? 'session storage 会话存储' : 'cookie cookies 浏览器 网站',
    })),
    {
      id: 'command:settings', kind: 'command', shortcut: 'Mod+,', action: 'settings', icon: 'settings',
      title: t('settings'), subtitle: t('settingsHint'), keywords: 'settings preferences language theme hotkey 设置 偏好 语言 主题 快捷键 shezhi',
    },
  ];
}

export function homeEntries(items: Entry[], usageScores: ReadonlyMap<string, number> = new Map()): Entry[] {
  const tabs = items.filter(item => item.kind === 'tab');
  const current = tabs.find(item => item.active);
  const recent = tabs.slice(0, 6);
  if (current && !recent.includes(current)) recent.splice(5, 1, current);
  return [
    ...recent,
    ...items.filter(item => item.kind === 'command' && !item.danger && !item.searchOnly)
      .sort((a, b) => (usageScores.get(usageTarget(b)) || 0) - (usageScores.get(usageTarget(a)) || 0)),
  ];
}

// Intent aliases are phrases, not the loose keyword bag. Keep them independent
// of the display language so an English command works equally well in Chinese.
const commandAliases: Partial<Record<Entry['action'], string[]>> = {
  newTab: ['new tab', 'open tab', 'open new tab', 'create tab', '新建标签页', '新标签页', '新建页面', '打开新标签页', '新建', 'xinjian'],
  close: ['close', 'close tab', 'close current tab', '关闭', '关闭标签页', '关闭当前标签页', 'guanbi'],
  closeOthers: ['close others', 'close other tabs', '关闭其他标签页', 'guanbi qita'],
  closeRight: ['close right', 'close tabs to the right', '关闭右侧标签页', 'guanbi youce'],
  restore: ['restore tab', 'reopen tab', 'reopen closed tab', 'reopen last tab', 'restore last closed tab', 'undo close tab', 'restore', 'reopen', '恢复关闭的标签页', '恢复标签页', '恢复上一个标签页', '重新打开', '重新打开关闭的标签页', '恢复', 'huifu'],
  reload: ['reload', 'refresh', 'reload tab', 'refresh tab', 'reload page', 'refresh page', 'refresh this page', '刷新标签页', '刷新页面', '重新加载页面', '刷新', 'shuaxin'],
  tuck: ['tuck away tab', 'tuck tab', '收起标签页', '收起'],
  undoTuck: ['undo tuck away', 'undo tuck', '撤销收起'],
  localStorage: ['local storage', 'localstorage', '查看本地存储', '本地存储'],
  sessionStorage: ['session storage', 'sessionstorage', '查看会话存储', '会话存储'],
  cookies: ['cookies', 'cookie', '查看 cookie', '查看 cookies'],
  settings: ['settings', 'open settings', 'preferences', '设置', '打开设置', '偏好设置', 'shezhi'],
};

const normalizeSearch = (value: string) => entrySearchQuery(value).trim().toLowerCase().replace(/\s+/g, ' ');
const pinyinAliases = new Set(['xinjian', 'guanbi', 'guanbi qita', 'guanbi youce', 'huifu', 'shuaxin', 'guding', 'jingyin', 'shezhi']);

/** Show a matching alias when the translated command title cannot explain the hit. */
export function matchingAlias(item: Entry, query: string): string {
  const normalized = normalizeSearch(query);
  if (item.kind !== 'command' || !normalized || normalizeSearch(entryTitle(item)).includes(normalized)) return '';
  const intent = entrySearchQuery(query) === query ? normalized : normalizeSearch(query.replace(/^[^:：]*[:：]\s*/, ''));
  if (!intent) return '';
  const aliases = item.aliases ?? commandAliases[item.action] ?? [];
  const terms = intent.split(/\s+/);
  return aliases.find(alias => normalizeSearch(alias).includes(intent)) ||
    aliases.find(alias => terms.every(term => normalizeSearch(alias).includes(term))) ||
    aliases.find(alias => terms.every(term => termMatches(alias, term, !pinyinAliases.has(alias)).length > 0)) || '';
}

/** A partial action word is intent; a substring of an unrelated word is not. */
function hasIntentPrefix(terms: string[], words: string[], minLength: number): boolean {
  return terms.some(term => term.length >= minLength && words.some(word => word.startsWith(term)));
}

// Reuse the normalized documents and Fuse index while the candidate array is
// unchanged. A language switch invalidates translated category labels too.
function buildSearchIndex(items: Entry[]) {
  // A command's subtitle names its target, not its intent. Searching a page title
  // must not surface every command that happens to act on that page.
  const index = items.map(item => {
    const title = normalizeSearch(item.title);
    const label = normalizeSearch(entryTitle(item));
    const aliases = item.kind === 'command' ? (item.aliases ?? commandAliases[item.action] ?? []).map(normalizeSearch) : [];
    // A service is often named by its domain while its page title is localized.
    // Rank that identity like a name; paths, query strings and folders remain
    // auxiliary metadata and still receive no typo tolerance.
    let hostname = '';
    if ((item.kind === 'tab' || item.kind === 'bookmark') && item.faviconPageUrl) {
      try { hostname = new URL(item.faviconPageUrl).hostname.toLowerCase().replace(/^www\./, ''); } catch { /* No domain identity. */ }
    }
    const names = [title, label, ...aliases, ...(hostname ? [hostname] : [])];
    return {
      kind: item.kind, pinned: item.kind === 'tab' && !!item.pinned, action: item.action, danger: item.danger, title, label, aliases, names,
      wordNames: names.map(name => name.split(/[^\p{L}\p{N}]+/u).join(' ')),
      categoryText: categoryTerms(item.category), keywords: normalizeSearch(`${item.keywords} ${item.groupTitle || ''}`),
      subtitle: item.kind === 'command' ? '' : normalizeSearch(item.subtitle),
    };
  });
  const fuse = new Fuse(index, {
    keys: [{ name: 'title', weight: 3 }, { name: 'label', weight: 3 }, { name: 'categoryText', weight: 1 }, { name: 'aliases', weight: 3 }, { name: 'keywords', weight: 1 }, { name: 'subtitle', weight: 0.5 }],
    threshold: 0.35, ignoreLocation: true, minMatchCharLength: 1, includeScore: true,
  });
  return { language: t('languageTag'), index, fuse };
}
const searchIndexes = new WeakMap<Entry[], ReturnType<typeof buildSearchIndex>>();

export function search(items: Entry[], query: string, usageScores: ReadonlyMap<string, number> = new Map()): Entry[] {
  const normalized = normalizeSearch(query);
  if (!normalized) return items;
  const terms = normalized.split(/\s+/);
  let prepared = searchIndexes.get(items);
  if (!prepared || prepared.language !== t('languageTag')) {
    prepared = buildSearchIndex(items);
    searchIndexes.set(items, prepared);
  }
  const { index, fuse } = prepared;
  const matches = fuse.search(terms.length === 1 ? terms[0] : {
    $and: terms.map((term): Expression => ({ $or: [{ title: term }, { label: term }, { categoryText: term }, { aliases: term }, { keywords: term }, { subtitle: term }] })),
  });
  const explicitClose = hasIntentPrefix(terms, ['close'], 3) || hasIntentPrefix(terms, ['guanbi'], 4) || normalized.includes('关闭');
  const tier = (item: typeof index[number]) => {
    const names = item.names;
    // Exact command intent beats even a web page with the same title. A longer
    // page query stops receiving this boost: "new tab guide" still finds its page.
    if (item.kind === 'command' && names.includes(normalized)) return 0;
    if (item.title === normalized) return 1;
    if (names.some(name => name.startsWith(normalized))) return 2;
    // Whole phrases lead; separate word prefixes work in either order too.
    if (item.wordNames.some(name => terms.every(term => name.startsWith(term) || name.includes(` ${term}`)))) return 3;
    if (names.some(name => terms.every(term => name.includes(term)))) return 4;
    if (terms.every(term => [...names, item.categoryText, item.keywords, item.subtitle].some(field => field.includes(term)))) return 5;
    // A typo of a complete command name is clearer than the same word buried
    // in a longer command ("setings": Settings before Chrome Settings).
    if (item.kind === 'command' && terms.length === 1 && /^[a-z]{4,}$/.test(normalized) &&
      [item.title, ...item.aliases].some(name => /^[a-z]+$/.test(name) && !pinyinAliases.has(name) &&
        Math.abs(name.length - normalized.length) <= 1 && termMatches(name, normalized).length > 0)) return 6;
    return 7;
  };
  const kindOrder = { tab: 0, bookmark: 1, command: 2, script: 3 };
  const explicitExtensionReload = terms.includes('zing') || hasIntentPrefix(terms, ['extension', 'extention'], 3) || normalized.includes('扩展');
  return matches.filter(({ item }) => (item.action !== 'reloadExtension' || explicitExtensionReload) &&
    (!item.danger || item.action === 'deleteScript' || explicitClose) && terms.every(term =>
    // Metadata is searchable, but must not manufacture typo matches. Only
    // visible names and natural-language command aliases receive typo tolerance.
    item.keywords.includes(term) || item.subtitle.includes(term) || item.categoryText.includes(term) ||
    item.title.includes(term) || termMatches(item.title, term).length > 0 || item.aliases.some(alias =>
      termMatches(alias, term, !pinyinAliases.has(alias)).length > 0)))
    .map(result => ({ ...result, tier: tier(result.item), usage: usageScores.get(usageTarget(items[result.refIndex])) || 0,
      // More aliases should improve discovery, not multiply a command's rank.
      nameLength: result.item.kind === 'command'
        ? Math.min(Infinity, ...result.item.names.filter(name => terms.every(term => name.includes(term))).map(name => name.length)) : Infinity,
    }))
    // Habits only reorder equally relevant results. Prefer a pinned/open tab
    // before incidental Fuse scores from URL length or duplicate title/URL hits.
    .sort((a, b) => a.tier - b.tier || b.usage - a.usage ||
      Number(b.item.kind === 'command') - Number(a.item.kind === 'command') ||
      Number(b.item.pinned) - Number(a.item.pinned) ||
      kindOrder[a.item.kind] - kindOrder[b.item.kind] ||
      (a.item.kind === 'command' && b.item.kind === 'command' ? a.nameLength - b.nameLength : 0) ||
      (a.tier > 1 ? (a.score ?? 1) - (b.score ?? 1) : 0) || a.refIndex - b.refIndex)
    .map(result => items[result.refIndex]);
}

export function actionsFor(entry: Entry, snapshot: Snapshot): Entry[] {
  if (entry.kind === 'script') {
    const builtin = entry.scriptId === 'builtin-ctrl-tab';
    return [
      ...(!builtin ? [
        { ...entry, action: 'runScript' as const, title: t('runScript'), subtitle: '', keywords: 'run execute 运行 执行' },
        { ...entry, id: `${entry.id}:runCopy`, action: 'runCopyScript' as const, title: t('runCopyScript'), subtitle: '', keywords: 'run copy result 运行 复制 结果' },
      ] : []),
      { ...entry, id: `${entry.id}:copy`, action: 'copyScript', title: t('copyScript'), subtitle: '', keywords: 'copy code 复制代码' },
      { ...entry, id: `${entry.id}:edit`, action: 'editScript', icon: 'edit', title: t(builtin ? 'viewScriptSetup' : 'editScript'), subtitle: '', keywords: builtin ? 'view setup 设置 说明' : 'edit 修改 编辑' },
      ...(!builtin ? [{ ...entry, id: `${entry.id}:delete`, action: 'deleteScript' as const, icon: 'close' as const, title: t('deleteScript'), subtitle: '', keywords: 'delete remove 删除', danger: true }] : []),
    ];
  }
  if (entry.kind === 'command') return [entry];
  if (entry.kind === 'bookmark') return [{ ...entry, title: t('openNewTab'), subtitle: entry.title, keywords: `${entry.keywords} open new tab 在新标签页打开` }];
  const tab = snapshot.tabs.find(item => item.id === entry.tabId);
  const available = commands(tab).filter(command => ['close', 'pin', 'mute', 'reload', 'closeOthers', 'closeRight', 'tuck'].includes(command.action));
  return [{ ...entry, title: t('switchTab'), subtitle: entry.title, keywords: `${entry.keywords} switch tab 切换标签页` }, ...available.map(command => ({
    ...command, shortcut: tab?.id === snapshot.currentTabId ? command.shortcut : undefined, title: command.title.replace(t('current'), ''), id: `action:${command.action}`, tabId: entry.tabId,
  }))];
}

export function closeTargets(tabs: TabItem[], target: TabItem, action: 'closeOthers' | 'closeRight'): TabItem[] {
  return tabs.filter(tab => tab.windowId === target.windowId && tab.id !== target.id && !tab.pinned &&
    (action === 'closeOthers' || tab.index > target.index));
}
