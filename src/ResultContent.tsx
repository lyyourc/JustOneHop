import type { ReactNode } from 'react';
import { Favicon } from './Favicon';
import { HighlightedText } from './HighlightedText';

/** Shared visual slots; selection, pointer and execution semantics belong to each list. */
export function ResultContent({ title, subtitle, query, icon, pageUrl, kind, color, metadata, allowTypos = true }: {
  title: string; subtitle?: ReactNode; query: string; icon: ReactNode; pageUrl?: string;
  kind?: string; color?: string; metadata?: ReactNode; allowTypos?: boolean;
}) {
  return <>
    <span className={`entry-icon ${kind || ''}`} data-color={color}><Favicon pageUrl={pageUrl} fallback={icon} /></span>
    <span className="entry-copy"><span className="entry-title"><HighlightedText text={title} query={query} allowTypos={allowTypos} /></span>
      {subtitle ? <span className="entry-subtitle">{typeof subtitle === 'string' ? <HighlightedText text={subtitle} query={query} allowTypos={false} /> : subtitle}</span> : null}
    </span>
    {metadata ? <span className="entry-meta">{metadata}</span> : null}
  </>;
}
