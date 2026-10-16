import { t } from './i18n';
import type { Entry } from './types';

export function categoryLabel(category: NonNullable<Entry['category']>): string {
  return t(({ tabGroup: 'categoryTabGroup', tab: 'categoryTab', script: 'categoryScript', storage: 'categoryStorage', settings: 'categorySettings' } as const)[category]);
}
export function entryTitle(entry: Entry): string {
  return entry.category ? `${categoryLabel(entry.category)}: ${entry.title}` : entry.title;
}
export function categoryTerms(category?: Entry['category']): string {
  return category ? { tabGroup: 'tab group 标签组', tab: 'tab 标签页', script: 'script 脚本', storage: 'storage 存储', settings: 'settings 设置' }[category] : '';
}
/** A category prefix is searchable text, not a separate search mode. */
export function entrySearchQuery(query: string): string {
  return query.replace(/^(\s*(?:tab group|标签组|tab|script|storage|settings|标签页|脚本|存储|设置))\s*[:：]\s*/i, '$1 ');
}
