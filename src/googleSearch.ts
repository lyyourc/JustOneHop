import { addressEntry } from './addressPresentation';
import { t } from './i18n';
import { isHistorySearchIntent } from './historyPresentation';
import type { Entry, Snapshot } from './types';

export interface GoogleSearch { entry: Entry; explicit: boolean }

export function googleSearchEntry(query: string, data: Snapshot): GoogleSearch | undefined {
  const input = query.trim();
  if (!input) return;
  const prefix = /^(?:(?:search\s+(?:in\s+)?google|google)|谷歌搜索|在\s*google\s*搜索)\s+(.+)$/isu.exec(input);
  const terms = prefix ? prefix[1].trim() : input;
  const url = new URL('https://www.google.com/search');
  url.searchParams.set('q', terms);
  const entry = addressEntry(url.href, data);
  if (!entry) return;
  return { explicit: !!prefix, entry: { ...entry, id: `google:${url.href}`, icon: 'search',
    title: t('searchGoogleFor', terms), keywords: terms } };
}

/** Reserve a visible slot without changing local relevance or the history shortcut. */
export function insertGoogleSearch(results: Entry[], google: GoogleSearch | undefined, limit = 100): Entry[] {
  if (!google) return results.slice(0, limit);
  const visible = results.slice(0, limit - 1);
  return google.explicit || (!isHistorySearchIntent(google.entry.keywords) && !visible.some(entry => entry.action !== 'searchAllHistory'))
    ? [google.entry, ...visible] : [...visible, google.entry];
}
