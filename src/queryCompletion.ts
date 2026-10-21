import { normalizeUsage, usageWeight, type UsageRecord } from './usage';

/** Only successful, non-destructive selections can supply a query hint. */
export function queryCompletion(history: UsageRecord[], prefix: string, safeCommands: ReadonlySet<string>, now = Date.now()): string {
  if (!prefix.trim() || prefix !== prefix.trimStart()) return '';
  const normalized = prefix.toLowerCase();
  const candidates = new Map<string, { text: string; weight: number; lastUsed: number }>();
  for (const record of normalizeUsage(history, now)) {
    if (!/^(tab|bookmark):.+/.test(record.target) && record.target !== 'query:navigation' && !safeCommands.has(record.target)) continue;
    if (!record.query.startsWith(normalized) || record.query.length <= prefix.length) continue;
    const previous = candidates.get(record.query);
    candidates.set(record.query, { text: previous && previous.lastUsed > record.lastUsed ? previous.text : record.queryText ?? record.query,
      weight: (previous?.weight ?? 0) + usageWeight(record, now), lastUsed: Math.max(previous?.lastUsed ?? 0, record.lastUsed) });
  }
  const best = [...candidates].sort((a, b) => b[1].weight - a[1].weight || b[1].lastUsed - a[1].lastUsed || a[0].localeCompare(b[0]))[0]?.[1].text;
  return best ? prefix + best.slice(prefix.length) : '';
}
