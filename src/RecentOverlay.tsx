import { SwitcherConfirmation } from './switcherConfirmation';
import { useLayoutEffect, useRef, useState } from 'react';
import { RecentSwitcherView } from './RecentSwitcherView';
import { NavigationRoot, BackLayer } from './Navigation';
import { filterRecentTabs, recentNavigation, recentSelection } from './recentSearch';
import { getPreferences } from './preferences';
import { errorMessage, t } from './i18n';

export interface RecentOverlaySession {
  session: string; tabs: chrome.tabs.Tab[]; offset: number; sourceId: number; modifier: string; shortcut: string;
}
export function RecentOverlay({ initial, onClose }: { initial: RecentOverlaySession; onClose: () => void }) {
  const list = useRef<HTMLDivElement>(null);
  const [revision, render] = useState(0);
  const state = useRef({ tabs: initial.tabs, query: '', composing: false, searching: false,
    index: initial.tabs.length ? (initial.offset % initial.tabs.length + initial.tabs.length) % initial.tabs.length : -1,
    confirmation: new SwitcherConfirmation(), error: '' });
  const changed = () => render(value => value + 1);
  const dismiss = () => {
    if (state.current.confirmation.closed) return;
    state.current.confirmation.close();
    onClose();
  };
  const finish = async () => {
    const current = state.current;
    if (!current.confirmation.canSelect || current.composing || !list.current?.ownerDocument.hasFocus()) return;
    const tabId = filterRecentTabs(current.tabs, current.query)[current.index]?.id;
    if (tabId === undefined) return;
    if (!current.confirmation.begin()) return;
    current.error = ''; changed();
    try {
      const reply = await chrome.runtime.sendMessage({ source: 'justonehop-recent', type: 'accept-overlay', session: initial.session, tabId });
      if (reply?.ok) dismiss();
      else if (current.confirmation.fail()) { current.error = errorMessage(new Error(reply?.error || t('errorGeneric'))); changed(); }
    } catch (error) { if (current.confirmation.fail()) { current.error = errorMessage(error); changed(); } }
  };
  useLayoutEffect(() => {
    state.current.confirmation = new SwitcherConfirmation();
    const port = chrome.runtime.connect({ name: 'justonehop' });
    const element = list.current!;
    const view = element.ownerDocument.defaultView!;
    let alive = true;
    port.onDisconnect.addListener(() => { if (alive) dismiss(); });
    const move = (direction: number) => {
      const current = state.current;
      const count = filterRecentTabs(current.tabs, current.query).length;
      if (!current.confirmation.canSelect || current.composing || !count) return;
      current.index = current.index < 0 ? (direction > 0 ? 0 : count - 1) : (current.index + direction % count + count) % count; changed();
    };
    const keydown = (event: KeyboardEvent) => {
      const current = state.current;
      if (!event.isTrusted || event.isComposing || event.keyCode === 229 || current.composing || !current.confirmation.canSelect) return;
      if (event.key.toLowerCase() === 'f' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault(); current.searching = true; changed();
      } else if (event.key === 'Enter') {
        // The window sees the closed shadow host, so resolve the actual focused
        // control from the list's own root before claiming Enter for selection.
        const root = element.getRootNode() as Document | ShadowRoot;
        if (root.activeElement?.closest('button')) return;
        event.preventDefault();
        if (!event.repeat && !event.metaKey && !event.altKey && !event.shiftKey && !event.ctrlKey) void finish();
      } else {
        const next = recentNavigation(event, current.index, filterRecentTabs(current.tabs, current.query).length, Math.max(1, Math.floor(element.clientHeight / 40)));
        if (next !== undefined) { event.preventDefault(); current.index = next; changed(); }
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.isTrusted && !event.isComposing && event.keyCode !== 229 && event.key === initial.modifier && !state.current.searching) { event.preventDefault(); void finish(); }
    };
    const compositionStart = () => { state.current.composing = true; };
    const compositionEnd = () => { state.current.composing = false; };
    // A frame focus handoff can blur its parent. Only dismiss after checking
    // the actual document focus; switching to Chrome UI or another app cancels.
    const blur = () => setTimeout(() => { if (alive && !element.ownerDocument.hasFocus()) dismiss(); }, 0);
    const message = (message: any, sender: chrome.runtime.MessageSender) => {
      if (sender.id !== chrome.runtime.id || message?.source !== 'justonehop-recent' || message.session !== initial.session) return;
      if (message.type === 'step') move(message.direction);
      if (message.type === 'released' && !state.current.searching) void finish();
      if (message.type === 'removed') {
        const current = state.current;
        const selected = filterRecentTabs(current.tabs, current.query)[current.index]?.id;
        current.tabs = current.tabs.filter(tab => tab.id !== message.tabId);
        current.index = recentSelection(filterRecentTabs(current.tabs, current.query), selected === message.tabId ? initial.sourceId : selected, -1);
        changed();
      }
    };
    view.addEventListener('keydown', keydown);
    view.addEventListener('keyup', keyup);
    view.addEventListener('compositionstart', compositionStart);
    view.addEventListener('compositionend', compositionEnd);
    view.addEventListener('blur', blur);
    window.addEventListener('blur', blur);
    chrome.runtime.onMessage.addListener(message);
    return () => {
      alive = false; state.current.confirmation.close(); port.disconnect();
      view.removeEventListener('keydown', keydown); view.removeEventListener('keyup', keyup); view.removeEventListener('blur', blur);
      view.removeEventListener('compositionstart', compositionStart); view.removeEventListener('compositionend', compositionEnd);
      window.removeEventListener('blur', blur); chrome.runtime.onMessage.removeListener(message);
    };
  }, []);
  useLayoutEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [revision]);
  const current = state.current;
  const visible = filterRecentTabs(current.tabs, current.query);
  return <NavigationRoot><BackLayer onBack={dismiss}><div className="justonehop-app overlay recent-overlay" data-theme={getPreferences().theme} data-closing={!current.confirmation.canSelect}
    onMouseDown={event => { if (event.target === event.currentTarget) dismiss(); }}>
    <section className="palette" aria-label={t('extensionName')}>
      <RecentSwitcherView tabs={visible} index={current.index} query={current.query} searching={current.searching}
        onSearch={() => { current.searching = true; changed(); }} onQueryChange={query => {
        if (!current.confirmation.canSelect) return;
        const selected = filterRecentTabs(current.tabs, current.query)[current.index]?.id;
        current.query = query; current.index = recentSelection(filterRecentTabs(current.tabs, query), selected); changed();
      }} sourceId={initial.sourceId} loaded closing={!current.confirmation.canSelect}
        error={current.error} shortcut={initial.shortcut} releaseKey={initial.modifier} theme={getPreferences().theme} listRef={list}
        onSelect={index => { if (!current.confirmation.canSelect) return; current.index = index; changed(); void finish(); }} onConfirm={() => void finish()} onCancel={dismiss} />
    </section>
  </div></BackLayer></NavigationRoot>;
}
