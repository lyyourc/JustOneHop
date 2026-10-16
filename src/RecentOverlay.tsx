import { useLayoutEffect, useRef, useState } from 'react';
import { RecentSwitcherView } from './RecentSwitcherView';
import { getPreferences } from './preferences';
import { errorMessage, t } from './i18n';

export interface RecentOverlaySession {
  session: string; tabs: chrome.tabs.Tab[]; offset: number; sourceId: number; modifier: string; shortcut: string;
}
export function RecentOverlay({ initial, onClose }: { initial: RecentOverlaySession; onClose: () => void }) {
  const list = useRef<HTMLDivElement>(null);
  const [revision, render] = useState(0);
  const state = useRef({ tabs: initial.tabs, index: (initial.offset % initial.tabs.length + initial.tabs.length) % initial.tabs.length,
    closing: false, error: '' });
  const changed = () => render(value => value + 1);
  const finish = async () => {
    const current = state.current;
    if (current.closing || !list.current?.ownerDocument.hasFocus()) return;
    const tabId = current.tabs[current.index]?.id;
    if (tabId === undefined) return;
    current.closing = true; changed();
    try {
      const reply = await chrome.runtime.sendMessage({ source: 'zing-recent', type: 'accept-overlay', session: initial.session, tabId });
      if (reply?.ok) onClose();
      else { current.closing = false; current.error = errorMessage(new Error(reply?.error || t('errorGeneric'))); changed(); }
    } catch (error) { current.closing = false; current.error = errorMessage(error); changed(); }
  };
  useLayoutEffect(() => {
    const port = chrome.runtime.connect({ name: 'zing' });
    const element = list.current!;
    const view = element.ownerDocument.defaultView!;
    let alive = true;
    port.onDisconnect.addListener(() => { if (alive) onClose(); });
    const move = (direction: number) => {
      const current = state.current;
      if (current.closing || !current.tabs.length) return;
      current.index = (current.index + direction % current.tabs.length + current.tabs.length) % current.tabs.length; changed();
    };
    const keydown = (event: KeyboardEvent) => {
      if (!event.isTrusted || event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); if (!event.repeat) onClose(); }
      else if (event.key === 'Enter') {
        if ((event.target as HTMLElement).closest('button')) return;
        event.preventDefault(); if (!event.repeat) void finish();
      } else if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && ['n', 'p'].includes(event.key.toLowerCase())) {
        event.preventDefault(); move(event.key.toLowerCase() === 'n' ? 1 : -1);
      } else if (['ArrowDown', 'ArrowUp', 'Tab'].includes(event.key)) {
        event.preventDefault(); move(event.key === 'ArrowUp' || event.shiftKey ? -1 : 1);
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.isTrusted && !event.isComposing && event.key === initial.modifier) { event.preventDefault(); void finish(); }
    };
    // A frame focus handoff can blur its parent. Only dismiss after checking
    // the actual document focus; switching to Chrome UI or another app cancels.
    const blur = () => setTimeout(() => { if (alive && !document.hasFocus()) onClose(); }, 0);
    const message = (message: any, sender: chrome.runtime.MessageSender) => {
      if (sender.id !== chrome.runtime.id || message?.source !== 'zing-recent' || message.session !== initial.session) return;
      if (message.type === 'step') move(message.direction);
      if (message.type === 'released') void finish();
      if (message.type === 'removed') {
        const current = state.current;
        const selected = current.tabs[current.index]?.id;
        current.tabs = current.tabs.filter(tab => tab.id !== message.tabId);
        current.index = Math.max(0, current.tabs.findIndex(tab => tab.id === (selected === message.tabId ? initial.sourceId : selected)));
        changed();
      }
    };
    view.addEventListener('keydown', keydown);
    view.addEventListener('keyup', keyup);
    view.addEventListener('blur', blur);
    window.addEventListener('blur', blur);
    chrome.runtime.onMessage.addListener(message);
    element.focus();
    return () => {
      alive = false; port.disconnect();
      view.removeEventListener('keydown', keydown); view.removeEventListener('keyup', keyup); view.removeEventListener('blur', blur);
      window.removeEventListener('blur', blur); chrome.runtime.onMessage.removeListener(message);
    };
  }, []);
  useLayoutEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [revision]);
  const current = state.current;
  return <div className="zing-app overlay recent-overlay" data-theme={getPreferences().theme} data-closing={current.closing}
    onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="palette" aria-label="zing">
      <RecentSwitcherView tabs={current.tabs} index={current.index} sourceId={initial.sourceId} loaded closing={current.closing}
        error={current.error} shortcut={initial.shortcut} releaseKey={initial.modifier} theme={getPreferences().theme} listRef={list}
        onSelect={index => { if (current.closing) return; current.index = index; changed(); void finish(); }} onConfirm={() => void finish()} onCancel={onClose} />
    </section>
  </div>;
}
