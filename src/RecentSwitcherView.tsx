import { type RefObject } from 'react';
import { ArrowLeftRight, Pin } from 'lucide-react';
import { Favicon } from './Favicon';
import { t } from './i18n';

export function RecentSwitcherView({ tabs, index, sourceId, loaded, closing, error, shortcut, releaseKey, theme, listRef, onSelect, onConfirm, onCancel }: {
  tabs: chrome.tabs.Tab[]; index: number; sourceId: number; loaded: boolean; closing: boolean;
  error: string; shortcut: string; releaseKey: string; theme: string;
  listRef: RefObject<HTMLDivElement | null>; onSelect: (index: number) => void; onConfirm: () => void; onCancel: () => void;
}) {
  return <main className="zing-app recent-switcher" data-theme={theme}>
    <header><ArrowLeftRight size={18} /><strong>{t('recentSwitcher')}</strong><span>zing</span><button onClick={onCancel} aria-label={t('recentCancel')}><kbd>esc</kbd></button></header>
    <div className="recent-list" ref={listRef} tabIndex={0} role="listbox" aria-label={t('recentSwitcher')} aria-activedescendant={tabs[index] ? `recent-${tabs[index].id}` : undefined} aria-busy={!loaded}>
      {!loaded ? <p className="empty">{t('loading')}</p> : !tabs.length ? <p className="empty">{t('noResults')}</p> : tabs.map((tab, at) => <div className="result" role="option" id={`recent-${tab.id}`} key={tab.id} aria-selected={at === index}
        title={tab.title || tab.url} onClick={() => onSelect(at)}>
        <span className="entry-icon tab"><Favicon pageUrl={tab.url} fallback={<ArrowLeftRight size={18} />} /></span><span className="recent-copy"><span className="entry-title">{tab.title || tab.url || t('untitledTab')}</span><span className="recent-url">{tab.url?.replace(/^https?:\/\//, '')}</span></span>
        {tab.pinned ? <Pin size={13} /> : null}{tab.id === sourceId ? <span className="current-badge">{t('recentCurrent')}</span> : null}
      </div>)}
    </div>
    {error ? <p role="alert" className="recent-error">{error}</p> : null}
    <footer><span>{t('recentRelease', releaseKey === 'Meta' ? '⌘' : releaseKey === 'Alt' ? '⌥' : 'Ctrl')}</span><span><button aria-label={t('recentConfirm')} disabled={!loaded || !tabs.length || closing} onClick={onConfirm}><kbd>↵</kbd> {t('recentConfirm')}</button><button aria-label={t('recentCancel')} onClick={onCancel}><kbd>esc</kbd> {t('recentCancel')}</button></span></footer>
    <div className="recent-help">{shortcut ? `${shortcut} · ` : ''}{t('recentNavigate')}</div>
  </main>;
}
