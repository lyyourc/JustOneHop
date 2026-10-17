import { labelUrl } from './model';
import type { Entry, HistoryPage } from './types';

export function historyEntries(pages: HistoryPage[]): Entry[] {
  return pages.map(page => ({
    id: `history:${page.id}`, kind: 'history', action: 'openHistoryPage', icon: 'history',
    title: page.title || page.url, subtitle: labelUrl(page.url), keywords: page.url,
    url: page.url, faviconPageUrl: page.url, lastVisitTime: page.lastVisitTime,
  }));
}

function normalizedUrl(entry: Entry): string | undefined {
  const raw = entry.url || entry.faviconPageUrl;
  if (!raw) return undefined;
  try { return new URL(raw).href; } catch { return raw; }
}

/** Pass matching base results; query strings and fragments remain part of identity. */
export function mergeHistoryResults(baseResults: Entry[], historyResults: Entry[]): Entry[] {
  const existing = new Set(baseResults.filter(entry => entry.kind === 'tab' || entry.kind === 'bookmark').map(normalizedUrl).filter(Boolean));
  return [...baseResults, ...historyResults.filter(entry => entry.kind !== 'history' || !existing.has(normalizedUrl(entry)))];
}
