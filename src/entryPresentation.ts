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
export const brandAliases = ['justonehop', 'just one hop', 'just-one-hop', 'joh', '小范围瞬移', '瞬移'];
const brandTerms = brandAliases.join(' ');
const brandPrefix = brandAliases.join('|');
const categoryPrefix = new RegExp(`^(\\s*(?:(?:${brandPrefix})(?:\\s+(?:settings|设置))?|chrome pages|chrome 内置页面|tab group|标签组|tab|storage|settings|标签页|存储|设置))\\s*[:：]\\s*`, 'i');

export function categoryTerms(category?: Entry['category']): string {
  return category ? { tabGroup: 'tab group 标签组', tab: 'tab 标签页', storage: 'storage 存储', settings: `${brandTerms} settings 设置`, chromePages: 'chrome pages chrome 内置页面 browser 浏览器', justonehop: brandTerms }[category] : '';
}
/** A category prefix is searchable text, not a separate search mode. */
export function entrySearchQuery(query: string): string {
  return query.replace(categoryPrefix, '$1 ');
}
