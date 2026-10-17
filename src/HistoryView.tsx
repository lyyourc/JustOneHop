import { SearchResultItem } from './SearchResultItem';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { History, LoaderCircle, Search } from 'lucide-react';
import { BackLayer } from './Navigation';
import { SearchDismissButton } from './SearchDismissButton';
import { PaletteFooter } from './PaletteFooter';
import { ActionMenu } from './ActionMenu';
import { useResultSelection } from './useResultSelection';
import { useHistoryQuery } from './useHistoryQuery';
import { historyEntries } from './historySearch';
import { search } from './model';
import { execute } from './api';
import { errorMessage, t } from './i18n';
import type { Entry } from './types';

export function HistoryView({ initialQuery, windowId, isMac, onBack, onClose }: {
  initialQuery: string; windowId: number; isMac: boolean; onBack: () => void; onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const { outcome, pending, retry } = useHistoryQuery(query, 'all');
  const [showLoading, setShowLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const executing = useRef(false);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState(false);
  const [actionQuery, setActionQuery] = useState('');
  const [actionId, setActionId] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<[number, number]>([initialQuery.length, initialQuery.length]);
  const list = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const results = useMemo(() => pending || !query.trim() ? [] : search(historyEntries(outcome.items), query), [outcome, pending, query]);
  const { selected, setSelection } = useResultSelection(results, query);
  const unavailable = pending || busy;
  const actions = selected ? [{ id: 'open', title: t('openHistoryPage'), keywords: 'open page 打开页面', icon: <History size={16} /> }]
    .filter(action => `${action.title} ${action.keywords}`.toLowerCase().includes(actionQuery.trim().toLowerCase())) : [];
  const chosen = actions.find(action => action.id === actionId) || actions[0];
  useEffect(() => {
    setShowLoading(false);
    if (!pending) return;
    const timer = setTimeout(() => setShowLoading(true), 150);
    return () => clearTimeout(timer);
  }, [pending]);
  useLayoutEffect(() => {
    if (!menu && !busy) { input.current?.focus(); input.current?.setSelectionRange(...caret.current); }
  }, [menu, busy]);
  useLayoutEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selected?.id, menu]);
  function rememberCaret() { caret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length]; }
  function toggleMenu() {
    if (unavailable || !selected) return;
    rememberCaret(); setMenu(!menu); setActionQuery(''); setActionId('');
  }
  async function open(entry: Entry | undefined = selected) {
    if (!entry || unavailable || executing.current) return;
    executing.current = true; rememberCaret(); setBusy(true); setError('');
    try { await execute({ action: 'openHistoryPage', windowId, url: entry.url }); onClose(); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { executing.current = false; setBusy(false); }
  }
  const failure = outcome.state === 'error' ? t('errorHistorySearch') : outcome.state === 'timeout' ? t('historySearchTimeout') : '';
  return <BackLayer onBack={onBack}><section className="palette history-view" aria-label={t('historySearchLabel')} aria-busy={unavailable} onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || menu) return;
    const mod = isMac ? event.metaKey : event.ctrlKey;
    if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') { event.preventDefault(); toggleMenu(); return; }
    if (unavailable) return;
    const arrow = event.key === 'ArrowDown' || event.key === 'ArrowUp';
    const emacs = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && ['n', 'p'].includes(event.key.toLowerCase());
    if (!event.shiftKey && (arrow || emacs || ['PageDown', 'PageUp'].includes(event.key))) {
      event.preventDefault();
      if (!results.length) return;
      const index = results.findIndex(entry => entry.id === selected?.id);
      const down = event.key === 'ArrowDown' || event.key === 'PageDown' || event.key.toLowerCase() === 'n';
      let next = index < 0 ? (down ? 0 : results.length - 1) : (index + (down ? 1 : -1) + results.length) % results.length;
      if (arrow && mod) next = down ? results.length - 1 : 0;
      else if (event.altKey || event.key.startsWith('Page')) {
        const row = list.current?.querySelector<HTMLElement>('.result');
        const step = Math.max(1, Math.floor((list.current?.clientHeight ?? 320) / (row?.offsetHeight || 40)) - 1);
        next = Math.max(0, Math.min(results.length - 1, index + (down ? step : -step)));
      }
      setSelection(results[next].id);
    } else if (event.key === 'Enter' && (event.target as HTMLElement).tagName !== 'BUTTON') {
      event.preventDefault();
      if (!event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) void open();
    }
  }}>
    <div className="main-surface" inert={menu ? true : undefined}>
      <header className="search-bar"><span className="search-icon"><Search size={20} /></span>
        <input data-back-on-empty ref={input} value={query} onChange={event => { setQuery(event.target.value); setSelection(''); setError(''); }}
          placeholder={t('historySearchLabel')} aria-label={t('historySearchLabel')} role="combobox" aria-autocomplete="list" aria-expanded="true"
          aria-controls="zing-history-results" aria-activedescendant={selected ? `zing-${selected.id}` : undefined} autoComplete="off" spellCheck={false} disabled={busy} />
        <SearchDismissButton label={t('back')} />
      </header>
      <div className="results" ref={list} id="zing-history-results" role="listbox" aria-label={t('historySearchLabel')} aria-busy={pending}>
        {pending && showLoading ? <div className="empty" role="status"><LoaderCircle className="spinner" size={25} /><p>{t('historySearching')}</p></div> : null}
        {!pending && !failure && !results.length ? <div className="empty" role="status">{t(query.trim() ? 'historyNoResults' : 'historyEnterQuery')}</div> : null}
        {!pending && failure ? <div className="empty"><p role="alert">{failure}</p><button className="surface-button" onClick={retry}>{t('retry')}</button></div> : null}
        {results.map(entry => <SearchResultItem entry={entry} query={query} isMac={isMac} showKind={false} key={entry.id} id={`zing-${entry.id}`} selected={selected?.id === entry.id} onClick={() => { if (!unavailable) { setSelection(entry.id); void open(entry); } }}
          onMouseMove={event => { const position = { x: event.screenX, y: event.screenY }; if (!unavailable && pointer.current && (pointer.current.x !== position.x || pointer.current.y !== position.y)) setSelection(entry.id); pointer.current = position; }}
          onContextMenu={event => { event.preventDefault(); if (!unavailable) { rememberCaret(); setSelection(entry.id); setMenu(true); setActionQuery(''); setActionId(''); } }} />)}
        {!pending && outcome.limited ? <p className="more-hint">{t('historyLimitedHint')}</p> : null}
      </div>
    </div>
    {error ? <div className="error-banner" role="alert">{error}</div> : null}
    <PaletteFooter isMac={isMac} navigation={{ kind: 'back', label: `${t('back')} · ${t('historyKind')}`, tooltip: `${t('back')} (Esc)`, onAction: () => menu ? setMenu(false) : onBack() }}
      title={t('historyKind')} context={t('historyAllTime')}
      primary={{ label: menu ? chosen?.title || t('openHistoryPage') : t('openHistoryPage'), keys: ['↵'], disabled: unavailable || !selected || (menu && !chosen), onAction: () => void open() }}
      actions={{ open: menu, disabled: unavailable || !selected, onToggle: toggleMenu }} />
    {menu ? <ActionMenu id="history-actions" title={selected?.title} actions={actions} query={actionQuery} onQueryChange={setActionQuery}
      selectedId={chosen?.id} onSelectionChange={setActionId} onAction={() => void open()} onClose={() => setMenu(false)} isMac={isMac} /> : null}
  </section></BackLayer>;
}
