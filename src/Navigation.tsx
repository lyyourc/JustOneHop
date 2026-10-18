import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useWheelBack } from './useWheelBack';
import { t } from './i18n';

type Layer = { depth: number; closes: boolean; back: () => void };
const Layers = createContext<Map<symbol, Layer> | null>(null);
const Depth = createContext(0);

function topLayer(layers: Map<symbol, Layer>) {
  return [...layers.values()].reduce<Layer | undefined>((selected, layer) =>
    !selected || layer.depth > selected.depth ? layer : selected, undefined);
}

/** Mouse dismissal uses the same innermost layer as Escape. */
export function useNavigateBack() {
  const layers = useContext(Layers);
  if (!layers) throw new Error('useNavigateBack requires NavigationRoot');
  return () => {
    const top = topLayer(layers);
    if (top) flushSync(top.back);
  };
}

/** One back-navigation owner per mounted palette. Escape is focus-independent. */
export function NavigationRoot({ children }: { children: ReactNode }) {
  const surface = useRef<HTMLDivElement>(null);
  const [layers] = useState(() => new Map<symbol, Layer>());
  const wheelHint = useWheelBack(surface, () => {
    const top = topLayer(layers);
    if (!top) return;
    const palette = surface.current?.querySelector('.palette, .recent-switcher');
    const dismiss = palette?.querySelector('.search-dismiss');
    return { identity: top, defer: top.closes, back: () => flushSync(top.back),
      label: top.depth === 1 ? dismiss?.getAttribute('aria-label') || t('closePalette') : t('back') };
  });
  useLayoutEffect(() => {
    // Overlay React code runs in the content-script realm, but its DOM lives in
    // an iframe. Listening to the ambient `window` alone misses those keys.
    const view = surface.current!.ownerDocument.defaultView!;
    const parentView = view.frameElement?.ownerDocument.defaultView;
    const views = new Set([view, ...(parentView ? [parentView] : [])]);
    const navigateBack = (event: KeyboardEvent) => {
      const backspace = event.key === 'Backspace';
      if ((!backspace && event.key !== 'Escape') || event.isComposing || event.keyCode === 229) return;
      if (backspace) {
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        // Window events are retargeted outside the closed shadow tree. Resolve
        // focus from our own root, not event.target (which can be iframe body).
        const root = surface.current!.getRootNode() as Document | ShadowRoot;
        const focused = root.activeElement as HTMLElement | null;
        if (focused?.tagName === 'INPUT') {
          if (!focused.hasAttribute('data-back-on-empty') || (focused as HTMLInputElement).value !== '') return;
        } else if (focused?.tagName === 'TEXTAREA' || (focused?.isContentEditable && focused !== view.document.body)) return;
      }
      const top = topLayer(layers);
      if (!top || (backspace && top.depth === 1)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // Holding a back key must not unwind the entire stack. Commit each discrete
      // press before the next one so its handler cannot refer to a removed layer.
      if (!event.repeat) flushSync(top.back);
    };
    for (const target of views) target.addEventListener('keydown', navigateBack, true);
    return () => { for (const target of views) target.removeEventListener('keydown', navigateBack, true); };
  }, [layers]);
  return <Layers.Provider value={layers}><div ref={surface} className="navigation-root">{children}{wheelHint}</div></Layers.Provider>;
}

/** Depth follows the rendered hierarchy, never effect/registration order. */
export function BackLayer({ onBack, active = true, closes, children }: { onBack: () => void; active?: boolean; closes?: boolean; children: ReactNode }) {
  const layers = useContext(Layers);
  const parentDepth = useContext(Depth);
  const depth = parentDepth + (active ? 1 : 0);
  const callback = useRef(onBack);
  useLayoutEffect(() => { callback.current = onBack; });
  useLayoutEffect(() => {
    if (!layers) throw new Error('BackLayer requires NavigationRoot');
    if (!active) return;
    const id = Symbol();
    layers.set(id, { depth, closes: closes ?? depth === 1, back: () => callback.current() });
    return () => { layers.delete(id); };
  }, [layers, depth, active, closes]);
  return <Depth.Provider value={depth}>{children}</Depth.Provider>;
}
