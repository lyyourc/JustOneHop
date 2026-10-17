import { t } from './i18n';
import type { Reply, Request, Snapshot, PaletteState, Execution, StorageRead, PageStorage, CookieAccessRequest, ScriptRun, ScriptResult, HistorySearchResult } from './types';

async function send<T>(request: Request): Promise<T> {
  const reply = await chrome.runtime.sendMessage<Request, Reply<T>>(request);
  if (!reply?.ok) throw new Error(reply?.error || t('errorDisconnected'));
  return reply.data;
}
export const getSnapshot = () => send<Snapshot>({ source: 'zing', type: 'snapshot' });
export const searchHistory = (query: string, scope: 'week' | 'all') => send<HistorySearchResult>({ source: 'zing', type: 'search-history', payload: { query, scope } });
export const getPaletteState = () => send<PaletteState | undefined>({ source: 'zing', type: 'palette-state' });
export const cancelPaletteContinuation = () => send<void>({ source: 'zing', type: 'cancel-palette-continuation' });
export const execute = (payload: Execution) => send<void>({ source: 'zing', type: 'execute', payload });

export const openShortcuts = () => send<void>({ source: 'zing', type: 'open-shortcuts' });
export const resetSearchRanking = () => send<void>({ source: 'zing', type: 'reset-usage' });

export const readPageStorage = (payload: StorageRead) => send<PageStorage>({ source: 'zing', type: 'read-page-storage', payload });

export const openCookieAccess = (payload: CookieAccessRequest) => send<void>({ source: 'zing', type: 'open-cookie-access', payload });

export const runSavedScript = (payload: ScriptRun) => send<ScriptResult>({ source: 'zing', type: 'run-saved-script', payload });
export const openScriptSettings = () => send<void>({ source: 'zing', type: 'open-script-settings' });
