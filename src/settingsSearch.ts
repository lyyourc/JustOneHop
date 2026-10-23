import english from '../public/_locales/en/messages.json';
import chinese from '../public/_locales/zh_CN/messages.json';
import type { MessageKey } from './i18n';
import { termMatches } from './searchMatch';

const fields = {
  language: ['appearance', 'language', 'systemLanguage', 'followSystem'],
  theme: ['appearance', 'theme', 'followSystem', 'lightTheme', 'darkTheme'],
  searchIcon: ['appearance', 'searchIcon', 'searchIconHint', 'searchIconChange', 'searchIconEmojiHint', 'searchIconImage', 'searchIconImageHint', 'searchIconUpload', 'searchIconDefault', 'searchIconDefaultHint', 'searchIconRestore'],
  help: ['help', 'helpHint', 'openHelp'],
  keyboard: ['keyboard', 'paletteHotkey', 'paletteHotkeyHint', 'hotkeyHint', 'changeHotkey'],
  binding: ['keyboard', 'ctrlTabSetting', 'bindingHint', 'bindCtrlTab', 'setUpShortcut'],
  tabs: ['settingsLabs', 'autoTuck', 'autoTuckHint', 'autoTuckOffHint', 'tuckRules', 'tuckAfter', 'tuckScheduleHint', 'tuckTimingHint', 'tuckProtectedHint'],
  ranking: ['settingsLabs', 'searchRanking', 'searchRankingHint', 'searchRankingResetHint', 'resetSearchRanking'],
} satisfies Record<string, MessageKey[]>;

export type SettingRow = keyof typeof fields;
export type SettingsCategory = 'appearance' | 'keyboard' | 'experimentalFeatures' | 'help';
export const settingsCategories: SettingsCategory[] = ['appearance', 'keyboard', 'experimentalFeatures', 'help'];
export const settingCategory: Record<SettingRow, SettingsCategory> = {
  language: 'appearance', help: 'help', theme: 'appearance', searchIcon: 'appearance',
  keyboard: 'keyboard', binding: 'keyboard', tabs: 'experimentalFeatures', ranking: 'experimentalFeatures',
};
const aliases: Record<SettingRow, string> = {
  searchIcon: 'badge 徽章 瞬移徽章 头像 avatar icon logo emoji image upload custom 图标 图片 上传 自定义 表情 外观',
  help: 'help user guide 帮助 使用说明 使用指南',
  language: 'English 简体中文 中文 英文', theme: 'light dark 外观 浅色 深色',
  keyboard: 'hotkey shortcut 快捷键', binding: 'ctrl tab Ctrl+Tab 切换',
  tabs: 'auto tuck 自动收起 页面始终保持打开 1 12 hours 小时 1 3 7 days 天 时长', ranking: 'search ranking 排序',
};
const searchable = Object.fromEntries(Object.entries(fields).map(([id, keys]) => [id,
  [...keys.flatMap(key => [english[key].message, chinese[key].message]), aliases[id as SettingRow]].join(' '),
])) as Record<SettingRow, string>;

export function matchingSettings(query: string): Set<SettingRow> {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  return new Set((Object.keys(fields) as SettingRow[]).filter(id =>
    terms.every(term => termMatches(searchable[id], term, false).length > 0)));
}
