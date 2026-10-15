import { termMatches } from './searchMatch';

/** Split the original text, preserving its spelling and whitespace for rendering. */
export function highlightParts(text: string, query: string, allowTypos = true): { text: string; matched: boolean }[] {
  const terms = [...new Set(query.trim().split(/\s+/).filter(Boolean))];
  if (!terms.length || !text) return [{ text, matched: false }];
  const matched = new Uint8Array(text.length);
  for (const term of terms) {
    for (const [start, end] of termMatches(text, term, allowTypos)) matched.fill(1, start, end + 1);
  }
  const parts: { text: string; matched: boolean }[] = [];
  let offset = 0;
  // Iterate code points so a fuzzy match cannot split an emoji's surrogate pair.
  for (const character of text) {
    const hit = matched.subarray(offset, offset + character.length).some(Boolean);
    const previous = parts.at(-1);
    if (previous?.matched === hit) previous.text += character;
    else parts.push({ text: character, matched: hit });
    offset += character.length;
  }
  return parts;
}
