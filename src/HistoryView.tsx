import { SearchResultItem, EntryGlyph } from './SearchResultItem';
import { distinctResultAddresses } from './resultAddress';
import { copyText } from './clipboard';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getUsage, subscribeUsage } from './usageState';
import { queryUsage, rankingInfo, usageTarget } from './usage';
import { ExternalLink, LoaderCircle } from 'lucide-react';
import { addressActions, pageNavigationEntry } from './addressPresentation';
import { addressNewTabShortcut } from './address';
import { matchesShortcut, shortcutKeys } from './Shortcut';
import { BackLayer } from './Navigation';
import { SearchFocusButton } from './SearchFocusButton';
import { SearchDismissButton } from './SearchDismissButton';
import { PaletteFooter } from './PaletteFooter';
import { ActionMenu } from './ActionMenu';
import { useResultSelection } from './useResultSelection';
import { useHistoryQuery } from './useHistoryQuery';
import { historyEntries } from './historySearch';
import { actionsFor, search } from './model';
import { execute, forgetSearchRanking } from './api';
import { t } from './i18n';
import { useOperationFeedback } from './OperationFeedback';
import type { Entry, Snapshot } from './types';

export function HistoryView({ initialQuery, data, isMac, onBack, onClose }: {
  initialQuery: string; data: Snapshot; isMac: boolean; onBack: () => void; onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const usage = useSyncExternalStore(subscribeUsage, getUsage);
  const [frozenRanking, setFrozenRanking] = useState<{ query: string; scores: ReadonlyMap<string, number> } | null>(null);
  const feedback = useOperationFeedback();
  const { outcome, pending, retry } = useHistoryQuery(query, 'all');
  const [showLoading, setShowLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const executing = useRef(false);
  const [menu, setMenu] = useState(false);
  const [actionQuery, setActionQuery] = useState('');
  const [actionId, setActionId] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<[number, number]>([initialQuery.length, initialQuery.length]);
  const list = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const liveScores = useMemo(() => queryUsage(usage, query), [usage, query]);
  // Keep the displayed order after forget without freezing asynchronous history results.
  const scores = frozenRanking?.query === query ? frozenRanking.scores : liveScores;
  const { results, baseline } = useMemo(() => {
    const items = pending || !query.trim() ? [] : historyEntries(outcome.items).map(entry => pageNavigationEntry(entry, data));
    const baseline = search(items, query);
    const results = scores.size ? search(items, query, scores) : baseline;
    return { results, baseline };
  }, [outcome, pending, query, scores, data]);
  const addresses = useMemo(() => distinctResultAddresses(results), [results]);
  const ranking = useMemo(() => rankingInfo(results, baseline, liveScores), [results, baseline, liveScores]);
  const { selected, setSelection } = useResultSelection(results, query);
  const unavailable = pending || busy;
  const actions = selected ? actionsFor(selected, data, isMac)
    .filter(action => actionQuery.trim().toLowerCase().split(/\s+/).every(term => `${action.title} ${action.keywords}`.toLowerCase().includes(term))) : [];
  const newTabAction = selected && addressActions(selected, isMac)[1];
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
  useEffect(() => {
    if (frozenRanking && frozenRanking.query !== query) setFrozenRanking(null);
  }, [frozenRanking, query]);
  useLayoutEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selected?.id, menu, results]);
  function rememberCaret() { if (!menu) caret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length]; }
  function toggleMenu() {
    if (unavailable || !selected) return;
    rememberCaret(); setMenu(!menu); setActionQuery(''); setActionId('');
  }
  async function open(entry: Entry | undefined = selected) {
    if (!entry || entry.disabled || unavailable || executing.current) return;
    executing.current = true; rememberCaret(); setBusy(true);
    try {
      const result = await feedback.run(() => execute({ action: 'openHistoryPage', windowId: data.windowId, tabId: entry.tabId, expectedUrl: entry.expectedUrl, newTab: entry.newTab, url: entry.url, query }), t('actionCompleted'));
      if (result.ok) onClose();
    } finally { executing.current = false; setBusy(false); }
  }
  async function runAction(id?: string) {
    const action = actions.find(item => item.id === id);
    if (!action || action.disabled) return;
    if (action.action === 'openHistoryPage') { await open(action); return; }
    if (action.action !== 'copyUrl' || !selected?.url || unavailable || executing.current) return;
    const anchor = input.current?.closest('.palette')?.querySelector<HTMLInputElement>('.action-search input') ?? input.current;
    if (!anchor) return;
    const url = selected.url;
    executing.current = true; rememberCaret(); setBusy(true);
    try {
      const result = await feedback.run(() => copyText(url, anchor), t('urlCopied'), t('errorCopyUrl'));
      if (result.ok) setMenu(false);
    } finally { executing.current = false; setBusy(false); }
  }
  async function forget(entry?: Entry) {
    if (!entry || unavailable || executing.current || !ranking.get(entry.id)?.learned) return;
    const previousRanking = frozenRanking;
    setFrozenRanking({ query, scores });
    executing.current = true; rememberCaret(); setSelection(entry.id); setBusy(true);
    try {
      const result = await feedback.run(() => forgetSearchRanking(usageTarget(entry), query), t('rankingForgotten'), t('errorForgetRanking'));
      if (!result.ok) setFrozenRanking(previousRanking);
    } finally { executing.current = false; setBusy(false); }
  }
  const failure = outcome.state === 'error' ? t('errorHistorySearch') : outcome.state === 'timeout' ? t('historySearchTimeout') : '';
  return <BackLayer onBack={onBack}><section className="palette history-view" aria-label={t('historySearchLabel')} aria-busy={unavailable} onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || menu) return;
    const mod = isMac ? event.metaKey : event.ctrlKey;
    if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') { event.preventDefault(); toggleMenu(); return; }
    if (unavailable) return;
    if (event.key === 'Backspace' && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && selected && ranking.get(selected.id)?.learned) {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) void forget(selected);
      return;
    }
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
      if ((event.target as HTMLElement).closest('.ranking-forget')) input.current?.focus();
    } else if (event.key === 'Enter' && (event.target as HTMLElement).tagName !== 'BUTTON') {
      event.preventDefault();
      if (!event.repeat && matchesShortcut(event, addressNewTabShortcut(isMac), isMac)) void open(newTabAction);
      else if (!event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) void open();
    }
  }}>
    <div className="main-surface" inert={menu ? true : undefined}>
      <header className="search-bar"><SearchFocusButton input={input} disabled={busy} />
        <input data-back-on-empty ref={input} value={query} onChange={event => { setQuery(event.target.value); setSelection(''); }}
          placeholder={t('historySearchLabel')} aria-label={t('historySearchLabel')} role="combobox" aria-autocomplete="list" aria-expanded="true"
          aria-controls="justonehop-history-results" aria-activedescendant={selected ? `justonehop-${selected.id}` : undefined} autoComplete="off" spellCheck={false} disabled={busy} />
        <SearchDismissButton label={t('back')} query={query} input={input} disabled={busy} onClear={() => { setQuery(''); setSelection(''); }} />
      </header>
      <div className="results" ref={list} id="justonehop-history-results" role="listbox" aria-label={t('historySearchLabel')} aria-busy={pending}>
        {pending && showLoading ? <div className="empty" role="status"><LoaderCircle className="spinner" size={25} /><p>{t('historySearching')}</p></div> : null}
        {!pending && !failure && !results.length ? <div className="empty" role="status">{t(query.trim() ? 'historyNoResults' : 'historyEnterQuery')}</div> : null}
        {!pending && failure ? <div className="empty"><p role="alert">{failure}</p><button className="surface-button" onClick={retry}>{t('retry')}</button></div> : null}
        {results.map(entry => <SearchResultItem entry={entry} address={addresses.get(entry.id)} query={query} ranking={ranking.get(entry.id)} onForget={() => void forget(entry)} disabled={unavailable || menu} isMac={isMac} showKind={false} key={entry.id} id={`justonehop-${entry.id}`} selected={selected?.id === entry.id} onClick={() => { if (!unavailable) { setSelection(entry.id); void open(entry); } }}
          onMouseMove={event => { const position = { x: event.screenX, y: event.screenY }; if (!unavailable && pointer.current && (pointer.current.x !== position.x || pointer.current.y !== position.y)) setSelection(entry.id); pointer.current = position; }}
          onContextMenu={event => { event.preventDefault(); if (!unavailable) { rememberCaret(); setSelection(entry.id); setMenu(true); setActionQuery(''); setActionId(''); } }} />)}
        {!pending && outcome.limited ? <p className="more-hint">{t('historyLimitedHint')}</p> : null}
      </div>
    </div>
    <PaletteFooter isMac={isMac} navigation={{ kind: 'back', label: `${t('back')} · ${t('historyKind')}`, tooltip: `${t('back')} (Esc)`, onAction: () => menu ? setMenu(false) : onBack() }}
      title={t('historyKind')} context={t('historyAllTime')} status={!menu && selected?.disabled ? <span role="status">{t('addressPinned')}</span> : undefined}
      primary={{ label: menu ? chosen?.title || t('openCurrentTab') : t('openCurrentTab'), shortLabel: !menu || chosen?.id === `${selected?.id}:current` ? t('footerOpenCurrentTab') : chosen?.newTab ? t('footerOpenNewTab') : undefined, keys: ['↵'], disabled: unavailable || !selected || (menu ? !chosen || chosen.disabled : selected.disabled), onAction: () => menu ? void runAction(chosen?.id) : void open() }}
      secondary={!menu && newTabAction ? { label: t('openNewTab'), shortLabel: t('footerOpenNewTab'), keys: shortcutKeys(addressNewTabShortcut(isMac), isMac), icon: <ExternalLink size={15} />, disabled: unavailable, onAction: () => void open(newTabAction) } : undefined}
      actions={{ open: menu, disabled: unavailable || !selected, onToggle: toggleMenu }} />
    {menu ? <ActionMenu id="history-actions" title={selected?.title}
      actions={actions.map(action => ({ ...action, icon: <EntryGlyph name={action.icon} size={16} /> }))} query={actionQuery} onQueryChange={value => { setActionQuery(value); setActionId(''); }}
      selectedId={chosen?.id} onSelectionChange={setActionId} onAction={id => void runAction(id)} onClose={() => setMenu(false)} isMac={isMac} /> : null}
  </section></BackLayer>;
}
