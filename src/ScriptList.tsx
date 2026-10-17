import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Code2, Keyboard, Search } from 'lucide-react';
import { HighlightedText } from './HighlightedText';
import { SearchDismissButton } from './SearchDismissButton';
import { t } from './i18n';
import type { SavedScript } from './scripts';

/** Script management and execution share the same searchable candidate surface. */
export function ScriptList({ id, scripts, selected, query, onQueryChange, onSelect, onActivate, onContextMenu, searchRef, isMac, emptyLabel, detail, active = true }: {
  id: string; scripts: SavedScript[]; selected?: SavedScript; query: string; onQueryChange: (query: string) => void;
  onSelect: (id: string) => void; onActivate: (script: SavedScript) => void; onContextMenu?: (script: SavedScript) => void;
  searchRef: RefObject<HTMLInputElement | null>; isMac: boolean; emptyLabel?: string; detail?: ReactNode; active?: boolean;
}) {
  const list = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => { if (active) list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selected?.id, active]);
  return <div className="script-list-surface" onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if ((event.target as HTMLElement).closest('.script-list-detail')) return;
    const arrow = event.key === 'ArrowDown' || event.key === 'ArrowUp';
    const emacs = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && ['n', 'p'].includes(event.key.toLowerCase());
    if (!event.shiftKey && (arrow || emacs || ['PageDown', 'PageUp'].includes(event.key))) {
      event.preventDefault(); event.stopPropagation();
      if (!scripts.length) return;
      const index = scripts.findIndex(script => script.id === selected?.id);
      const down = event.key === 'ArrowDown' || event.key === 'PageDown' || event.key.toLowerCase() === 'n';
      let next = (index + (down ? 1 : -1) + scripts.length) % scripts.length;
      if (arrow && (isMac ? event.metaKey : event.ctrlKey)) next = down ? scripts.length - 1 : 0;
      else if (event.altKey || event.key.startsWith('Page')) {
        const row = list.current?.querySelector<HTMLElement>('.result');
        const step = Math.max(1, Math.floor((list.current?.clientHeight ?? 280) / (row?.offsetHeight || 40)) - 1);
        next = Math.max(0, Math.min(scripts.length - 1, index + (down ? step : -step)));
      }
      onSelect(scripts[next].id);
    } else if (event.key === 'Enter' && (event.target as HTMLElement).tagName !== 'BUTTON') {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && selected) onActivate(selected);
    }
  }}>
    <header className="search-bar script-search"><span className="search-icon"><Search size={20} /></span>
      <input data-back-on-empty ref={searchRef} value={query} onChange={event => onQueryChange(event.target.value)}
        placeholder={t('searchScripts')} aria-label={t('searchScripts')} role="combobox" aria-expanded="true" aria-autocomplete="list"
        aria-controls={id} aria-activedescendant={selected ? `${id}-${selected.id}` : undefined} autoComplete="off" spellCheck={false} />
      <SearchDismissButton label={t('back')} />
    </header>
    <div className={`script-list-content ${detail ? 'with-detail' : ''}`}>
    <div ref={list} className="results script-list" id={id} role="listbox" aria-label={t('scriptLibrary')}>
      {scripts.map(script => <div key={script.id} id={`${id}-${script.id}`} role="option" aria-selected={script.id === selected?.id}
        className={`result script-item ${script.id === selected?.id ? 'selected' : ''}`} title={script.title}
        onClick={() => { onSelect(script.id); if (detail) searchRef.current?.focus({ preventScroll: true }); else onActivate(script); }}
        onMouseMove={event => {
          if (detail) return;
          const next = { x: event.screenX, y: event.screenY };
          if (pointer.current && (pointer.current.x !== next.x || pointer.current.y !== next.y)) onSelect(script.id);
          pointer.current = next;
        }} onContextMenu={onContextMenu ? event => { event.preventDefault(); onSelect(script.id); onContextMenu(script); } : undefined}>
        <span className="entry-icon script">{script.id === 'builtin-ctrl-tab' ? <Keyboard size={18} /> : <Code2 size={18} />}</span>
        <span className="entry-copy"><span className="entry-title"><HighlightedText text={script.title} query={query} allowTypos={false} /></span></span>
        {script.id === 'builtin-ctrl-tab' ? <span className="kind-label">{t('builtInScript')}</span> : null}
      </div>)}
      {!scripts.length ? <p className="empty">{emptyLabel || t('noResults')}</p> : null}
    </div>
    {detail ? <div className="script-list-detail">{detail}</div> : null}
    </div>
  </div>;
}
