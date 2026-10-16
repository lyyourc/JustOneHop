import { TabGroupView } from './TabGroupView';
import { TuckRecoveryView } from './TuckRecoveryView';
import { entrySearchQuery, entryTitle } from './entryPresentation';
import { Favicon } from './Favicon';
import { NavigationHint, Shortcut } from './Shortcut';
import { NavigationRoot, BackLayer } from './Navigation';
import { PaletteFooter } from './PaletteFooter';
import { ActionMenu } from './ActionMenu';
import { t, countMessage, errorMessage } from './i18n';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import {
  Code, Pencil, Database, Cookie, ArrowRight, ArrowDownToLine, Bookmark,
  Layers, LoaderCircle, Pin, Plus, RotateCcw,
  Settings2, Search, Volume2, VolumeX, X, PanelTop, AlertCircle,
} from 'lucide-react';
import { getPreferences, subscribePreferences } from './preferences';
import { getUsage, subscribeUsage } from './usageState';
import { commandUsage, queryUsage } from './usage';
import { StorageView } from './StorageView';
import { bindingScript, deleteScript, type SavedScript, getScripts, scriptEntries, scriptsReady, subscribeScripts } from './scripts';
import { copyText } from './clipboard';
import { ScriptRunner } from './ScriptRunner';
import { ScriptLibrary } from './ScriptLibrary';
import { Settings } from './Settings';
import { HighlightedText } from './HighlightedText';
import { execute, getSnapshot } from './api';
import { actionsFor, closeTargets, entries, homeEntries, matchingAlias, search } from './model';
import type { Entry, IconName, Snapshot, StorageRead, SettingsSection, ScriptRun } from './types';

const icons = { tab: PanelTop, bookmark: Bookmark, plus: Plus, reload: RotateCcw, close: X,
  others: Layers, right: ArrowRight, restore: RotateCcw, pin: Pin, volume: Volume2, settings: Settings2, database: Database, cookie: Cookie, script: Code, edit: Pencil, tuck: ArrowDownToLine };
function Glyph({ name, size = 18 }: { name: IconName; size?: number }) {
  const Icon = icons[name]; return <Icon size={size} strokeWidth={1.7} aria-hidden="true" />;
}
function Key({ children }: { children: React.ReactNode }) { return <kbd>{children}</kbd>; }

export function App({ mode, onClose }: { mode: 'overlay' | 'popup'; onClose: () => void }) {
  const preferences = useSyncExternalStore(subscribePreferences, getPreferences);
  const scripts = useSyncExternalStore(subscribeScripts, getScripts);
  const [notice, setNotice] = useState('');
  const [groupId, setGroupId] = useState<number>();
  const [recoveryId, setRecoveryId] = useState<string>();
  const usage = useSyncExternalStore(subscribeUsage, getUsage);
  const [scriptRun, setScriptRun] = useState<{ target: Omit<ScriptRun, 'scriptId'>; initialScriptId?: string; autoCopy: boolean } | null>(null);
  const [storage, setStorage] = useState<StorageRead | null>(null);
  const [scriptLibraryOpen, setScriptLibraryOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>();
  const [scriptEditor, setScriptEditor] = useState<SavedScript | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedScript | null>(null);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [data, setData] = useState<Snapshot | null>(null);
  const [showLoading, setShowLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState('');
  const [actionTarget, setActionTarget] = useState<Entry | null>(null);
  const [actionQuery, setActionQuery] = useState('');
  const [actionSelection, setActionSelection] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const savedCaret = useRef<[number, number]>([0, 0]);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? '⌘' : 'Ctrl';
  const items = useMemo(() => data ? [...entries(data), ...scriptEntries(scripts)] : [], [data, preferences.language, scripts]);
  const results = useMemo(() => query.trim() ? search(items, query, queryUsage(usage, query)) : homeEntries(items, commandUsage(usage)), [items, query, usage]);
  const visible = results.slice(0, 100);
  const grouped = !query.trim();
  const selected = visible.find(item => item.id === selection) || visible[0];
  const liveTarget = actionTarget && (items.find(item => item.id === actionTarget.id) || actionTarget);
  const actionItems = useMemo(() => data && liveTarget ? actionsFor(liveTarget, data)
    .sort((a, b) => Number(a.action.startsWith('close')) - Number(b.action.startsWith('close'))) : [], [data, liveTarget, preferences.language]);
  const actions = useMemo(() => search(actionItems, actionQuery), [actionItems, actionQuery]);
  const selectedAction = actions.find(item => item.id === actionSelection) || actions[0];
  const loading = !data && !error;
  const [settled, setSettled] = useState(mode !== 'overlay');

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

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => { void getSnapshot().then(value => { if (alive) setData(value); })
      .catch(reason => { if (alive) setError(errorMessage(reason)); }); };
    const changed = () => { clearTimeout(timer); timer = setTimeout(refresh, 100); };
    refresh();
    void scriptsReady.catch(() => { if (alive) setError(t('errorGeneric')); });
    const focusWindow = () => refresh();
    window.addEventListener('focus', focusWindow);
    input.current?.focus();
    input.current?.setSelectionRange(0, 0);
    // Content scripts only have runtime access; updates are forwarded by the worker.
    const listener = (message: { source?: string; type?: string }) => {
      if (message.source === 'zing' && message.type === 'changed') changed();
    };
    const port = chrome.runtime.connect({ name: 'zing' });
    port.onMessage.addListener(listener);
    return () => { alive = false; clearTimeout(timer); port.disconnect(); window.removeEventListener('focus', focusWindow); };
  }, []);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected?.id, settingsOpen]);
  useLayoutEffect(() => {
    if (busy || settingsOpen || scriptEditor || scriptLibraryOpen || scriptRun || recoveryId || groupId !== undefined) return;
    if (deleteTarget) { cancelDelete.current?.focus(); return; }
    if (!actionTarget) { input.current?.focus(); input.current?.setSelectionRange(...savedCaret.current); }
  }, [actionTarget, settingsOpen, storage, scriptEditor, scriptLibraryOpen, deleteTarget, scriptRun, recoveryId, groupId, busy]);

  function openSettings(section?: SettingsSection) {
    if (busy || settingsOpen || scriptEditor || scriptLibraryOpen || deleteTarget || scriptRun) return;
    if (!actionTarget) savedCaret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
    closeActions(); setSettingsSection(section); setSettingsOpen(true); setError('');
  }
  function closeActions() { setActionTarget(null); setActionQuery(''); setActionSelection(''); }
  function toggleActions() {
    if (busy) return;
    if (actionTarget) closeActions();
    else if (selected) {
      savedCaret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
      setActionTarget(selected); setActionQuery(''); setActionSelection(''); setError(''); }
  }
  async function run(entry?: Entry) {
    if (!entry || !data || busy) return;
    if (entry.action === 'manageGroup') {
      savedCaret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
      closeActions(); setGroupId(entry.groupId); return;
    }
    if (entry.action === 'reviewTuck') {
      savedCaret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
      closeActions(); setRecoveryId(entry.recoveryId); return;
    }
    if (entry.action === 'runScript' || entry.action === 'runCopyScript') {
      const tab = data.tabs.find(tab => tab.id === data.currentTabId);
      if (!tab) return;
      if (!actionTarget) savedCaret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
      closeActions(); setNotice(''); setError('');
      setScriptRun({ target: { tabId: tab.id, windowId: data.windowId, expectedUrl: tab.url }, initialScriptId: entry.scriptId, autoCopy: entry.action === 'runCopyScript' });
      return;
    }
    if (entry.action === 'newScript' || entry.action === 'scriptLibrary') {
      if (!actionTarget) savedCaret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
      closeActions(); setError(''); setNotice('');
      if (entry.action === 'newScript') setScriptEditor({ id: crypto.randomUUID(), title: '', code: '' });
      else setScriptLibraryOpen(true);
      return;
    }
    if (entry.action === 'copyScript' || entry.action === 'editScript' || entry.action === 'deleteScript') {
      const script = [bindingScript(), ...scripts].find(script => script.id === entry.scriptId);
      if (!script) { closeActions(); return; }
      if (entry.action === 'editScript') { closeActions(); setNotice(''); setScriptEditor(script); return; }
      if (entry.action === 'deleteScript') { if (script.id !== 'builtin-ctrl-tab') setDeleteTarget(script); return; }
      const anchor = input.current;
      if (!script || !anchor) return;
      try { await copyText(script.code, anchor); closeActions(); setNotice(t('scriptCopied')); setError(''); }
      catch { setError(t('scriptCopyError')); }
      return;
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
    const execution = { action: entry.action, tabId: entry.tabId, bookmarkId: entry.bookmarkId, windowId: data.windowId, query: learningQuery };
    if (entry.action === 'settings') { openSettings(entry.settingsSection); void execute(execution).catch(() => {}); return; }
    if (!actionTarget) savedCaret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
    setBusy(true); setError('');
    try {
      await execute(execution);
      if (entry.action === 'undoTuck' || (entry.action === 'tuck' && entry.tabId !== data.currentTabId)) {
        setData(await getSnapshot());
        setBusy(false); closeActions();
        setNotice(t(entry.action === 'tuck' ? 'tabTucked' : 'tuckUndone'));
      } else onClose();
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  }
  async function confirmDelete() {
    if (!deleteTarget || busy) return;
    setBusy(true); setError('');
    try { await deleteScript(deleteTarget.id); setDeleteTarget(null); closeActions(); setNotice(t('scriptDeleted')); }
    catch { setError(t('errorGeneric')); }
    finally { setBusy(false); }
  }
  function hover(event: React.MouseEvent, id: string) {
    // Scrolling under a stationary pointer must not undo keyboard selection.
    const position = { x: event.screenX, y: event.screenY };
    if (pointer.current && (pointer.current.x !== position.x || pointer.current.y !== position.y)) {
      setSelection(id);
    }
    pointer.current = position;
  }
  function keyboard(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if ((scriptEditor || scriptLibraryOpen || deleteTarget || scriptRun || recoveryId || groupId !== undefined) && event.key !== 'Tab') return;
    const modifier = isMac ? event.metaKey : event.ctrlKey;
    if (modifier && !event.altKey && !event.shiftKey && event.key === ',') {
      event.preventDefault(); openSettings(); return;
    }
    if (settingsOpen && event.key !== 'Tab') return;
    if (modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault(); toggleActions(); return;
    }
    if (busy) return;
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
      let next = (index + delta + pool.length) % pool.length;
      if (arrow && modifier) {
        // The home view has recent tabs and common commands; other lists jump to an edge.
        next = down ? pool.length - 1 : 0;
        if (grouped && !actionTarget) {
          const boundaries = pool.map((item, i) => i === 0 || item.kind !== pool[i - 1].kind ? i : -1).filter(i => i >= 0);
          next = down ? boundaries.find(i => i > index) ?? pool.length - 1
            : [...boundaries].reverse().find(i => i < index) ?? 0;
        }
      } else if (event.altKey || event.key.startsWith('Page')) {
        const viewport = list.current;
        const row = viewport?.querySelector<HTMLElement>('[role="option"]');
        const step = Math.max(1, Math.floor((viewport?.clientHeight ?? 320) / (row?.offsetHeight || 40)) - 1);
        next = Math.max(0, Math.min(pool.length - 1, index + delta * step));
      }
      setter(pool[next].id);
    } else if (event.key === 'Enter') {
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
  const visibleShortcut = (entry: Entry) => mode === 'popup' && ['close', 'reload'].includes(entry.action) ? undefined : entry.shortcut;
  const current = actionTarget ? selectedAction : selected;
  const count = affected(current);
  const primaryLabel = current?.kind === 'tab' && current.action === 'switch' ? t('switchTabPrimary')
    : current?.kind === 'script' && current.action === 'runScript' ? t('runScript') : current?.action === 'copyScript' ? t('copyScript') : current?.kind === 'bookmark' ? t('openBookmark') : current?.title || t('runCommand');

  return <NavigationRoot><BackLayer onBack={onClose}><div className={`zing-app ${mode} ${settled ? 'settled' : ''}`} data-theme={preferences.theme} lang={t('languageTag')} onKeyDown={keyboard} onMouseDown={event => {
    if (event.target === event.currentTarget) { if (deleteTarget) { if (!busy) setDeleteTarget(null); } else if (actionTarget) closeActions(); else onClose(); }
  }}>
    {groupId !== undefined && data ? <TabGroupView groupId={groupId} data={data} isMac={isMac} onBack={() => setGroupId(undefined)} onClose={onClose}
      onRefresh={async () => setData(await getSnapshot())} /> : recoveryId && data ? <TuckRecoveryView item={data.tuckRecoveries?.find(item => item.id === recoveryId)} windowId={data.windowId} isMac={isMac}
      onBack={() => setRecoveryId(undefined)} onComplete={async () => { setData(await getSnapshot()); setRecoveryId(undefined); }} /> : scriptRun ? <ScriptRunner {...scriptRun} onBack={() => setScriptRun(null)} /> : scriptLibraryOpen ? <ScriptLibrary isMac={isMac} onBack={() => setScriptLibraryOpen(false)} onClose={onClose} /> : scriptEditor ? <ScriptLibrary initialScript={scriptEditor} isMac={isMac} onBack={() => setScriptEditor(null)} onClose={onClose}
      onComplete={message => { setScriptEditor(null); setNotice(message); }} /> : storage ? <StorageView request={storage} onBack={() => setStorage(null)} isMac={isMac} /> : settingsOpen ? <Settings initialSection={settingsSection} preferences={preferences} shortcut={data?.shortcut || ''} isMac={isMac}
      onBack={() => setSettingsOpen(false)} onClose={onClose} /> : <section tabIndex={-1} className="palette" aria-label="zing" aria-busy={busy}>
      <span className="sr-only" id="zing-navigation">{t('navigationHelp')}</span>
      <div className={`main-surface ${actionTarget ? 'subdued' : ''}`} inert={actionTarget ? true : undefined}>
        <header className="search-bar">
          <span className="search-icon"><Search size={20} /></span>
          <input data-back-on-empty ref={input} value={query} onChange={event => { setQuery(event.target.value); setSelection(''); setError(''); setNotice(''); }}
            placeholder={t('searchPlaceholder')} aria-label={t('searchLabel')} role="combobox"
            aria-autocomplete="list" aria-expanded="true" aria-controls="zing-results"
            aria-describedby="zing-navigation"
            aria-activedescendant={selected ? `zing-${selected.id}` : undefined}
            autoComplete="off" autoCorrect="off" spellCheck={false} disabled={busy} />
          <button className="icon-button close-button" aria-label={t('closePalette')} title={t('closeTooltip')} onClick={onClose}><Key>esc</Key></button>
        </header>
        <span className="sr-only result-status" role="status">{data ? countMessage('resultOne', 'resultMany', results.length) : loading && showLoading ? t('loading') : ''}</span>
        <div className="results" ref={list} id="zing-results" role="listbox" aria-label={t('resultsLabel')}>
          {loading && showLoading ? <div className="empty"><LoaderCircle className="spinner" size={25} /><p>{t('preparing')}</p></div> : null}
          {data && !visible.length ? <div className="empty"><Search size={30} /><strong>{t('noResults')}</strong>
            <p>{t('noResultsHint')}</p></div> : null}
          {visible.map((item, index) => <div className={`result-group ${grouped && index > 0 && item.kind !== visible[index - 1].kind ? 'section-start' : ''}`} key={item.id}>
            <div id={`zing-${item.id}`} role="option" aria-selected={selected?.id === item.id}
            className={`result ${item.kind} ${item.danger ? 'danger' : ''}`} title={`${entryTitle(item)} — ${item.subtitle}`} onMouseMove={event => hover(event, item.id)} onClick={() => void run(item)}
            onContextMenu={event => {
              event.preventDefault();
              if (busy) return;
              savedCaret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
              setSelection(item.id); setActionTarget(item); setActionQuery(''); setActionSelection(''); setError('');
            }}>
            <span className={`entry-icon ${item.kind}`} data-color={item.groupColor}><Favicon pageUrl={item.faviconPageUrl} fallback={<Glyph name={item.icon} />} /></span>
            <span className="entry-copy"><span className="entry-title"><HighlightedText text={entryTitle(item)} query={entrySearchQuery(query)} /></span><span className="entry-subtitle">
              {item.kind === 'command' ? (matchingAlias(item, query)
                ? <><HighlightedText text={matchingAlias(item, query)} query={entrySearchQuery(query)} allowTypos={false} />{item.action === 'closeOthers' || item.action === 'closeRight' ? ` · ${t('keepPinned')}` : ''}</>
                : (item.action === 'closeOthers' || item.action === 'closeRight' ? t('keepPinned') : ''))
                : <HighlightedText text={item.subtitle} query={query} allowTypos={false} />}
            </span></span>
            <span className="entry-meta">
              {visibleShortcut(item) ? <Shortcut binding={visibleShortcut(item)!} isMac={isMac} /> : null}
              {item.groupCount !== undefined ? <span className="kind-label">{countMessage('groupTabOne', 'groupTabCount', item.groupCount)}</span> : null}
              {item.groupTitle ? <span className="tab-group-badge" data-color={item.groupColor}><HighlightedText text={item.groupTitle} query={query} /></span> : null}
              {item.pinned ? <Pin size={12} aria-label={t('pinned')} /> : null}
              {item.muted ? <VolumeX size={13} aria-label={t('muted')} /> : null}
              {item.active ? <span className="current-badge">{t('current')}</span> : null}
              {item.tucked && !item.groupTitle ? <span className="tucked-badge">{t('tucked')}</span> : null}
              {!grouped && ['tab', 'bookmark'].includes(item.kind) ? <span className="kind-label">{t(item.kind === 'tab' ? 'tabKind' : 'bookmarkKind')}</span> : null}
            </span>
          </div></div>)}
          {results.length > visible.length ? <p className="more-hint">{t('moreResults')}</p> : null}
        </div>
      </div>

      {actionTarget ? deleteTarget ? <BackLayer onBack={() => { if (!busy) setDeleteTarget(null); }}>
        <button className="action-scrim" aria-label={t('backToResults')} tabIndex={-1} onClick={() => { if (!busy) setDeleteTarget(null); }} />
        <div className="action-menu script-confirm" role="alertdialog" aria-modal="true" aria-labelledby="script-delete-title" aria-describedby="script-delete-detail">
          <h2 id="script-delete-title">{t('confirmDeleteScript')}</h2>
          <p id="script-delete-detail">{t('scriptDeletePrompt', deleteTarget.title)}</p>
          <div className="script-controls"><button ref={cancelDelete} className="ranking-reset" disabled={busy} onClick={() => setDeleteTarget(null)}>{t('cancelScriptDelete')}</button>
            <button className="ranking-reset delete-script-button" disabled={busy} onClick={() => void confirmDelete()}>{t('deleteScript')}</button></div>
        </div>
      </BackLayer> : <ActionMenu id="zing-actions" isMac={isMac}
        title={<><span className="action-target-icon"><Favicon pageUrl={actionTarget.faviconPageUrl} fallback={<Glyph name={actionTarget.icon} size={15} />} /></span><span>{liveTarget?.title}</span></>}
        actions={actions.map(action => ({ id: action.id, title: action.title, shortcut: visibleShortcut(action), icon: <Favicon pageUrl={action.faviconPageUrl} fallback={<Glyph name={action.icon} size={16} />} />, danger: action.danger || action.action === 'close', alias: matchingAlias(action, actionQuery) }))}
        query={actionQuery} onQueryChange={value => { setActionQuery(value); setActionSelection(''); }} selectedId={selectedAction?.id} onSelectionChange={setActionSelection}
        onAction={id => void run(actions.find(action => action.id === id))} onClose={closeActions} /> : null}

      {notice ? <div className="shortcut-notice" role="status">{notice}</div> : null}
      {error ? <div className="error-banner" role="alert"><AlertCircle size={15} /><span>{errorMessage(new Error(error))}</span>
        {!data ? <button onClick={() => { setError(''); void getSnapshot().then(setData).catch(reason => setError(errorMessage(reason))); }}>{t('retry')}</button> : null}</div> : null}
      <PaletteFooter isMac={isMac}
        navigation={{ kind: 'settings', label: t('settings'), tooltip: `${t('settings')} (${mod},)`, disabled: busy, onAction: () => openSettings() }}
        title="zing" context={<NavigationHint />}
        status={busy ? <span className="footer-status"><LoaderCircle className="spinner" size={13} />{t('running')}</span>
          : count !== undefined ? <span className="footer-status">{countMessage('closeCountOne', 'closeCountMany', count)}</span>
          : undefined}
        primary={{ label: primaryLabel, keys: ['↵'], disabled: !current || busy || !!deleteTarget, danger: !!(current?.danger || current?.action === 'close'), onAction: () => void run(current) }}
        actions={{ open: !!actionTarget, disabled: !selected || busy || !!deleteTarget, onToggle: toggleActions }} />
      {data && !data.shortcut && !actionTarget ? <div className="shortcut-notice">{t('shortcutNotice')}</div> : null}
    </section>}
  </div></BackLayer></NavigationRoot>;
}
