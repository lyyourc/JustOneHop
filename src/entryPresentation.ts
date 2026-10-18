import { t } from './i18n';
import type { Entry } from './types';

export function categoryLabel(category: NonNullable<Entry['category']>): string {
  return t(({ tabGroup: 'categoryTabGroup', tab: 'categoryTab', storage: 'categoryStorage', settings: 'categorySettings', chromePages: 'categoryChromePages', zing: 'categoryZing' } as const)[category]);
}
export function entryTitle(entry: Entry): string {
  if (entry.action === 'settings') {
    return entry.settingsSection ? t('settingsCommandTitle', [categoryLabel('settings'), entry.title]) : categoryLabel('settings');
  }
  return entry.category ? `${categoryLabel(entry.category)}: ${entry.title}` : entry.title;
}
export function categoryTerms(category?: Entry['category']): string {
  return category ? { tabGroup: 'tab group 标签组', tab: 'tab 标签页', storage: 'storage 存储', settings: 'zing settings 设置', chromePages: 'chrome pages chrome 内置页面 browser 浏览器', zing: 'zing' }[category] : '';
}
/** A category prefix is searchable text, not a separate search mode. */
export function entrySearchQuery(query: string): string {
  return query.replace(/^(\s*(?:zing(?:\s+(?:settings|设置))?|chrome pages|chrome 内置页面|tab group|标签组|tab|storage|settings|标签页|存储|设置))\s*[:：]\s*/i, '$1 ');
}
