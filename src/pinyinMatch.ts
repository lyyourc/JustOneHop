import { pinyin } from 'pinyin-pro';

interface Reading {
  full: string;
  initials: string;
  starts: number[];
  offsets: number[];
  end: number;
}

const cache = new Map<string, Reading[]>();

function readings(text: string): Reading[] {
  if (!/\p{Script=Han}/u.test(text)) return [];
  const cached = cache.get(text);
  if (cached) return cached;
  const result = [...text.matchAll(/\p{Script=Han}+/gu)].map(run => {
    const syllables = pinyin(run[0], { toneType: 'none', type: 'array', v: true });
    const starts: number[] = [], offsets: number[] = [];
    let full = '', offset = run.index;
    const chars = [...run[0]];
    syllables.forEach((syllable, i) => {
      starts.push(full.length);
      offsets.push(offset);
      full += syllable;
      offset += chars[i].length;
    });
    return { full, initials: syllables.map(syllable => syllable[0]).join(''), starts, offsets, end: offset };
  });
  // Titles and history change during a session; retain only a bounded working set.
  if (cache.size >= 2048) cache.delete(cache.keys().next().value!);
  cache.set(text, result);
  return result;
}

export const isPinyinTerm = (term: string) => /^[a-z]{2,}$/i.test(term);

/** Search index hints only; eligibility and highlighting use syllable boundaries below. */
export function pinyinKeywords(text: string): string[] {
  return readings(text).flatMap(reading => [reading.full, reading.initials]);
}

/** Inclusive UTF-16 ranges in the original text, never in its transliteration. */
export function pinyinMatches(text: string, term: string): [number, number][] {
  if (!isPinyinTerm(term)) return [];
  term = term.toLowerCase();
  const matches: [number, number][] = [];
  for (const reading of readings(text)) {
    reading.starts.forEach((start, i) => {
      // A partial final syllable is useful while typing; starting inside one is noise.
      if (reading.full.startsWith(term, start)) {
        const next = reading.starts.findIndex(value => value >= start + term.length);
        matches.push([reading.offsets[i], (next < 0 ? reading.end : reading.offsets[next]) - 1]);
      } else if (reading.initials.startsWith(term, i)) {
        matches.push([reading.offsets[i], (reading.offsets[i + term.length] ?? reading.end) - 1]);
      }
    });
  }
  return matches;
}
