import type { HistorySearchResult } from './types';

export type HistoryQueryState = 'ready' | 'timeout' | 'error';
export interface HistoryQueryOutcome extends HistorySearchResult { state: HistoryQueryState }

/** The deadline covers messaging as well as Chrome's read; late replies cannot change this result. */
export function resolveHistoryQuery(request: Promise<HistorySearchResult>, deadline: number): Promise<HistoryQueryOutcome> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve({ items: [], limited: false, state: 'timeout' }), deadline);
    request.then(result => { clearTimeout(timer); resolve({ ...result, state: 'ready' }); },
      () => { clearTimeout(timer); resolve({ items: [], limited: false, state: 'error' }); });
  });
}
