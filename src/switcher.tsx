import { Favicon } from './Favicon';
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { ArrowLeftRight, Pin } from 'lucide-react';
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
let offset = session ? 0 : Number(params.get('direction')) === -1 ? -1 : 1;
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
function move(direction: number) {
  if (closing || aborted || acceptAfterLoad) return;
  if (!loaded) offset += direction;
  else if (tabs.length) index = (index + direction + tabs.length) % tabs.length;
  changed();
}
async function finish() {
  if (closing || aborted) return;
  if (!loaded) { acceptAfterLoad = true; return; }
  const targetId = tabs[index]?.id;
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
window.addEventListener('keyup', event => {
  if (event.key === releaseKey && !event.isComposing) { event.preventDefault(); void finish(); }
});
window.addEventListener('keydown', event => {
  if (event.isComposing) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    dismiss();
  }
  else if (event.key === 'Enter' && !event.repeat) { event.preventDefault(); void finish(); }
  else if (event.ctrlKey && !event.metaKey && !event.altKey && ['n', 'p'].includes(event.key.toLowerCase())) {
    event.preventDefault(); move(event.key.toLowerCase() === 'p' ? -1 : 1);
  }
  else if (['ArrowDown', 'ArrowUp', 'Tab'].includes(event.key)) {
    event.preventDefault(); move(event.key === 'ArrowUp' || event.shiftKey ? -1 : 1);
  }
});
window.addEventListener('focus', () => { hadFocus = true; if (loaded && acceptAfterLoad) void finish(); });
window.addEventListener('blur', () => { if (hadFocus && !returningFocus) dismiss(); });
document.addEventListener('visibilitychange', () => { if (hadFocus && document.hidden && !returningFocus) dismiss(); });
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || message?.source !== 'zing-recent' || !session || message.session !== session) return;
  if (message.type === 'released') void finish();
  if (message.type === 'step') move(message.direction);
});
chrome.commands.onCommand.addListener(command => {
  if (session) return;
  if (command === 'switch-recent') move(1);
  if (command === 'switch-recent-back') move(-1);
});
chrome.windows.onFocusChanged.addListener(id => {
  if (id === ownWindowId) { hadFocus = true; if (loaded && acceptAfterLoad) void finish(); }
  else if (hadFocus && ownWindowId !== undefined && !returningFocus) dismiss();
});
chrome.windows.onRemoved.addListener(id => { if (id === windowId) dismiss(); });
function removeTab(id: number) {
  if (id === sourceId) { dismiss(); return; }
  const at = tabs.findIndex(tab => tab.id === id);
  if (at < 0) return;
  const selected = tabs[index]?.id;
  tabs.splice(at, 1);
  if (!tabs.length) { dismiss(); return; }
  // Removing a row never activates its neighbor without a navigation action.
  index = Math.max(0, tabs.findIndex(tab => tab.id === (selected === id ? sourceId : selected)));
  changed();
}
chrome.tabs.onRemoved.addListener(removeTab);
chrome.tabs.onDetached.addListener(removeTab);
const port = chrome.runtime.connect({ name: 'zing' });
window.addEventListener('pagehide', () => { aborted = true; port.disconnect(); }, { once: true });

function Switcher() {
  useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => revision);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.focus(); }, []);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [index, loaded]);
  return <main className="zing-app recent-switcher" data-theme={getPreferences().theme}>
    <header><ArrowLeftRight size={18} /><strong>{t('recentSwitcher')}</strong><span>zing</span><button onClick={dismiss} aria-label={t('recentCancel')}><kbd>esc</kbd></button></header>
    <div className="recent-list" ref={list} tabIndex={0} role="listbox" aria-label={t('recentSwitcher')} aria-activedescendant={tabs[index] ? `recent-${tabs[index].id}` : undefined} aria-busy={!loaded}>
      {!loaded ? <p className="empty">{t('loading')}</p> : !tabs.length ? <p className="empty">{t('noResults')}</p> : tabs.map((tab, at) => <div className="result" role="option" id={`recent-${tab.id}`} key={tab.id} aria-selected={at === index}
        onClick={() => { if (closing) return; index = at; changed(); void finish(); }}>
        <span className="entry-icon tab"><Favicon pageUrl={tab.url} fallback={<ArrowLeftRight size={18} />} /></span><span className="recent-copy"><span className="entry-title">{tab.title || tab.url || t('untitledTab')}</span><span className="recent-url">{tab.url?.replace(/^https?:\/\//, '')}</span></span>
        {tab.pinned ? <Pin size={13} /> : null}{tab.id === sourceId ? <span className="current-badge">{t('recentCurrent')}</span> : null}
      </div>)}
    </div>
    {error ? <p role="alert" className="recent-error">{error}</p> : null}
    <footer><span>{t('recentRelease', releaseKey === 'Meta' ? '⌘' : releaseKey === 'Alt' ? '⌥' : 'Ctrl')}</span><span><kbd>↵</kbd> {t('recentConfirm')}<kbd>esc</kbd> {t('recentCancel')}</span></footer>
    <div className="recent-help">{shortcut} · {t('recentNavigate')}</div>
  </main>;
}
void Promise.all([
  // A managed session already has the ordered source-window tabs in its
  // handoff. Only the standalone fallback needs to fetch them here.
  preferencesReady, session ? Promise.resolve([] as chrome.tabs.Tab[]) : chrome.tabs.query({ windowId }), chrome.commands.getAll(), chrome.windows.getCurrent(),
]).then(async ([, all, bindings, own]) => {
  if (aborted) return;
  ownWindowId = own.id;
  shortcut = bindings.find(binding => binding.name === (Number(params.get('direction')) === -1 ? 'switch-recent-back' : 'switch-recent'))?.shortcut || '';
  releaseKey = /Command|⌘/.test(shortcut) ? 'Meta' : /Alt|Option|⌥/.test(shortcut) ? 'Alt' : 'Control';
  const handoff = session ? await chrome.runtime.sendMessage({ source: 'zing-recent', type: 'ready', session }) : undefined;
  if (session && !handoff) { dismiss(); return; }
  if (aborted) return;
  if (handoff) { offset += handoff.offset; acceptAfterLoad ||= handoff.released; }
  tabs = (handoff?.tabs as chrome.tabs.Tab[] || all).filter(tab => tab.id !== undefined).sort((a, b) => Number(b.id === sourceId) - Number(a.id === sourceId) || (b.lastAccessed || 0) - (a.lastAccessed || 0) || a.index - b.index);
  index = tabs.length ? (offset % tabs.length + tabs.length) % tabs.length : 0;
  loaded = true; document.documentElement.lang = t('languageTag'); document.title = `zing · ${t('recentSwitcher')}`;
  createRoot(document.getElementById('root')!).render(<Switcher />);
  changed();
  if (acceptAfterLoad && document.hasFocus()) requestAnimationFrame(() => void finish());
}).catch(reason => { error = errorMessage(reason); loaded = true; createRoot(document.getElementById('root')!).render(<Switcher />); });
