import { Logo } from './Logo';
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { t } from './i18n';
import { availableSearchButton, hasControlFocus } from './searchFocus';

/** A visible recovery path when automatic input focus was lost. */
export function SearchFocusButton({ input, size = 20, disabled = false }: {
  input: RefObject<HTMLInputElement | null>; size?: number; disabled?: boolean;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [focusHint, setFocusHint] = useState<'focusSearchHint' | 'focusSearchClickHint' | null>(null);
  useLayoutEffect(() => {
    const node = button.current!;
    const scope = node.closest<HTMLElement>('.justonehop-app')!;
    const view = node.ownerDocument.defaultView!;
    const focusRoot = node.getRootNode();
    let active = true;
    const pageDocument = view.frameElement?.ownerDocument || node.ownerDocument;
    const update = () => {
      if (!active) return;
      const pageFocused = pageDocument.hasFocus();
      setFocusHint(availableSearchButton(scope) === node && (!pageFocused || !hasControlFocus(scope))
        ? pageFocused ? 'focusSearchHint' : 'focusSearchClickHint' : null);
    };
    const deferredUpdate = () => queueMicrotask(update);
    update();
    focusRoot.addEventListener('focusin', update);
    focusRoot.addEventListener('focusout', deferredUpdate);
    view.addEventListener('focusin', update);
    view.addEventListener('focusout', deferredUpdate);
    const views = new Set([view, pageDocument.defaultView!]);
    for (const target of views) {
      target.addEventListener('focus', update);
      target.addEventListener('blur', deferredUpdate);
    }
    return () => {
      active = false;
      focusRoot.removeEventListener('focusin', update); focusRoot.removeEventListener('focusout', deferredUpdate);
      view.removeEventListener('focusin', update); view.removeEventListener('focusout', deferredUpdate);
      for (const target of views) {
        target.removeEventListener('focus', update); target.removeEventListener('blur', deferredUpdate);
      }
    };
  }, [disabled]);
  return <><button ref={button} type="button" className="search-icon search-focus" data-focus-search disabled={disabled}
    aria-label={t('focusSearch')} title={t('focusSearch')}
    onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
    onKeyDown={event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.keyCode === 229 || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) event.preventDefault();
    }}
    onClick={() => input.current?.focus({ preventScroll: true })}><Logo size={size} /></button>
    {focusHint ? <span className="search-focus-hint" role="status">{t(focusHint)}</span> : null}</>;
}
