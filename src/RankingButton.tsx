import { useId, useLayoutEffect, useRef, useState } from 'react';
import { History, X } from 'lucide-react';
import { rankingDescription } from './rankingPresentation';
import { t } from './i18n';
import type { RankingInfo } from './usage';

/** A quiet history marker becomes the direct forget control on hover or focus. */
export function RankingButton({ query, ranking, selected, disabled, onForget }: {
  query: string; ranking: RankingInfo; selected: boolean; disabled: boolean; onForget: () => void;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const label = t(query.trim() ? 'forgetQueryRanking' : 'forgetCommandRanking');
  const open = !disabled && (hovered || focused);
  useLayoutEffect(() => {
    const tip = tooltip.current;
    const anchor = button.current;
    if (!tip || !anchor || !open) return;
    // The top layer avoids clipping by the results scroller in either carrier.
    tip.showPopover();
    const view = anchor.ownerDocument.defaultView!;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const bounds = tip.getBoundingClientRect();
      tip.style.left = `${Math.max(8, Math.min(rect.right - bounds.width, view.innerWidth - bounds.width - 8))}px`;
      const below = rect.bottom + 6;
      tip.style.top = `${Math.max(8, below + bounds.height <= view.innerHeight - 8 ? below : rect.top - bounds.height - 6)}px`;
    };
    place();
    view.addEventListener('resize', place);
    view.addEventListener('scroll', place, true);
    return () => {
      tip.hidePopover();
      view.removeEventListener('resize', place);
      view.removeEventListener('scroll', place, true);
    };
  }, [open, label, query, ranking.promoted]);
  return <button ref={button} type="button" className="ranking-forget" data-promoted={ranking.promoted}
    aria-label={label} aria-describedby={id} aria-keyshortcuts="Shift+Backspace" title=""
    tabIndex={selected ? 0 : -1} disabled={disabled}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
    onClick={event => { event.stopPropagation(); onForget(); }}
    onKeyDown={event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault(); event.stopPropagation();
      if (!event.nativeEvent.isComposing && event.keyCode !== 229 && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) onForget();
    }}>
    <History className="ranking-history-icon" size={14} aria-hidden="true" />
    <X className="ranking-remove-icon" size={14} aria-hidden="true" />
    <span ref={tooltip} id={id} role="tooltip" popover="manual" className="ranking-tooltip">
      <span className="ranking-tooltip-action">{label}<kbd>Shift+Backspace</kbd></span>
      <span>{rankingDescription(ranking)}</span>
    </span>
  </button>;
}
