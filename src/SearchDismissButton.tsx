import { X } from 'lucide-react';
import type { RefObject } from 'react';
import { useNavigateBack } from './Navigation';
import { t } from './i18n';

/** Clear the current query; an empty search keeps the Escape navigation hint. */
export function SearchDismissButton({ label, query, onClear, input, disabled = false }: {
  label: string; query: string; onClear: () => void; input: RefObject<HTMLInputElement | null>; disabled?: boolean;
}) {
  const back = useNavigateBack();
  const clearing = query.length > 0;
  const description = clearing ? t('clearSettingsSearch') : `Escape — ${label}`;
  return <button type="button" className={`icon-button close-button search-dismiss${clearing ? ' search-clear' : ''}`} aria-label={clearing ? description : label}
    data-dismiss-label={label} aria-keyshortcuts={clearing ? undefined : 'Escape'} title={description} disabled={disabled}
    onMouseDown={event => {
      // Preserve the active layer until click: outside-mousedown handlers must
      // not close a dropdown first and make this click dismiss its parent too.
      event.preventDefault(); event.stopPropagation();
    }}
    onKeyDown={event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.keyCode === 229 || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) event.preventDefault();
    }}
    onClick={() => {
      if (clearing) { onClear(); input.current?.focus(); }
      else back();
    }}><kbd aria-hidden="true">esc</kbd><X className="search-dismiss-icon" size={16} strokeWidth={1.7} aria-hidden="true" /></button>;
}
