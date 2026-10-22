import type { Entry, Execution, SearchContinuation } from './types';

export const SEARCH_CONTINUATION_KEY = 'searchContinuation';
export const SEARCH_CONTINUATION_TTL = 10 * 60 * 1000;
const pageActions = new Set(['switch', 'openBookmark', 'openHistoryPage']);
let pending = Promise.resolve();

export function canContinueSearch(query: string, selected: Entry, results: Entry[]): boolean {
  if (!query.trim() || !pageActions.has(selected.action)) return false;
  const urls = new Set(results.filter(entry => !entry.disabled && pageActions.has(entry.action) && entry.url).map(entry => {
    try { return new URL(entry.url!).href; } catch { return entry.url; }
  }));
  return urls.size >= 2;
}

export function validContinuation(value: unknown, now = Date.now()): value is SearchContinuation {
  if (!value || typeof value !== 'object') return false;
  const record = value as SearchContinuation;
  return typeof record.query === 'string' && !!record.query.trim() && record.query.length <= 200 &&
    typeof record.target === 'string' && /^(tab|bookmark):.+/.test(record.target) &&
    Number.isFinite(record.at) && record.at <= now && record.at > now - SEARCH_CONTINUATION_TTL;
}

function update(change: (records: Record<string, SearchContinuation>) => void): Promise<void> {
  const next = pending.then(async () => {
    const storage = chrome.storage.session;
    const stored = (await storage.get(SEARCH_CONTINUATION_KEY))[SEARCH_CONTINUATION_KEY];
    const records = Object.fromEntries(Object.entries(stored && typeof stored === 'object' ? stored : {})
      .filter((entry): entry is [string, SearchContinuation] => validContinuation(entry[1])));
    change(records);
    await storage.set({ [SEARCH_CONTINUATION_KEY]: records });
  });
  pending = next.catch(() => {});
  return next;
}

export function recordSearchContinuation(payload: Execution, target: string): Promise<void> {
  // A successful private-window action returns an empty learning target.
  if (payload.continueSearch !== true || !pageActions.has(payload.action) || !Number.isInteger(payload.windowId)) return Promise.resolve();
  const record = { query: payload.query?.trim() ?? '', target, at: Date.now() };
  if (!validContinuation(record)) return Promise.resolve();
  return update(records => { records[String(payload.windowId)] = record; });
}

export async function getSearchContinuation(windowId: number): Promise<SearchContinuation | undefined> {
  await pending;
  const stored = (await chrome.storage.session.get(SEARCH_CONTINUATION_KEY))[SEARCH_CONTINUATION_KEY];
  const record = stored && typeof stored === 'object' ? (stored as Record<string, unknown>)[String(windowId)] : undefined;
  return validContinuation(record) ? record : undefined;
}

export function forgetSearchContinuations(targets?: ReadonlySet<string>, query?: string): Promise<void> {
  return update(records => {
    for (const [window, record] of Object.entries(records)) {
      if ((!targets || targets.has(record.target)) && (query === undefined || record.query.trim().toLowerCase().replace(/\s+/g, ' ') === query)) delete records[window];
    }
  });
}
