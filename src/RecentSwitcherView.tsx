import { useLayoutEffect, useRef, type RefObject } from 'react';
import { ArrowLeftRight, Pin, Search } from 'lucide-react';
import { HighlightedText } from './HighlightedText';
import { Favicon } from './Favicon';
import { PaletteFooter } from './PaletteFooter';
import { NavigationHint } from './Shortcut';
import { t } from './i18n';

export function RecentSwitcherView({ tabs, index, query, onQueryChange, searching, onSearch, sourceId, loaded, closing, error, shortcut, releaseKey, theme, listRef, onSelect, onConfirm, onCancel }: {
  tabs: chrome.tabs.Tab[]; index: number; query: string; onQueryChange: (query: string) => void;
  searching: boolean; onSearch: () => void;
  sourceId: number; loaded: boolean; closing: boolean;
  error: string; shortcut: string; releaseKey: string; theme: string;
  listRef: RefObject<HTMLDivElement | null>; onSelect: (index: number) => void; onConfirm: () => void; onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { (searching ? input.current : listRef.current)?.focus(); }, [searching, listRef]);
  const activateSearch = () => { onSearch(); input.current?.focus(); };
  return <main className="zing-app recent-switcher" data-theme={theme} onKeyDownCapture={event => {
    if (event.key.toLowerCase() === 'f' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault(); event.stopPropagation(); activateSearch();
    }
    if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229 || event.repeat || event.metaKey || event.altKey || event.shiftKey || event.ctrlKey)) {
      event.preventDefault(); event.stopPropagation();
    }
  }}>
    <header className="search-bar" title={shortcut || undefined}>
      <button className="search-icon recent-search-activate" onPointerDown={event => { event.preventDefault(); activateSearch(); }} onClick={activateSearch}
        onContextMenu={event => event.preventDefault()} aria-label={t('recentSearch')} title={t('recentSearchHelp')}><Search size={20} /></button>
      <span className="recent-search-field" onPointerDown={event => { if (!searching) { event.preventDefault(); activateSearch(); } }}
        onContextMenu={event => { if (!searching || event.ctrlKey) event.preventDefault(); }} title={t('recentSearchHelp')}>
        <input ref={input} disabled={!searching} value={query} onChange={event => onQueryChange(event.target.value)} placeholder={t('recentSearch')}
          aria-label={t('recentSearch')} role="combobox" aria-expanded="true" aria-controls="recent-results" aria-autocomplete="list"
          aria-activedescendant={searching && tabs[index] ? `recent-${tabs[index].id}` : undefined} aria-describedby="recent-navigation"
          autoComplete="off" spellCheck={false} />
      </span>
      <button className="icon-button close-button" onClick={onCancel} aria-label={t('recentCancel')} title={`${t('recentCancel')} (Esc)`}><kbd>esc</kbd></button>
    </header>
    <span className="sr-only" id="recent-navigation">{t('navigationHelp')}</span>
    <div className="results recent-list" id="recent-results" ref={listRef} tabIndex={searching ? -1 : 0} role="listbox" aria-label={t('recentSwitcher')}
      aria-activedescendant={!searching && tabs[index] ? `recent-${tabs[index].id}` : undefined} aria-describedby="recent-navigation" aria-busy={!loaded}>
      {!loaded ? <p className="empty">{t('loading')}</p> : !tabs.length ? <p className="empty">{t('noResults')}</p> : tabs.map((tab, at) => <div className="result" role="option" id={`recent-${tab.id}`} key={tab.id} aria-selected={at === index}
        title={tab.title || tab.url} onClick={() => onSelect(at)}>
        <span className="entry-icon tab"><Favicon pageUrl={tab.url} fallback={<ArrowLeftRight size={18} />} /></span><span className="entry-copy"><span className="entry-title"><HighlightedText text={tab.title || tab.url || t('untitledTab')} query={query} allowTypos={false} /></span><span className="entry-subtitle"><HighlightedText text={tab.url || ''} query={query} allowTypos={false} /></span></span>
        {tab.pinned ? <Pin size={13} /> : null}{tab.id === sourceId ? <span className="current-badge">{t('recentCurrent')}</span> : null}
      </div>)}
    </div>
    {error ? <p role="alert" className="recent-error">{error}</p> : null}
    <PaletteFooter title={searching ? t('recentSwitcher') : t('recentRelease', releaseKey === 'Meta' ? '⌘' : releaseKey === 'Alt' ? '⌥' : 'Ctrl')}
      context={<NavigationHint />}
      primary={{ label: t('recentConfirm'), keys: ['↵'], disabled: !loaded || !tabs[index] || closing, onAction: onConfirm }}
      secondary={{ label: t('recentCancel'), keys: ['esc'], onAction: onCancel }} />
  </main>;
}
