import { RecentSwitcherView } from './RecentSwitcherView';
import { alignPanelWindow } from './panelGeometry';
import { filterRecentTabs, recentNavigation, recentSelection } from './recentSearch';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { NavigationRoot, BackLayer } from './Navigation';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getPreferences, preferencesReady } from './preferences';
import { t, errorMessage } from './i18n';
import './style.css';

// Register keyboard listeners before any async work: release during loading is
// remembered. The webpage bridge covers release before this document exists.
const params = new URLSearchParams(location.search);
const session = params.get('session');
const sourceId = Number(params.get('tab'));
const windowId = Number(params.get('window'));
let tabs: chrome.tabs.Tab[] = [];
let index = 0;
let query = '';
let composing = false;
let searching = false;
const visibleTabs = () => filterRecentTabs(tabs, query);
let offset = session ? 0 : Number(params.get('direction')) === -1 ? -1 : 1;
type NavigationKey = Parameters<typeof recentNavigation>[0];
const startupNavigation: ({ kind: 'step'; direction: number } | { kind: 'key'; event: NavigationKey })[] = [];
const pageSize = () => Math.max(1, Math.floor((document.querySelector('.recent-list')?.clientHeight || 400) / 40));
let loaded = false;
let closing = false;
let aborted = false;
let error = '';
let shortcut = '';
let releaseKey = params.get('modifier') || 'Control';
let ownWindowId: number | undefined;
let returningFocus = false;
let revision = 0;
let hadFocus = document.hasFocus();
let acceptAfterLoad = false;
const listeners = new Set<() => void>();
const changed = () => { revision++; listeners.forEach(listener => listener()); };
function dismiss() { aborted = true; closing = true; window.close(); }
function stepIndex(direction: number, count: number) {
  return !count ? -1 : index < 0 ? (direction > 0 ? 0 : count - 1) : (index + direction % count + count) % count;
}
function move(direction: number) {
  if (closing || aborted || acceptAfterLoad || composing) return;
  if (!loaded) startupNavigation.push({ kind: 'step', direction });
  else index = stepIndex(direction, visibleTabs().length);
  changed();
}
async function finish() {
  if (closing || aborted || composing) return;
  if (!loaded || startupNavigation.length) { acceptAfterLoad = true; return; }
  const targetId = visibleTabs()[index]?.id;
  if (targetId === undefined) return;
  closing = true;
  try {
    const [source, target] = await Promise.all([chrome.tabs.get(sourceId), chrome.tabs.get(targetId)]);
    if (target.windowId !== windowId) throw new Error(t('errorMovedTab'));
    // Do not follow stale sessions or steal focus after an interrupted accept.
    if (aborted || !document.hasFocus() || !source.active || source.windowId !== windowId) { dismiss(); return; }
    await chrome.tabs.update(targetId, { active: true });
    if (aborted || !document.hasFocus()) { dismiss(); return; }
    returningFocus = true;
    await chrome.windows.update(windowId, { focused: true });
    window.close();
  } catch (reason) {
    if (aborted) return;
    closing = false; returningFocus = false; acceptAfterLoad = false;
    error = errorMessage(reason); changed();
  }
}
window.addEventListener('compositionstart', () => { composing = true; });
window.addEventListener('compositionend', () => { composing = false; });
window.addEventListener('keyup', event => {
  if (event.key === releaseKey && !event.isComposing && event.keyCode !== 229 && !searching) { event.preventDefault(); void finish(); }
});
window.addEventListener('keydown', event => {
  if (event.isComposing || event.keyCode === 229 || composing || closing || aborted) return;
  if (event.key.toLowerCase() === 'f' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
    event.preventDefault(); searching = true; acceptAfterLoad = false; changed();
  } else if (event.key === 'Enter') {
    // A focused button owns Enter, just as it owns a mouse click.
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    if (!event.repeat && !event.metaKey && !event.altKey && !event.shiftKey && !event.ctrlKey) void finish();
  } else {
    const next = recentNavigation(event, index, visibleTabs().length, pageSize());
    if (next !== undefined) {
      event.preventDefault();
      if (!loaded) {
        if (!acceptAfterLoad) {
          const { key, ctrlKey, metaKey, altKey, shiftKey } = event;
          startupNavigation.push({ kind: 'key', event: { key, ctrlKey, metaKey, altKey, shiftKey } });
        }
      } else { index = next; changed(); }
    }
  }
});
window.addEventListener('focus', () => { hadFocus = true; if (loaded && acceptAfterLoad && !searching) void finish(); });
window.addEventListener('blur', () => { if (hadFocus && !returningFocus) dismiss(); });
document.addEventListener('visibilitychange', () => { if (hadFocus && document.hidden && !returningFocus) dismiss(); });
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || message?.source !== 'zing-recent' || !session || message.session !== session) return;
  if (message.type === 'released' && !searching) void finish();
  if (message.type === 'step') move(message.direction);
});
chrome.commands.onCommand.addListener(command => {
  if (session) return;
  if (command === 'switch-recent') move(1);
  if (command === 'switch-recent-back') move(-1);
});
chrome.windows.onFocusChanged.addListener(id => {
  if (id === ownWindowId) { hadFocus = true; if (loaded && acceptAfterLoad && !searching) void finish(); }
  else if (hadFocus && ownWindowId !== undefined && !returningFocus) dismiss();
});
chrome.windows.onRemoved.addListener(id => { if (id === windowId) dismiss(); });
function removeTab(id: number) {
  if (id === sourceId) { dismiss(); return; }
  const at = tabs.findIndex(tab => tab.id === id);
  if (at < 0) return;
  const selected = visibleTabs()[index]?.id;
  tabs.splice(at, 1);
  if (!tabs.length) { dismiss(); return; }
  // Removing a row never activates its neighbor without a navigation action.
  index = recentSelection(visibleTabs(), selected === id ? sourceId : selected, -1);
  changed();
}
chrome.tabs.onRemoved.addListener(removeTab);
chrome.tabs.onDetached.addListener(removeTab);
const port = chrome.runtime.connect({ name: 'zing' });
window.addEventListener('pagehide', () => { aborted = true; port.disconnect(); }, { once: true });

function Switcher() {
  useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => revision);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [index, loaded, query, revision]);
  return <RecentSwitcherView tabs={visibleTabs()} index={index} query={query} searching={searching}
    onSearch={() => { searching = true; acceptAfterLoad = false; changed(); }} onQueryChange={value => {
    if (closing || aborted) return;
    const selected = visibleTabs()[index]?.id;
    query = value; index = recentSelection(visibleTabs(), selected); error = ''; changed();
  }} sourceId={sourceId} loaded={loaded} closing={closing}
    error={error} shortcut={shortcut} releaseKey={releaseKey} theme={getPreferences().theme} listRef={list}
    onSelect={at => { if (closing) return; index = at; changed(); void finish(); }} onConfirm={() => void finish()} onCancel={dismiss} />;
}
function SwitcherRoot() {
  useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => revision);
  return <NavigationRoot><BackLayer onBack={dismiss}>{loaded ? <Switcher /> : null}</BackLayer></NavigationRoot>;
}
const root = createRoot(document.getElementById('root')!);
// Install the shared Escape route before the asynchronous focus handoff.
flushSync(() => root.render(<SwitcherRoot />));
void Promise.all([
  // A managed session already has the ordered source-window tabs in its
  // handoff. Only the standalone fallback needs to fetch them here.
  preferencesReady, session ? Promise.resolve([] as chrome.tabs.Tab[]) : chrome.tabs.query({ windowId }), chrome.commands.getAll(), chrome.windows.getCurrent(),
]).then(async ([, all, bindings, own]) => {
  if (aborted) return;
  await alignPanelWindow(sourceId, windowId).catch(() => {});
  if (aborted) return;
  ownWindowId = own.id;
  shortcut = bindings.find(binding => binding.name === (Number(params.get('direction')) === -1 ? 'switch-recent-back' : 'switch-recent'))?.shortcut || '';
  releaseKey = /Command|⌘/.test(shortcut) ? 'Meta' : /Alt|Option|⌥/.test(shortcut) ? 'Alt' : 'Control';
  const handoff = session ? await chrome.runtime.sendMessage({ source: 'zing-recent', type: 'ready', session }) : undefined;
  if (session && !handoff) { dismiss(); return; }
  if (aborted) return;
  if (handoff) { offset += handoff.offset; acceptAfterLoad ||= handoff.released && !searching; }
  tabs = (handoff?.tabs as chrome.tabs.Tab[] || all).filter(tab => tab.id !== undefined).sort((a, b) => Number(b.id === sourceId) - Number(a.id === sourceId) || (b.lastAccessed || 0) - (a.lastAccessed || 0) || a.index - b.index);
  index = tabs.length ? (offset % tabs.length + tabs.length) % tabs.length : 0;
  index = recentSelection(visibleTabs(), tabs[index]?.id);
  loaded = true; document.documentElement.lang = t('languageTag'); document.title = `zing · ${t('recentSwitcher')}`;
  // Mount first so buffered paging uses the actual list height. Keep the queue
  // intact during focus handoff so a pending release cannot confirm too early.
  flushSync(changed);
  const count = visibleTabs().length;
  const loadedPageSize = pageSize();
  for (const navigation of startupNavigation.splice(0)) {
    index = navigation.kind === 'step' ? stepIndex(navigation.direction, count)
      : recentNavigation(navigation.event, index, count, loadedPageSize) ?? index;
  }
  changed();
  if (acceptAfterLoad && !searching && document.hasFocus()) requestAnimationFrame(() => { if (!searching) void finish(); });
}).catch(reason => { if (aborted) return; error = errorMessage(reason); loaded = true; changed(); });
