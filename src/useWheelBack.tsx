import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useWheel } from '@use-gesture/react';
import { ArrowLeft } from 'lucide-react';
import { WheelBackGesture, WHEEL_BACK_IDLE_MS, wheelNeedsScrolling } from './wheelBack';

type BackTarget = { back: () => void; label: string; identity: object; defer: boolean };

export function useWheelBack(surface: RefObject<HTMLDivElement | null>, target: () => BackTarget | undefined) {
  const [hint, setHint] = useState<{ palette: Element; label: string; progress: number }>();
  const currentTarget = useRef(target);
  currentTarget.current = target;
  const [session] = useState(() => ({ gesture: new WheelBackGesture(), active: false,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    target: undefined as BackTarget | undefined, palette: undefined as Element | undefined }));
  const cancel = () => {
    // Keep the sequence blocked until its tail ends, even if another input
    // closes a menu or changes focus while the user is still scrolling.
    if (session.active) session.gesture.block();
    setHint(undefined);
  };
  useEffect(() => {
    const element = surface.current!;
    const view = element.ownerDocument.defaultView!;
    element.addEventListener('pointerdown', cancel, true);
    view.addEventListener('keydown', cancel, true);
    view.addEventListener('compositionstart', cancel, true);
    view.addEventListener('blur', cancel);
    return () => {
      clearTimeout(session.timer);
      element.removeEventListener('pointerdown', cancel, true);
      view.removeEventListener('keydown', cancel, true);
      view.removeEventListener('compositionstart', cancel, true);
      view.removeEventListener('blur', cancel);
    };
  }, [session, surface]);
  useWheel(({ event, delta: [dx, dy], last }) => {
    // use-gesture's debounced `last` is not a physical finger-up signal.
    if (last) return;
    const element = surface.current!;
    if (!session.active) {
      session.active = true;
      session.target = currentTarget.current();
      const path = event.composedPath();
      session.palette = path.find(item => (item as Element).classList?.contains('palette') ||
        (item as Element).classList?.contains('recent-switcher')) as Element | undefined;
      if (!session.palette || !session.target || wheelNeedsScrolling(event, element)) session.gesture.block();
    }
    const excluded = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.buttons !== 0 ||
      session.target?.identity !== currentTarget.current()?.identity;
    const result = session.gesture.update(dx, dy, excluded);
    if (result.capture) {
      // A standalone extension window has no underlying webpage to navigate.
      // Chromium may report its wheel events as non-cancelable over fixed chrome.
      const standalone = !element.ownerDocument.defaultView!.frameElement && element.ownerDocument.location.protocol === 'chrome-extension:';
      if (!event.cancelable && !standalone) { session.gesture.block(); setHint(undefined); }
      else {
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
        if (!session.target?.defer && session.gesture.consume()) {
          // Consume before synchronously unmounting the layer. The root survives
          // and keeps intercepting this sequence, even over a new scroll reader.
          setHint(undefined);
          session.target?.back();
        } else {
          setHint(result.progress > 0 && session.palette && session.target ? {
            palette: session.palette, label: session.target.label, progress: result.progress,
          } : undefined);
        }
      }
    } else setHint(undefined);
    clearTimeout(session.timer);
    session.timer = setTimeout(() => {
      const shouldBack = session.gesture.finish();
      const selected = session.target;
      session.active = false; session.target = undefined; session.palette = undefined;
      setHint(undefined);
      if (shouldBack && selected?.identity === currentTarget.current()?.identity) selected?.back();
    }, WHEEL_BACK_IDLE_MS);
  }, { target: surface, eventOptions: { passive: false, capture: true } });
  return hint && createPortal(<div className="wheel-back-hint" aria-hidden="true" data-ready={hint.progress === 1}
    style={{ opacity: .45 + hint.progress * .55, transform: `translateX(${(hint.progress - 1) * 16}px)` }}>
    <ArrowLeft size={18} /><span>{hint.label}</span>
  </div>, hint.palette);
}
