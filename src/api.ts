import { t } from './i18n';
import type { Reply, Request, Snapshot, PaletteState, Execution, StorageRead, PageStorage, CookieAccessRequest, HistorySearchResult, TuckStatus } from './types';

async function send<T>(request: Request): Promise<T> {
  const reply = await chrome.runtime.sendMessage<Request, Reply<T>>(request);
  if (!reply?.ok) throw new Error(reply?.error || t('errorDisconnected'));
  return reply.data;
}
export const getSnapshot = () => send<Snapshot>({ source: 'justonehop', type: 'snapshot' });
export const getTuckStatus = (afterHours?: number): Promise<TuckStatus> => send<TuckStatus>({ source: 'justonehop', type: 'tuck-status', afterHours });
export const searchHistory = (query: string, scope: 'week' | 'all') => send<HistorySearchResult>({ source: 'justonehop', type: 'search-history', payload: { query, scope } });
export const getPaletteState = () => send<PaletteState | undefined>({ source: 'justonehop', type: 'palette-state' });
export const cancelPaletteContinuation = () => send<void>({ source: 'justonehop', type: 'cancel-palette-continuation' });
export const execute = (payload: Execution) => send<void>({ source: 'justonehop', type: 'execute', payload });

export const openShortcuts = (preserveBindingGuide = false) => send<void>({ source: 'justonehop', type: 'open-shortcuts', preserveBindingGuide });
export const resetSearchRanking = () => send<void>({ source: 'justonehop', type: 'reset-usage' });
export const forgetSearchRanking = (target: string | string[], query?: string) => send<void>({ source: 'justonehop', type: 'forget-usage', payload: { target, query } });

export const readPageStorage = (payload: StorageRead) => send<PageStorage>({ source: 'justonehop', type: 'read-page-storage', payload });

export const openCookieAccess = (payload: CookieAccessRequest) => send<void>({ source: 'justonehop', type: 'open-cookie-access', payload });
