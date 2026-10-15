import { memo } from 'react';
import { highlightParts } from './highlight';

export const HighlightedText = memo(function HighlightedText({ text, query, allowTypos = true }: { text: string; query: string; allowTypos?: boolean }) {
  return <>{highlightParts(text, query, allowTypos).map((part, index) => part.matched
    ? <mark className="search-match" key={index}>{part.text}</mark> : part.text)}</>;
});
