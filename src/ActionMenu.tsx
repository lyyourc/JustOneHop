import { matchesShortcut, Shortcut } from './Shortcut';
import { BackLayer } from './Navigation';
import { SearchDismissButton } from './SearchDismissButton';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { t } from './i18n';
import { HighlightedText } from './HighlightedText';

export interface MenuAction { id: string; title: string; icon?: ReactNode; alias?: string; danger?: boolean; disabled?: boolean; shortcut?: string }

/** Pages own their actions; this component owns menu focus, navigation and rendering. */
export function ActionMenu({ id, title, actions, query, onQueryChange, selectedId, onSelectionChange, onAction, onClose, isMac }: {
  id: string; title: ReactNode; actions: MenuAction[]; query: string; onQueryChange: (query: string) => void;
  selectedId?: string; onSelectionChange: (id: string) => void; onAction: (id: string) => void; onClose: () => void; isMac: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const selected = actions.find(action => action.id === selectedId) || actions[0];
  useLayoutEffect(() => { input.current?.focus(); }, []);
  useLayoutEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selected?.id]);
  return <BackLayer onBack={onClose}>
    <button className="action-scrim" tabIndex={-1} aria-label={t('backToResults')} onClick={onClose} />
    <div tabIndex={-1} className="action-menu" role="dialog" aria-label={t('actionMenu')} aria-modal="true" onKeyDown={event => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      const shortcutAction = actions.find(action => !action.disabled && action.shortcut && matchesShortcut(event, action.shortcut, isMac));
      if (shortcutAction) { event.preventDefault(); if (!event.repeat) onAction(shortcutAction.id); return; }
      const mod = isMac ? event.metaKey : event.ctrlKey;
      if ((mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k')) { event.preventDefault(); onClose(); return; }
      if (event.key === 'Tab') {
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input, button:not(:disabled)'));
        const at = controls.indexOf(event.target as HTMLElement);
        event.preventDefault(); controls[(at + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus(); return;
      }
      const emacs = event.ctrlKey && !event.metaKey && !event.altKey && ['p', 'n'].includes(event.key.toLowerCase());
      const arrow = ['ArrowDown', 'ArrowUp'].includes(event.key);
      if (!event.shiftKey && (arrow || emacs || ['PageDown', 'PageUp'].includes(event.key))) {
        event.preventDefault();
        if (!actions.length) return;
        const index = actions.findIndex(action => action.id === selected?.id);
        const down = event.key === 'ArrowDown' || event.key === 'PageDown' || event.key.toLowerCase() === 'n';
        let next = (index + (down ? 1 : -1) + actions.length) % actions.length;
        if (arrow && mod) next = down ? actions.length - 1 : 0;
        else if (event.altKey || event.key.startsWith('Page')) {
          const row = list.current?.querySelector<HTMLElement>('[role="option"]');
          const step = Math.max(1, Math.floor((list.current?.clientHeight ?? 280) / (row?.offsetHeight || 36)) - 1);
          next = Math.max(0, Math.min(actions.length - 1, index + (down ? step : -step)));
        }
        onSelectionChange(actions[next].id);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (!event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && selected && !selected.disabled) onAction(selected.id);
      }
    }}>
      <div className="action-heading">{title}</div>
      <div ref={list} className="action-list" id={id} role="listbox" aria-label={t('availableActions')}>
        {actions.map(action => <div key={action.id} id={`${id}-${action.id}`} role="option" aria-selected={action.id === selected?.id} aria-disabled={action.disabled || undefined}
          className={`action-row ${action.danger ? 'danger' : ''}`} onClick={() => { if (!action.disabled) onAction(action.id); }} onMouseMove={event => {
            const next = { x: event.screenX, y: event.screenY };
            if (pointer.current && (pointer.current.x !== next.x || pointer.current.y !== next.y)) onSelectionChange(action.id);
            pointer.current = next;
          }}>
          {action.icon}<span><HighlightedText text={action.title} query={query} />{action.alias ? <span className="action-alias"><HighlightedText text={action.alias} query={query} /></span> : null}</span>
          {action.shortcut ? <Shortcut binding={action.shortcut} isMac={isMac} /> : !action.disabled && action.id === selected?.id ? <kbd title={`Enter — ${action.title}`} aria-label={`Enter — ${action.title}`}>↵</kbd> : null}
        </div>)}
        {!actions.length ? <p className="action-empty">{t('noActions')}</p> : null}
      </div>
      <div className="action-search"><Search size={15} /><input data-back-on-empty ref={input} value={query} onChange={event => onQueryChange(event.target.value)}
        placeholder={t('searchActionsPlaceholder')} aria-label={t('searchActions')} role="combobox" aria-expanded="true" aria-controls={id}
        aria-activedescendant={selected ? `${id}-${selected.id}` : undefined} autoComplete="off" spellCheck={false} />
        <SearchDismissButton label={t('back')} /></div>
    </div>
  </BackLayer>;
}
