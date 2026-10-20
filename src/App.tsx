import { SearchResultItem, EntryGlyph as Glyph } from './SearchResultItem';
import { HistoryView } from './HistoryView';
import { BookmarkConfirmation, type BookmarkRemoval } from './BookmarkConfirmation';
import { PaletteTabSwitcher } from './PaletteTabSwitcher';
import { useHistoryQuery } from './useHistoryQuery';
import { historyEntries, mergeHistoryResults } from './historySearch';
import { historySearchEntry, insertHistorySearch, isHistorySearchIntent } from './historyPresentation';
import { TabGroupView } from './TabGroupView';
import { GroupConfirmation } from './GroupConfirmation';
import { keepsPaletteOpen } from './paletteActions';
import { useResultSelection } from './useResultSelection';
import { TuckRecoveryView } from './TuckRecoveryView';
import { Favicon } from './Favicon';
import { NavigationHint, matchesShortcut, shortcutKeys } from './Shortcut';
import { addressEntry, addressActions, isPageNavigation, pageNavigationEntry } from './addressPresentation';
import { addressNewTabShortcut } from './address';
import { googleSearchEntry, insertGoogleSearch } from './googleSearch';
import { NavigationRoot, BackLayer } from './Navigation';
import { SearchFocusButton } from './SearchFocusButton';
import { SearchDismissButton } from './SearchDismissButton';
import { PaletteFooter } from './PaletteFooter';
import { ActionMenu } from './ActionMenu';
import { t, countMessage, errorMessage } from './i18n';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { LoaderCircle, Search, AlertCircle, ExternalLink } from 'lucide-react';
import { getPreferences, subscribePreferences } from './preferences';
import { getUsage, subscribeUsage, usageReady } from './usageState';
import { homeUsage, queryUsage, rankingInfo, usageTarget, type RankingInfo } from './usage';
import { StorageView } from './StorageView';
import { BindingGuide } from './BindingGuide';
import { copyText } from './clipboard';
import { Settings } from './Settings';
import { HelpView } from './HelpView';
import { cancelPaletteContinuation, execute, forgetSearchRanking, getSnapshot } from './api';
import { actionsFor, closeTargets, entries, homeRecommendations, matchingAlias, search } from './model';
import type { Entry, Snapshot, StorageRead, SettingsSection, PaletteState, Execution } from './types';

const emptyScores: ReadonlyMap<string, number> = new Map();

export function App({ mode, onClose, initialState, initialBinding = false }: { mode: 'overlay' | 'popup'; onClose: () => void; initialState?: PaletteState; initialBinding?: boolean }) {
  const preferences = useSyncExternalStore(subscribePreferences, getPreferences);
  const [notice, setNotice] = useState('');
  const [frozenRanking, setFrozenRanking] = useState<{ query: string; scores: ReadonlyMap<string, number> } | null>(null);
  const [groupId, setGroupId] = useState<number | undefined>(initialState?.group?.id);
  const [groupEditor, setGroupEditor] = useState<'name'>();
  const [groupRemoval, setGroupRemoval] = useState<Entry | null>(null);
  const [recoveryId, setRecoveryId] = useState<string>();
  const usage = useSyncExternalStore(subscribeUsage, getUsage);
  const [homeSession, setHomeSession] = useState<{ sourceId: number; scores: ReadonlyMap<string, number> } | null>(null);
  const [storage, setStorage] = useState<StorageRead | null>(null);
  const [bindingOpen, setBindingOpen] = useState(initialBinding);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>();
  const [bookmarkRemoval, setBookmarkRemoval] = useState<BookmarkRemoval | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [tabSwitcherOpen, setTabSwitcherOpen] = useState(false);
  const [data, setData] = useState<Snapshot | null>(null);
  const [showLoading, setShowLoading] = useState(false);
  const [query, setQuery] = useState(initialState?.query ?? '');
  const [actionTarget, setActionTarget] = useState<Entry | null>(null);
  const [actionQuery, setActionQuery] = useState('');
  const [actionSelection, setActionSelection] = useState('');
  const [error, setError] = useState('');
  const [localBusy, setBusy] = useState(false);
  const [executionBusy, setExecutionBusy] = useState(false);
  const busy = localBusy || executionBusy;
  const input = useRef<HTMLInputElement>(null);
  const savedCaret = useRef<[number, number]>(initialState?.caret ?? [0, 0]);
  const executing = useRef(false);
  const refreshVersion = useRef(0);
  const mounted = useRef(true);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? '⌘' : 'Ctrl';
  const items = useMemo(() => data ? entries(data).map(entry => pageNavigationEntry(entry, data)) : [], [data, preferences.language]);
  const history = useHistoryQuery(query, 'week', !!data && !data.incognito);
  const committed = useRef<{ query: string; results: Entry[]; visible: Entry[]; ranking: Map<string, RankingInfo> }>({ query: '', results: [], visible: [], ranking: new Map() });
  const liveHomeScores = useMemo(() => data?.incognito ? emptyScores : homeUsage(usage), [usage, data?.incognito]);
  const liveScores = useMemo(() => data?.incognito ? emptyScores : query.trim() ? queryUsage(usage, query) : liveHomeScores, [usage, query, data?.incognito, liveHomeScores]);
  // Home habits are captured once per source session; live browser data still refreshes.
  const homeScores = homeSession && homeSession.sourceId === data?.currentTabId ? homeSession.scores : emptyScores;
  const scores = query.trim() ? (frozenRanking?.query === query ? frozenRanking.scores : liveScores) : homeScores;
  const homeItems = useMemo(() => data && !data.incognito
    ? [...items, historySearchEntry({ items: [], limited: false, state: 'ready' }, 'history')] : items, [items, data?.incognito]);
  const recommendations = useMemo(() => homeRecommendations(homeItems, homeScores), [homeItems, homeScores]);
  const liveRecommendations = useMemo(() => homeRecommendations(homeItems, liveHomeScores), [homeItems, liveHomeScores]);
  const next = useMemo(() => {
    if (!query.trim()) return recommendations;
    const candidates = mergeHistoryResults(search(items, query), historyEntries(history.outcome.items).map(entry => data ? pageNavigationEntry(entry, data) : entry));
    const baseline = search(candidates, query);
    const results = scores.size ? search(candidates, query, scores) : baseline;
    return { results, baseline };
  }, [items, query, scores, history.outcome, recommendations, data]);
  const address = useMemo(() => data ? addressEntry(query, data, next.results) : undefined, [query, data, next.results, preferences.language]);
  const nextResults = useMemo(() => address ? [address, ...next.results] : next.results, [address, next.results]);
  const nextRanking = useMemo(() => rankingInfo(nextResults, address ? [address, ...next.baseline] : next.baseline, query.trim() ? liveScores : liveRecommendations.scores), [nextResults, address, next, liveScores, liveRecommendations, query]);
  const google = useMemo(() => data ? googleSearchEntry(query, data) : undefined, [query, data, preferences.language]);
  const nextVisible = !query.trim() ? nextResults.slice(0, 10) : insertGoogleSearch(
    data && !data.incognito ? insertHistorySearch(nextResults, historySearchEntry(history.outcome, query), query) : nextResults, google);
  const results = history.pending ? committed.current.results : nextResults;
  const visible = history.pending ? committed.current.visible : nextVisible;
  const displayQuery = history.pending ? committed.current.query : query;
  const ranking = history.pending ? committed.current.ranking : nextRanking;
  useLayoutEffect(() => { if (!history.pending) committed.current = { query, results: nextResults, visible: nextVisible, ranking: nextRanking }; });
  const resultBusy = busy || history.pending;
  const grouped = !displayQuery.trim();
  const { selected, selection, setSelection } = useResultSelection(visible, displayQuery, data?.currentTabId, initialState?.selection);
  const liveTarget = actionTarget && [...items, ...visible].find(item => item.id === actionTarget.id);
  const actionItems = useMemo(() => {
    if (!data || !liveTarget) return [];
    const actions = (liveTarget.action === 'navigateAddress' ? addressActions(liveTarget, isMac) : actionsFor(liveTarget, data, isMac))
      .sort((a, b) => Number(a.action.startsWith('close')) - Number(b.action.startsWith('close')));
    return actions;
  }, [data, liveTarget, preferences.language]);
  const actions = useMemo(() => search(actionItems, actionQuery), [actionItems, actionQuery]);
  const selectedAction = actions.find(item => item.id === actionSelection) || actions[0];
  const loading = !data && !error;
  const [settled, setSettled] = useState(mode !== 'overlay');

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (settled) return;
    const timer = setTimeout(() => setSettled(true), 200);
    return () => clearTimeout(timer);
  }, [settled]);

  useEffect(() => {
    setShowLoading(false);
    if (!loading) return;
    // Avoid flashing a spinner for normal, fast reads. Each retry gets its own delay.
    const timer = setTimeout(() => setShowLoading(true), 150);
    return () => clearTimeout(timer);
  }, [loading]);

  async function refreshSnapshot() {
    const version = ++refreshVersion.current;
    try {
      const [value] = await Promise.all([getSnapshot(), usageReady]);
      if (mounted.current && version === refreshVersion.current) {
        setHomeSession(previous => previous?.sourceId === value.currentTabId ? previous : {
          sourceId: value.currentTabId, scores: value.incognito ? emptyScores : homeUsage(getUsage()),
        });
        setData(value);
      }
    } catch (reason) {
      if (mounted.current && version === refreshVersion.current) throw reason;
    }
  }
  async function executeAction(execution: Execution) {
    if (executing.current) throw new Error(t('running'));
    executing.current = true;
    setExecutionBusy(true); setError('');
    refreshVersion.current++;
    try {
      try { await execute(execution); }
      catch (reason) {
        await refreshSnapshot().catch(() => {});
        if (mounted.current) setError(errorMessage(reason));
        throw reason;
      }
      if (execution.action !== 'settings' && data && keepsPaletteOpen(execution.action, execution.tabId, data.currentTabId)) {
        await refreshSnapshot().catch(() => { if (mounted.current) setError(t('errorRefreshAfterAction')); });
      }
    } finally { executing.current = false; setExecutionBusy(false); }
  }
  function dismiss() {
    void cancelPaletteContinuation().catch(() => {});
    onClose();
  }
  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      if (executing.current) return;
      void refreshSnapshot().catch(reason => { if (mounted.current && !executing.current) setError(errorMessage(reason)); });
    };
    const changed = () => { clearTimeout(timer); timer = setTimeout(refresh, 100); };
    refresh();
    const focusWindow = () => refresh();
    window.addEventListener('focus', focusWindow);
    input.current?.focus();
    input.current?.setSelectionRange(...savedCaret.current);
    // Content scripts only have runtime access; updates are forwarded by the worker.
    const listener = (message: { source?: string; type?: string }) => {
      if (message.source === 'justonehop' && message.type === 'changed') changed();
    };
    const port = chrome.runtime.connect({ name: 'justonehop' });
    port.onMessage.addListener(listener);
    return () => { mounted.current = false; refreshVersion.current++; clearTimeout(timer); port.disconnect(); window.removeEventListener('focus', focusWindow); };
  }, []);

  useEffect(() => {
    if (frozenRanking && frozenRanking.query !== query) setFrozenRanking(null);
  }, [frozenRanking, query]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected?.id, nextResults, actionTarget, settingsOpen, helpOpen, historyOpen, tabSwitcherOpen, storage, bindingOpen, recoveryId, groupId]);
  useLayoutEffect(() => {
    if (busy || settingsOpen || helpOpen || historyOpen || tabSwitcherOpen || bindingOpen || recoveryId || groupId !== undefined) return;
    if (bookmarkRemoval || groupRemoval) return;
    if (!actionTarget) { input.current?.focus(); input.current?.setSelectionRange(...savedCaret.current); }
  }, [actionTarget, settingsOpen, helpOpen, historyOpen, tabSwitcherOpen, storage, bindingOpen, bookmarkRemoval, groupRemoval, recoveryId, groupId, busy]);

  function openSettings(section?: SettingsSection) {
    if (busy || settingsOpen || helpOpen || historyOpen || tabSwitcherOpen || bindingOpen) return;
    if (!actionTarget) savedCaret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
    closeActions(); setSettingsSection(section); setSettingsOpen(true); setError('');
  }
  function closeActions() { setActionTarget(null); setActionQuery(''); setActionSelection(''); }
  useEffect(() => { if (actionTarget && !liveTarget && !busy) closeActions(); }, [actionTarget, liveTarget, busy]);
  function paletteState(): PaletteState { return { query, selection, caret: savedCaret.current }; }
  function toggleActions() {
    if (resultBusy) return;
    if (actionTarget) closeActions();
    else if (selected && (!selected.disabled || isPageNavigation(selected))) {
      savedCaret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
      setActionTarget(selected); setActionQuery(''); setActionSelection(''); setError(''); }
  }
  async function forget(entry?: Entry) {
    if (!entry || resultBusy || executing.current || !ranking.get(entry.id)?.learned) return;
    executing.current = true;
    savedCaret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
    const previousRanking = frozenRanking;
    setFrozenRanking({ query, scores });
    setSelection(entry.id); setBusy(true); setError(''); setNotice('');
    try {
      await forgetSearchRanking(query.trim() ? usageTarget(entry) : liveRecommendations.targets.get(entry.id) ?? usageTarget(entry), query.trim() ? query : undefined);
      setNotice(t('rankingForgotten'));
    } catch { setFrozenRanking(previousRanking); setError(t('errorForgetRanking')); }
    finally { executing.current = false; setBusy(false); }
  }
  async function run(entry?: Entry, confirmed = false) {
    if (!entry || entry.disabled || !data || resultBusy || ((bookmarkRemoval || groupRemoval) && !confirmed)) return;
    if (entry.action === 'closeGroup' && !confirmed) {
      const group = data.groups?.find(group => group.id === entry.groupId);
      if (!group) return;
      setGroupRemoval({ ...entry, subtitle: group.title, groupTabIds: data.tabs.filter(tab => tab.groupId === group.id).map(tab => tab.id) });
      setError(''); setNotice(''); return;
    }
    if (confirmed) setGroupRemoval(null);
    if (entry.action === 'unbookmarkTab' && !confirmed) {
      const bookmarks = data.bookmarks.filter(bookmark => entry.bookmarkIds?.includes(bookmark.id));
      if (bookmarks.some(bookmark => bookmark.unmodifiable)) { setError(t('errorBookmarkManaged')); return; }
      if (bookmarks.length > 1) {
        if (!actionTarget) savedCaret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
        setError(''); setNotice('');
        setBookmarkRemoval({ entry: { ...entry, bookmarkIds: [...entry.bookmarkIds!] }, bookmarks });
        return;
      }
    }
    if (confirmed) setBookmarkRemoval(null);
    if (entry.action === 'copyUrl') {
      if (!entry.url || executing.current) return;
      const anchor = input.current?.closest('.palette')?.querySelector<HTMLInputElement>('.action-search input') ?? input.current;
      if (!anchor) return;
      if (!actionTarget) savedCaret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
      executing.current = true; setBusy(true); setError(''); setNotice('');
      try { await copyText(entry.url, anchor); closeActions(); setNotice(t('urlCopied')); }
      catch { setError(t('errorCopyUrl')); }
      finally { executing.current = false; setBusy(false); }
      return;
    }
    if (entry.action === 'searchAllHistory') {
      savedCaret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
      closeActions(); setError(''); setHistoryOpen(true); return;
    }
    if (entry.action === 'tabSwitcher') {
      if (!actionTarget) savedCaret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
      closeActions(); setError(''); setNotice(''); setTabSwitcherOpen(true); return;
    }
    if (entry.action === 'help') {
      if (!actionTarget) savedCaret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
      closeActions(); setError(''); setNotice(''); setHelpOpen(true); return;
    }
    if (entry.action === 'manageGroup' || entry.action === 'renameGroup') {
      if (!actionTarget) savedCaret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
      setGroupEditor(entry.action === 'renameGroup' ? 'name' : undefined);
      closeActions(); setError(''); setGroupId(entry.groupId); return;
    }
    if (entry.action === 'reviewTuck') {
      savedCaret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
      closeActions(); setRecoveryId(entry.recoveryId); return;
    }
    // A secondary tab operation (for example closing an IAM page) is not evidence
    // that the user prefers opening that page for the original root query.
    const learningQuery = !actionTarget || entry.action === actionTarget.action ? query : undefined;
    if (entry.action === 'localStorage' || entry.action === 'sessionStorage' || entry.action === 'cookies') {
      const tab = data.tabs.find(tab => tab.id === data.currentTabId);
      if (!tab) return;
      savedCaret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
      closeActions();
      setStorage({ kind: entry.action === 'localStorage' ? 'local' : entry.action === 'sessionStorage' ? 'session' : 'cookies',
        tabId: tab.id, windowId: data.windowId, expectedUrl: tab.url, query: learningQuery ?? '' });
      return;
    }
    const execution = { action: entry.action, groupId: entry.groupId, groupChanges: entry.groupChanges, groupTabIds: entry.groupTabIds, settingsSection: entry.settingsSection, tabId: entry.tabId, bookmarkId: entry.bookmarkId, newTab: entry.newTab, expectedUrl: entry.expectedUrl, bookmarkIds: entry.bookmarkIds, url: entry.url, windowId: data.windowId, query: learningQuery };
    if (entry.action === 'settings') { openSettings(entry.settingsSection); void execute(execution).catch(() => {}); return; }
    if (!actionTarget) savedCaret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
    setBusy(true); setError(''); setNotice('');
    const keepOpen = keepsPaletteOpen(entry.action, entry.tabId, data.currentTabId);
    try {
      await executeAction({ ...execution, ...(keepOpen ? { paletteState: paletteState() } : {}) });
      if (!keepOpen) { onClose(); return; }
      // A newly revealed removal action needs a fresh selection, not a second Enter.
      if (entry.action === 'bookmarkTab' && (!actionTarget || actionTarget.kind === 'command')) setSelection(null);
      closeActions();
      setNotice(t(entry.action === 'bookmarkTab' ? 'tabBookmarked' : entry.action === 'unbookmarkTab' || entry.action === 'removeBookmark' ? 'tabUnbookmarked' : entry.action === 'tuck' ? 'tabTucked' : entry.action === 'undoTuck' ? 'tuckUndone' : 'actionCompleted'));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally { setBusy(false); }
  }
  function hover(event: React.MouseEvent, id: string) {
    // Scrolling under a stationary pointer must not undo keyboard selection.
    const position = { x: event.screenX, y: event.screenY };
    if (selection !== null && !resultBusy && pointer.current && (pointer.current.x !== position.x || pointer.current.y !== position.y)) {
      setSelection(id);
    }
    pointer.current = position;
  }
  function keyboard(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || bookmarkRemoval || groupRemoval) return;
    if ((helpOpen || historyOpen || tabSwitcherOpen || bindingOpen || recoveryId || groupId !== undefined) && event.key !== 'Tab') return;
    const modifier = isMac ? event.metaKey : event.ctrlKey;
    if (modifier && !event.altKey && !event.shiftKey && event.key === ',') {
      event.preventDefault(); openSettings(); return;
    }
    if (settingsOpen && event.key !== 'Tab') return;
    if (modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault(); toggleActions(); return;
    }
    if (resultBusy && event.key !== 'Tab') return;
    if (!storage && !actionTarget && event.key === 'Backspace' && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && selected && ranking.get(selected.id)?.learned) {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) void forget(selected);
      return;
    }
    const pool = actionTarget ? actions : visible;
    const current = actionTarget ? selectedAction : selected;
    const setter = actionTarget ? setActionSelection : setSelection;
    const index = pool.findIndex(item => item.id === current?.id);
    const arrow = event.key === 'ArrowDown' || event.key === 'ArrowUp';
    const emacs = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && ['n', 'p'].includes(event.key.toLowerCase());
    if (!event.shiftKey && (arrow || emacs || ['PageDown', 'PageUp'].includes(event.key))) {
      event.preventDefault();
      if (!pool.length) return;
      const down = event.key === 'ArrowDown' || event.key === 'PageDown' || event.key.toLowerCase() === 'n';
      const delta = down ? 1 : -1;
      let next = index < 0 ? (down ? 0 : pool.length - 1) : (index + delta + pool.length) % pool.length;
      if (arrow && modifier) {
        next = down ? pool.length - 1 : 0;
      } else if (event.altKey || event.key.startsWith('Page')) {
        const viewport = list.current;
        const row = viewport?.querySelector<HTMLElement>('[role="option"]');
        const step = Math.max(1, Math.floor((viewport?.clientHeight ?? 320) / (row?.offsetHeight || 40)) - 1);
        next = Math.max(0, Math.min(pool.length - 1, index + delta * step));
      }
      setter(pool[next].id);
      if ((event.target as HTMLElement).closest('.ranking-forget')) input.current?.focus();
    } else if (event.key === 'Enter') {
      if (!storage && !actionTarget && current && isPageNavigation(current) && (event.target as HTMLElement).tagName !== 'BUTTON'
        && matchesShortcut(event, addressNewTabShortcut(isMac), isMac)) {
        event.preventDefault();
        if (!event.repeat) void run(addressActions(current, isMac)[1]);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) { event.preventDefault(); return; }
      if ((event.target as HTMLElement).tagName === 'BUTTON') return;
      event.preventDefault(); void run(current);
    } else if (event.key === 'Tab') {
      // Trap keyboard focus inside the palette, including the non-modal popup.
      const scope = event.currentTarget as HTMLElement;
      const nodes = Array.from(scope.querySelectorAll<HTMLElement>('input, textarea, select, button:not(:disabled)'))
        .filter(node => node.offsetParent !== null && !node.closest('[inert]') && !node.hasAttribute('disabled') && node.tabIndex >= 0 && (!actionTarget || node.closest('.action-menu')));
      const at = nodes.indexOf(event.target as HTMLElement);
      event.preventDefault();
      nodes[(at + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length]?.focus();
    }
  }
  function affected(entry?: Entry): number | undefined {
    if (!entry || !data || (entry.action !== 'closeOthers' && entry.action !== 'closeRight')) return;
    const tab = data.tabs.find(item => item.id === entry.tabId);
    return tab ? closeTargets(data.tabs, tab, entry.action).length : 0;
  }
  // The switcher's Chrome binding launches its held-key flow, not this menu action.
  const visibleShortcut = (entry: Entry) => entry.action === 'tabSwitcher' || (mode === 'popup' && ['close', 'reload'].includes(entry.action)) ? undefined : entry.shortcut;
  const current = actionTarget ? selectedAction : selected;
  const count = affected(current);
  const newAddressAction = !actionTarget && selected && isPageNavigation(selected) ? addressActions(selected, isMac)[1] : undefined;
  const primaryLabel = current?.action === 'manageGroup' ? t('groupViewTabs') : current?.newTab || current?.action === 'openAddressNewTab' ? t('openNewTab') : isPageNavigation(current) ? t('openCurrentTab') : current?.kind === 'tab' && current.action === 'switch' ? t('switchTabPrimary')
    : current?.kind === 'history' ? t('openHistoryPage') : current?.kind === 'bookmark' ? t('openBookmark') : current?.title || t('runCommand');

  return <NavigationRoot><BackLayer onBack={dismiss}><div className={`justonehop-app ${mode} ${settled ? 'settled' : ''}`} data-theme={preferences.theme} lang={t('languageTag')} onKeyDown={keyboard} onMouseDown={event => {
    if (event.target === event.currentTarget) { if (groupRemoval) setGroupRemoval(null); else if (bookmarkRemoval) setBookmarkRemoval(null); else if (actionTarget) closeActions(); else dismiss(); }
  }}>
    {tabSwitcherOpen && data ? <PaletteTabSwitcher data={data} theme={preferences.theme} onBack={() => setTabSwitcherOpen(false)} onClose={onClose} /> : historyOpen && data ? <HistoryView initialQuery={isHistorySearchIntent(query) ? '' : query} data={data} isMac={isMac} onBack={() => setHistoryOpen(false)} onClose={onClose} /> : helpOpen ? <HelpView shortcut={data?.shortcut || ''} onBack={() => setHelpOpen(false)} /> : groupId !== undefined && data ? <TabGroupView groupId={groupId} data={data} isMac={isMac} onBack={() => setGroupId(undefined)} onClose={onClose}
      initialEditor={groupEditor} initialState={initialState?.group} paletteState={paletteState()} onExecute={executeAction} executionBusy={executionBusy} refreshError={error} /> : recoveryId && data ? <TuckRecoveryView item={data.tuckRecoveries?.find(item => item.id === recoveryId)} windowId={data.windowId} isMac={isMac}
      onBack={() => setRecoveryId(undefined)} onComplete={async () => { setData(await getSnapshot()); setRecoveryId(undefined); }} /> : bindingOpen ? <BindingGuide isMac={isMac} onBack={() => setBindingOpen(false)} /> : storage ? <StorageView request={storage} onBack={() => setStorage(null)} isMac={isMac} /> : settingsOpen ? <Settings initialSection={settingsSection} preferences={preferences} shortcut={data?.shortcut || ''} tabSwitcherShortcut={data?.tabSwitcherShortcut || ''} isMac={isMac}
      onBack={() => setSettingsOpen(false)} onClose={onClose} onRankingReset={() => { setFrozenRanking(null); setHomeSession(data ? { sourceId: data.currentTabId, scores: emptyScores } : null); }} /> : <section tabIndex={-1} className="palette" aria-label={t('extensionName')} aria-busy={busy}>
      <span className="sr-only" id="justonehop-navigation">{t('navigationHelp')}</span>
      <div className={`main-surface ${actionTarget || bookmarkRemoval || groupRemoval ? 'subdued' : ''}`} inert={actionTarget || bookmarkRemoval || groupRemoval ? true : undefined}>
        <header className="search-bar">
          <SearchFocusButton input={input} disabled={busy} />
          <input data-back-on-empty ref={input} value={query} onChange={event => { setQuery(event.target.value); setSelection(''); setError(''); setNotice(''); }}
            placeholder={t('searchPlaceholder')} aria-label={t('searchLabel')} role="combobox"
            aria-autocomplete="list" aria-expanded="true" aria-controls="justonehop-results"
            aria-describedby="justonehop-navigation"
            aria-activedescendant={!history.pending && selected ? `justonehop-${selected.id}` : undefined}
            autoComplete="off" autoCorrect="off" spellCheck={false} disabled={busy} />
          <SearchDismissButton label={t('closePalette')} />
        </header>
        <span className="sr-only result-status" role="status">{data && !history.pending ? countMessage('resultOne', 'resultMany', visible.length) : loading && showLoading ? t('loading') : ''}</span>
        <div className="results" ref={list} id="justonehop-results" role="listbox" aria-label={t(grouped ? 'suggested' : 'resultsLabel')} aria-busy={history.pending}>
          {loading && showLoading ? <div className="empty"><LoaderCircle className="spinner" size={25} /><p>{t('preparing')}</p></div> : null}
          {data && !history.pending && !visible.length ? <div className="empty"><Search size={30} /><strong>{t('noResults')}</strong>
            <p>{t('noResultsHint')}</p></div> : null}
          {visible.map(item => <div className="result-group" key={item.id}>
            <SearchResultItem entry={item} query={displayQuery} ranking={ranking.get(item.id)} onForget={() => void forget(item)} disabled={resultBusy || !!actionTarget} isMac={isMac} suppressTabShortcuts={mode === 'popup'} id={`justonehop-${item.id}`} selected={!history.pending && selected?.id === item.id}
            onMouseMove={event => hover(event, item.id)} onClick={() => { if (!resultBusy) { setSelection(item.id); void run(item); } }}
            onContextMenu={event => {
              event.preventDefault();
              if (resultBusy || (item.disabled && !isPageNavigation(item))) return;
              savedCaret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
              setSelection(item.id); setActionTarget(item); setActionQuery(''); setActionSelection(''); setError('');
            }} />
          </div>)}
          {!grouped && results.length > visible.filter(item => item.action !== 'searchAllHistory' && !item.id.startsWith('google:')).length ? <p className="more-hint">{t('moreResults')}</p> : null}
        </div>
      </div>

      {groupRemoval ? <GroupConfirmation target={groupRemoval} onCancel={() => setGroupRemoval(null)} onConfirm={() => void run(groupRemoval, true)} /> : bookmarkRemoval ? <BookmarkConfirmation target={bookmarkRemoval} onCancel={() => setBookmarkRemoval(null)} onConfirm={() => void run(bookmarkRemoval.entry, true)} /> : actionTarget ? <ActionMenu id="justonehop-actions" isMac={isMac}
        title={<><span className="action-target-icon"><Favicon pageUrl={actionTarget.faviconPageUrl} fallback={<Glyph name={actionTarget.icon} size={15} />} /></span><span>{liveTarget?.title}</span></>}
        actions={actions.map(action => ({ id: action.id, title: action.title, shortcut: visibleShortcut(action), icon: <Favicon pageUrl={action.faviconPageUrl} fallback={<Glyph name={action.icon} size={16} />} />, danger: action.danger || action.action === 'close', disabled: action.disabled, alias: matchingAlias(action, actionQuery) }))}
        query={actionQuery} onQueryChange={value => { setActionQuery(value); setActionSelection(''); }} selectedId={selectedAction?.id} onSelectionChange={setActionSelection}
        onAction={id => void run(actions.find(action => action.id === id))} onClose={closeActions} /> : null}

      {error ? <div className="error-banner" role="alert"><AlertCircle size={15} /><span>{errorMessage(new Error(error))}</span>
        {!data ? <button onClick={() => { setError(''); void refreshSnapshot().catch(reason => setError(errorMessage(reason))); }}>{t('retry')}</button> : null}</div> : null}
      <PaletteFooter isMac={isMac}
        navigation={{ kind: 'settings', label: t('settings'), tooltip: `${t('settings')} (${mod},)`, disabled: busy || !!bookmarkRemoval || !!groupRemoval, onAction: () => openSettings() }}
        title={t('extensionName')} context={<NavigationHint />}
        status={busy ? <span className="footer-status"><LoaderCircle className="spinner" size={13} />{t('running')}</span>
          : notice ? <span role="status">{notice}</span>
          : newAddressAction && selected?.disabled ? <span role="status">{t('addressPinned')}</span>
          : selection === null ? <span role="status">{t('chooseNextTab')}</span>
          : count !== undefined ? <span className="footer-status">{countMessage('closeCountOne', 'closeCountMany', count)}</span>
          : undefined}
        primary={{ label: primaryLabel, shortLabel: current?.newTab || current?.action === 'openAddressNewTab' ? t('footerOpenNewTab') : isPageNavigation(current) ? t('footerOpenCurrentTab') : undefined, keys: ['↵'], disabled: !current || current.disabled || resultBusy || !!bookmarkRemoval || !!groupRemoval, danger: !!(current?.danger || current?.action === 'close'), onAction: () => void run(current) }}
        secondary={newAddressAction ? { label: t('openNewTab'), shortLabel: t('footerOpenNewTab'), keys: shortcutKeys(addressNewTabShortcut(isMac), isMac), icon: <ExternalLink size={15} />, disabled: resultBusy || !!bookmarkRemoval || !!groupRemoval, onAction: () => void run(newAddressAction) } : undefined}
        actions={{ open: !!actionTarget, disabled: !selected || (selected.disabled && !isPageNavigation(selected)) || resultBusy || !!bookmarkRemoval || !!groupRemoval, onToggle: toggleActions }} />
      {data && !data.shortcut && !actionTarget ? <div className="shortcut-notice">{t('shortcutNotice')}</div> : null}
    </section>}
  </div></BackLayer></NavigationRoot>;
}
