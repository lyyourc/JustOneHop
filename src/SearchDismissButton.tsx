import { useNavigateBack } from './Navigation';

/** An Escape hint and mouse target that dismiss only the innermost active layer. */
export function SearchDismissButton({ label }: { label: string }) {
  const back = useNavigateBack();
  const description = `Escape — ${label}`;
  return <button type="button" className="icon-button close-button search-dismiss" aria-label={label} aria-keyshortcuts="Escape" title={description}
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
    onClick={back}><kbd title={description} aria-label={description}>esc</kbd></button>;
}
