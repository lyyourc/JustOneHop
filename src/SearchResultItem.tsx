import type { ComponentProps } from 'react';
import {
  BookOpen, Code, Pencil, Database, Cookie, ArrowRight, ArrowDownToLine, Bookmark,
  Layers, Pin, Plus, RotateCcw, Puzzle, KeyRound, Download, History, Keyboard,
  Settings2, Volume2, VolumeX, X, PanelTop,
} from 'lucide-react';
import { ResultContent } from './ResultContent';
import { HistoryMetadata } from './HistoryMetadata';
import { CurrentTabBadge } from './CurrentTabBadge';
import { HighlightedText } from './HighlightedText';
import { Shortcut } from './Shortcut';
import { entrySearchQuery, entryTitle } from './entryPresentation';
import { matchingAlias } from './model';
import { t, countMessage } from './i18n';
import type { Entry, IconName } from './types';

const icons = { help: BookOpen, extension: Puzzle, password: KeyRound, download: Download, history: History, keyboard: Keyboard, tab: PanelTop, bookmark: Bookmark, plus: Plus, reload: RotateCcw, close: X,
  others: Layers, right: ArrowRight, restore: RotateCcw, pin: Pin, volume: Volume2, settings: Settings2, database: Database, cookie: Cookie, script: Code, edit: Pencil, tuck: ArrowDownToLine };
export function EntryGlyph({ name, size = 18 }: { name: IconName; size?: number }) {
  const Icon = icons[name]; return <Icon size={size} strokeWidth={1.7} aria-hidden="true" />;
}

/** Every main-search kind shares this presentation; callers own navigation and execution. */
export function SearchResultItem({ entry, query, selected, isMac, showKind = true, suppressTabShortcuts = false, ...props }: {
  entry: Entry; query: string; selected: boolean; isMac: boolean; showKind?: boolean; suppressTabShortcuts?: boolean;
} & Pick<ComponentProps<'div'>, 'id' | 'onClick' | 'onMouseMove' | 'onContextMenu'>) {
  const alias = entry.kind === 'command' ? matchingAlias(entry, query) : '';
  const protectPinned = entry.action === 'closeOthers' || entry.action === 'closeRight';
  const subtitle = entry.kind !== 'command' || entry.action === 'searchAllHistory' ? entry.subtitle
    : alias ? <><HighlightedText text={alias} query={entrySearchQuery(query)} />{protectPinned ? ` · ${t('keepPinned')}` : ''}</>
      : protectPinned ? t('keepPinned') : '';
  const shortcut = suppressTabShortcuts && ['close', 'reload'].includes(entry.action) ? undefined : entry.shortcut;
  return <div {...props} role="option" aria-selected={selected} className={`result ${entry.kind} ${entry.danger ? 'danger' : ''}`} title={`${entryTitle(entry)} — ${entry.subtitle}`}>
    <ResultContent title={entryTitle(entry)} subtitle={subtitle} query={entrySearchQuery(query)} kind={entry.kind} color={entry.groupColor}
      pageUrl={entry.faviconPageUrl} icon={<EntryGlyph name={entry.icon} />}
      metadata={<>
        {shortcut ? <Shortcut binding={shortcut} isMac={isMac} /> : null}
        {entry.groupCount !== undefined ? <span className="kind-label">{countMessage('groupTabOne', 'groupTabCount', entry.groupCount)}</span> : null}
        {entry.groupTitle ? <span className="tab-group-badge" data-color={entry.groupColor}><HighlightedText text={entry.groupTitle} query={query} /></span> : null}
        {entry.pinned ? <Pin size={12} aria-label={t('pinned')} /> : null}
        {entry.muted ? <VolumeX size={13} aria-label={t('muted')} /> : null}
        <CurrentTabBadge current={!!entry.active} />
        {entry.tucked && !entry.groupTitle ? <span className="tucked-badge">{t('tucked')}</span> : null}
        {entry.kind === 'history' ? <HistoryMetadata lastVisitTime={entry.lastVisitTime} showKind={showKind} />
          : showKind && (entry.kind === 'tab' || entry.kind === 'bookmark') ? <span className="kind-label">{t(entry.kind === 'tab' ? 'tabKind' : 'bookmarkKind')}</span> : null}
        {entry.action === 'searchAllHistory' ? <ArrowRight size={14} /> : null}
      </>} />
  </div>;
}
