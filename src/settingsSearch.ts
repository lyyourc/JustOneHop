import english from '../public/_locales/en/messages.json';
import chinese from '../public/_locales/zh_CN/messages.json';
import type { MessageKey } from './i18n';
import { termMatches } from './searchMatch';

const fields = {
  language: ['general', 'preferences', 'language', 'languageHint', 'systemLanguage', 'followSystem'],
  theme: ['general', 'preferences', 'appearance', 'theme', 'themeHint', 'followSystem', 'lightTheme', 'darkTheme'],
  help: ['general', 'help', 'helpHint', 'openHelp'],
  keyboard: ['keyboard', 'keyboardShortcuts', 'paletteHotkey', 'hotkeyHint', 'changeHotkey'],
  binding: ['keyboard', 'keyboardShortcuts', 'ctrlTabSetting', 'bindingHint', 'bindCtrlTab', 'setUpShortcut'],
  tabs: ['experimentalFeatures', 'autoTuck', 'autoTuckHint', 'autoTuckOffHint'],
  ranking: ['experimentalFeatures', 'searchRanking', 'searchRankingHint', 'resetSearchRanking'],
  scripts: ['experimentalFeatures', 'scriptLibrary', 'scriptLibraryHint', 'manageScripts'],
} satisfies Record<string, MessageKey[]>;

export type SettingRow = keyof typeof fields;
const aliases: Record<SettingRow, string> = {
  help: 'help user guide 帮助 使用说明 使用指南',
  language: 'English 简体中文 中文 英文', theme: 'light dark 外观 浅色 深色',
  keyboard: 'hotkey shortcut 快捷键', binding: 'ctrl tab Ctrl+Tab 切换',
  tabs: 'auto tuck 自动收起 页面始终保持打开', ranking: 'search ranking 排序', scripts: 'userscript scripts 脚本',
};
const searchable = Object.fromEntries(Object.entries(fields).map(([id, keys]) => [id,
  [...keys.flatMap(key => [english[key].message, chinese[key].message]), aliases[id as SettingRow]].join(' '),
])) as Record<SettingRow, string>;

export function matchingSettings(query: string): Set<SettingRow> {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  return new Set((Object.keys(fields) as SettingRow[]).filter(id =>
    terms.every(term => termMatches(searchable[id], term, false).length > 0)));
}
