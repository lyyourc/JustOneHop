import { useId, useLayoutEffect, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from './i18n';
import { NavigationHint } from './Shortcut';

const IDLE_PEEK_INTERVAL_MS = 8000;
const RETREAT_DELAY_MS = 3000;

export function FooterHint({ children, textSlot, suppressed }: { children?: ReactNode; textSlot: HTMLElement | null; suppressed: boolean }) {
  const [peeking, setPeeking] = useState(false);
  const [blinking, setBlinking] = useState(false);
  const [earAction, setEarAction] = useState<string>('');
  const [shift, setShift] = useState(0);
  const [floating, setFloating] = useState(false);

  const root = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const [hiddenByClick, setHiddenByClick] = useState(false);
  const [awake, setAwake] = useState(false);
  const [wakeRevision, setWakeRevision] = useState(0);
  const id = useId();
  const expanded = awake && !suppressed;

  useEffect(() => {
    // Overlay DOM belongs to the iframe, while React runs in the content-script realm.
    const doc = root.current!.ownerDocument;
    const view = doc.defaultView!;
    const page = view.frameElement?.ownerDocument || doc;
    const views = new Set([view, page.defaultView!]);
    const documents = new Set([doc, page]);
    const motion = view.matchMedia('(prefers-reduced-motion: reduce)');
    const timers = new Set<number>();
    let focused = page.hasFocus();
    const schedule = (callback: () => void, delay: number) => {
      // The sandbox forbids iframe script timers; run callbacks in React's realm.
      const timer = window.setTimeout(() => { timers.delete(timer); callback(); }, delay);
      timers.add(timer);
    };
    const stop = () => {
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
      setPeeking(false); setBlinking(false); setEarAction('');
    };
    const blink = () => {
      setBlinking(true);
      schedule(() => setBlinking(false), 200);
    };
    const ears = () => {
      const actions = ['twitch-left', 'twitch-right', 'pivot-left', 'pivot-right'];
      setEarAction(actions[Math.floor(Math.random() * actions.length)]);
      schedule(() => setEarAction(''), 850);
      schedule(ears, 1600 + Math.random() * 2200);
    };
    const blinking = () => {
      blink();
      schedule(blinking, 2200 + Math.random() * 3200);
    };
    const peek = () => {
      setPeeking(true); setEarAction('alert-v');
      schedule(() => setEarAction(''), 850);
      schedule(blink, 950);
      schedule(() => setPeeking(false), RETREAT_DELAY_MS);
      schedule(peek, IDLE_PEEK_INTERVAL_MS);
    };
    const start = () => {
      stop();
      if (!focused || [...documents].some(document => document.hidden)) return;
      if (awake && !hovered) schedule(() => setAwake(false), RETREAT_DELAY_MS);
      if (motion.matches) return;
      schedule(ears, 1600);
      if (awake || hovered) schedule(blinking, 600);
      else schedule(peek, IDLE_PEEK_INTERVAL_MS);
    };
    const blur = () => { focused = false; stop(); };
    const focus = () => { focused = page.hasFocus(); start(); };
    for (const target of views) {
      target.addEventListener('blur', blur);
      target.addEventListener('focus', focus);
    }
    for (const target of documents) target.addEventListener('visibilitychange', focus);
    motion.addEventListener('change', start);
    start();
    return () => {
      stop();
      for (const target of views) {
        target.removeEventListener('blur', blur);
        target.removeEventListener('focus', focus);
      }
      for (const target of documents) target.removeEventListener('visibilitychange', focus);
      motion.removeEventListener('change', start);
    };
  }, [awake, hovered, wakeRevision]);

  // Bounds measurement
  useLayoutEffect(() => {
    if (!textSlot || !bubble.current) return;
    const content = bubble.current;
    const footer = textSlot.closest('footer')!;
    const fit = () => {
      const bounds = footer.getBoundingClientRect(), origin = textSlot.getBoundingClientRect();
      const width = content.scrollWidth;
      const trigger = button.current!.getBoundingClientRect();
      setFloating(width > origin.width);
      setShift(Math.max(bounds.left + 8 - origin.left, Math.min(trigger.left - origin.left, bounds.right - 8 - origin.left - width)));
    };
    fit();
    const observer = new ResizeObserver(fit);
    for (const element of [footer, content, textSlot]) observer.observe(element);
    return () => observer.disconnect();
  }, [children, textSlot]);

  function key(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) event.preventDefault();
  }

  return <div ref={root} className="footer-hint" data-expanded={expanded} data-awake={awake} data-peeking={peeking || (hovered && !hiddenByClick)} data-floating={floating}
      style={{ '--hint-shift': `${shift}px` } as CSSProperties}>
      <div className="footer-hint-character">
        <div className="footer-hint-capsule">
          <button ref={button} type="button" className={`footer-hint-pet ${blinking ? 'do-blink' : ''} ${earAction}`}
            aria-expanded={expanded} aria-controls={id}
            aria-label={t(awake ? 'hideKeyboardHints' : 'showKeyboardHints')}
            title={t(awake ? 'hideKeyboardHints' : 'showKeyboardHints')}
            onKeyDown={key} onClick={() => {
              setAwake(value => !value);
              setPeeking(false);
              setHiddenByClick(awake);
              setWakeRevision(value => value + 1);
            }}
            onMouseEnter={() => { setHovered(true); setHiddenByClick(false); }} onMouseLeave={() => setHovered(false)}>
            <svg className="footer-hint-bunny" viewBox="0 0 28 28" fill="none" aria-hidden="true">
              {/* Left ear */}
              <g className="ear-left">
                <path d="M9.5 12C7.8 9.5 7 6 9.5 5C11.2 4.2 12.5 8 11.8 12Z" fill="#F1F5F9" stroke="#475569" strokeWidth="1.2" />
                <path d="M9.5 10.5C8.6 9 8.3 7 9.5 6.2C10.2 5.8 11 7.5 10.5 10.5Z" fill="#F472B6" opacity="0.7" />
              </g>
              {/* Right ear */}
              <g className="ear-right">
                <path d="M18.5 12C20.2 9.5 21 6 18.5 5C16.8 4.2 15.5 8 16.2 12Z" fill="#F1F5F9" stroke="#475569" strokeWidth="1.2" />
                <path d="M18.5 10.5C19.4 9 19.7 7 18.5 6.2C17.8 5.8 17 7.5 17.5 10.5Z" fill="#F472B6" opacity="0.7" />
              </g>
              {/* Head & Body */}
              <path d="M7 16C7 11.5 9.5 10.5 14 10.5C18.5 10.5 21 11.5 21 16C21 19.8 18.5 21.5 14 21.5C9.5 21.5 7 19.8 7 16Z" fill="#F1F5F9" stroke="#475569" strokeWidth="1.2" />
              {/* Blushing cheeks */}
              <circle cx="9" cy="17" r="1.4" fill="#F472B6" opacity="0.65" />
              <circle cx="19" cy="17" r="1.4" fill="#F472B6" opacity="0.65" />
              {/* Blinking Eyes */}
              <g className="bunny-eyes">
                <circle cx="11.2" cy="14.5" r="1.3" fill="#0F172A" />
                <circle cx="16.8" cy="14.5" r="1.3" fill="#0F172A" />
                <circle cx="10.8" cy="14.1" r="0.4" fill="#FFFFFF" />
                <circle cx="16.4" cy="14.1" r="0.4" fill="#FFFFFF" />
              </g>
              {/* Nose */}
              <path d="M13.2 16.7L14.8 16.7L14 17.6Z" fill="#F472B6" />
              {/* Paws */}
              <ellipse cx="9.5" cy="21.5" rx="1.8" ry="1.1" fill="#FFFFFF" stroke="#475569" strokeWidth="1" />
              <ellipse cx="18.5" cy="21.5" rx="1.8" ry="1.1" fill="#FFFFFF" stroke="#475569" strokeWidth="1" />
            </svg>
          </button>
        </div>
      </div>
      {textSlot ? createPortal(<div ref={bubble} id={id} className="footer-hint-bubble" data-expanded={expanded} data-floating={floating}
        style={{ '--hint-shift': `${shift}px` } as CSSProperties} aria-hidden={!expanded} inert={!expanded}>
        {children || <NavigationHint controls />}
      </div>, textSlot) : null}
    </div>;
}
