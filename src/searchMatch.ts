import Fuse from 'fuse.js';
import { pinyinMatches } from './pinyinMatch';

/** Inclusive ranges shared by result eligibility and highlighting. */
export function termMatches(text: string, term: string, allowTypos = true): [number, number][] {
  if (!term) return [];
  const literal = [...text.matchAll(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'))];
  if (literal.length) return literal.map(match => [match.index, match.index + match[0].length - 1]);
  const phonetic = pinyinMatches(text, term);
  if (phonetic.length) return phonetic;
  // Short terms, Chinese, numbers and URL-shaped tokens need literal matches. A one-letter
  // error in "iam" is too ambiguous to infer the user's intent.
  if (!allowTypos || !/^[a-z]{4,}$/i.test(term)) return [];
  const words = [...text.matchAll(/[a-z]+/gi)]
    .filter(word => Math.abs(word[0].length - term.length) <= 1);
  // Match a similarly sized whole word, never an arbitrary fragment of a long
  // URL or keyword. Six-letter words can tolerate an adjacent transposition.
  const threshold = (term.length >= 6 ? 2 : 1) / term.length;
  const matches = new Fuse(words.map(word => word[0]), {
    threshold, location: 0, distance: 0, includeMatches: true,
  }).search(term);
  return matches.flatMap(result => (result.matches || []).flatMap(match =>
    match.indices.map(([start, end]): [number, number] =>
      [words[result.refIndex].index + start, words[result.refIndex].index + end])));
}
