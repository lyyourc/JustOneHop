import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { execute } from './api';
import { errorMessage, t } from './i18n';
import { BackLayer } from './Navigation';
import { useOperationFeedback } from './OperationFeedback';
import { RecentSwitcherView } from './RecentSwitcherView';
import { filterRecentTabs, recentNavigation, recentSelection } from './recentSearch';
import type { Snapshot } from './types';

export function PaletteTabSwitcher({ data, onBack, onClose, theme }: {
  data: Snapshot; onBack: () => void; onClose: () => void; theme: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const executing = useRef(false);
  const composing = useRef(false);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<number | null>(() =>
    data.tabs.find(tab => tab.id !== data.currentTabId)?.id ?? data.tabs[0]?.id ?? null);
  const [closing, setClosing] = useState(false);
  const feedback = useOperationFeedback();
  // Snapshot order already puts other tabs in MRU order and the source last.
  // The shared view only reads identity, title, URL and pinned state.
  const tabs = useMemo<chrome.tabs.Tab[]>(() => data.tabs.map(tab => ({
    id: tab.id, windowId: tab.windowId, index: tab.index, title: tab.title, url: tab.url,
    active: tab.active, pinned: tab.pinned, audible: tab.audible, mutedInfo: { muted: tab.muted },
    groupId: tab.groupId ?? -1, incognito: data.incognito ?? false,
    highlighted: tab.active, selected: tab.active, discarded: false, autoDiscardable: true,
    frozen: false, lastAccessed: 0,
  })), [data.tabs, data.incognito]);
  const visible = useMemo(() => filterRecentTabs(tabs, query), [tabs, query]);
  const removed = selection !== null && !tabs.some(tab => tab.id === selection);
  const index = recentSelection(visible, removed ? data.currentTabId : selection ?? undefined, -1);
  const selected = visible[index];

  useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useLayoutEffect(() => {
    // Once a target disappears, only a visible source is a safe fallback. Keep
    // an explicit empty selection until the user chooses again otherwise.
    if (removed) setSelection(selected?.id ?? null);
  }, [removed, selected?.id]);
  useLayoutEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index, visible]);

  function back() {
    if (!alive.current) return;
    alive.current = false;
    onBack();
  }
  async function confirm(tabId = selected?.id) {
    if (!alive.current || executing.current || composing.current || tabId === undefined) return;
    const target = visible.find(tab => tab.id === tabId);
    if (!target) return;
    executing.current = true;
    setClosing(true);
    const operation = feedback.begin(t('operationPending'));
    try {
      // Tab Switcher choices do not participate in query learning.
      await execute({ action: 'switch', tabId, windowId: target.windowId });
      feedback.success(operation, t('actionCompleted'));
      if (alive.current) { alive.current = false; onClose(); }
    } catch (failure) {
      feedback.error(operation, errorMessage(failure));
      if (!alive.current) return;
      executing.current = false;
      setClosing(false);
    }
  }

  return <BackLayer onBack={back}><section className="palette" tabIndex={-1} aria-label={t('recentSwitcher')} aria-busy={closing}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyDown={event => {
      // App also handles keys: even ignored keys must stay in this child view.
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.keyCode === 229 || composing.current || executing.current) return;
      if (event.key === 'Enter') {
        if ((event.target as HTMLElement).closest('button')) return;
        event.preventDefault();
        if (!event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) void confirm();
        return;
      }
      const next = recentNavigation(event, index, visible.length, Math.max(1, Math.floor((list.current?.clientHeight ?? 320) / 40)));
      if (next !== undefined) { event.preventDefault(); setSelection(visible[next]?.id ?? null); }
    }}>
    <RecentSwitcherView tabs={visible} index={index} query={query} searching onSearch={() => {}}
      onQueryChange={value => {
        if (!alive.current || executing.current) return;
        const matches = filterRecentTabs(tabs, value);
        setQuery(value); setSelection(matches[recentSelection(matches, selected?.id)]?.id ?? null);
      }} sourceId={data.currentTabId} loaded closing={closing} error="" shortcut="" releaseKey="" theme={theme} listRef={list}
      onSelect={at => {
        if (!alive.current || executing.current) return;
        const tabId = visible[at]?.id;
        if (tabId === undefined) return;
        setSelection(tabId); void confirm(tabId);
      }} onConfirm={() => void confirm()} onCancel={back} onBack={back} />
  </section></BackLayer>;
}
