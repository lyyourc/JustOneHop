import { t } from './i18n';
import type { Entry } from './types';

export function categoryLabel(category: NonNullable<Entry['category']>): string {
  return t(({ tabGroup: 'categoryTabGroup', tab: 'categoryTab', storage: 'categoryStorage', settings: 'categorySettings', chromePages: 'categoryChromePages', justonehop: 'categoryJustOneHop' } as const)[category]);
}
export function entryTitle(entry: Entry): string {
  if (entry.action === 'settings') {
    return entry.settingsSection ? t('settingsCommandTitle', [categoryLabel('settings'), entry.title]) : categoryLabel('settings');
  }
  return entry.category === 'justonehop' ? t('settingsCommandTitle', [categoryLabel(entry.category), entry.title])
    : entry.category ? `${categoryLabel(entry.category)}: ${entry.title}` : entry.title;
}
export function categoryTerms(category?: Entry['category']): string {
  return category ? { tabGroup: 'tab group 标签组', tab: 'tab 标签页', storage: 'storage 存储', settings: 'justonehop 小范围瞬移 settings 设置', chromePages: 'chrome pages chrome 内置页面 browser 浏览器', justonehop: 'justonehop 小范围瞬移' }[category] : '';
}
/** A category prefix is searchable text, not a separate search mode. */
export function entrySearchQuery(query: string): string {
  return query.replace(/^(\s*(?:(?:justonehop|小范围瞬移)(?:\s+(?:settings|设置))?|chrome pages|chrome 内置页面|tab group|标签组|tab|storage|settings|标签页|存储|设置))\s*[:：]\s*/i, '$1 ');
}
