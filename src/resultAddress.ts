import type { Entry } from './types';

export interface ResultAddress { base: string; detail: string; url: string }

/** Presentation only: keep candidate identities, matching and destinations intact. */
export function distinctResultAddresses(entries: Entry[]): Map<string, ResultAddress> {
  const groups = new Map<string, { entry: Entry; url: string; suffix: string }[]>();
  for (const entry of entries) {
    if (!entry.url || !['tab', 'bookmark', 'history'].includes(entry.kind)) continue;
    const key = JSON.stringify([entry.title, entry.subtitle]);
    try {
      const url = new URL(entry.url);
      const group = groups.get(key) ?? [];
      group.push({ entry, url: url.href, suffix: url.search + url.hash });
      groups.set(key, group);
    } catch { /* Invalid addresses keep their original label. */ }
  }
  const addresses = new Map<string, ResultAddress>();
  for (const group of groups.values()) {
    if (new Set(group.map(item => item.url)).size < 2) continue;
    const suffixes = new Map<string, Set<string>>();
    for (const { url, suffix } of group) {
      const urls = suffixes.get(suffix) ?? new Set();
      urls.add(url); suffixes.set(suffix, urls);
    }
    for (const { entry, url, suffix } of group) {
      // Protocols and ports can also collide in concise labels; show the full URL then.
      const full = suffixes.get(suffix)!.size > 1;
      addresses.set(entry.id, { base: full ? '' : entry.subtitle, detail: full ? url : suffix, url });
    }
  }
  return addresses;
}
