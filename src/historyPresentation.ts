import { t } from './i18n';
import type { Entry } from './types';
import type { HistoryQueryOutcome } from './historyQuery';

const historyIntents = new Set(['history', 'browsing history', 'search history', 'search all history', '历史', '历史记录', '浏览历史', '浏览记录', '搜索历史', '搜索全部历史']);
export function isHistorySearchIntent(query: string): boolean {
  return historyIntents.has(query.trim().toLowerCase().replace(/\s+/g, ' '));
}

export function historySearchEntry(outcome: HistoryQueryOutcome, query = ''): Entry {
  const hint = isHistorySearchIntent(query) ? 'historyExpandHint' : outcome.state === 'timeout' ? 'historyTimeoutHint' : outcome.state === 'error' ? 'historyErrorHint'
    : outcome.limited ? 'historyLimitedHint' : outcome.items.length ? 'historyExpandHint' : 'historyEmptyHint';
  return { id: 'search-all-history', kind: 'command', action: 'searchAllHistory', icon: 'history',
    title: t('searchAllHistory'), subtitle: t(hint), keywords: 'search all history 搜索全部历史' };
}

/** A navigation action has a stable slot, independent of relevance and learned ranking. */
export function insertHistorySearch(results: Entry[], entry: Entry, query = ''): Entry[] {
  const visible = results.slice(0, 99);
  visible.splice(isHistorySearchIntent(query) ? 0 : Math.min(6, visible.length), 0, entry);
  return visible;
}
