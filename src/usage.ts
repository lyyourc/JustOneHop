import type { Entry } from './types';

/** Local selections; an empty query represents commands run without a search. */
export interface UsageRecord { query: string; target: string; weight: number; lastUsed: number }
export const USAGE_STORAGE_KEY = 'searchUsage';
const HALF_LIFE = 14 * 24 * 60 * 60 * 1000;
const MAX_AGE = 90 * 24 * 60 * 60 * 1000;
const MAX_RECORDS = 500;

export const usageQuery = (query: string) => query.trim().toLowerCase().replace(/\s+/g, ' ');

export function usageTarget(entry: Entry): string {
  if (entry.kind === 'tab') return `tab:${entry.keywords}`;
  if (entry.kind === 'bookmark') return `bookmark:${entry.bookmarkId}`;
  return `command:${entry.action}`;
}

export function usageWeight(record: UsageRecord, now = Date.now()): number {
  return record.weight * 2 ** (-Math.max(0, now - record.lastUsed) / HALF_LIFE);
}

export function normalizeUsage(value: unknown, now = Date.now()): UsageRecord[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((record): record is UsageRecord => record !== null && typeof record === 'object' &&
    typeof record.query === 'string' && record.query.length <= 200 &&
    typeof record.target === 'string' && record.target.length > 0 && record.target.length <= 4096 &&
    Number.isFinite(record.weight) && record.weight > 0 && record.weight <= 100 &&
    Number.isFinite(record.lastUsed) && record.lastUsed > now - MAX_AGE && record.lastUsed <= now)
    .map(record => ({ query: usageQuery(record.query), target: record.target, weight: record.weight, lastUsed: record.lastUsed }))
    .filter(record => record.query.length > 0 || record.target.startsWith('command:'))
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .filter(record => {
      const key = JSON.stringify([record.query, record.target]);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, MAX_RECORDS);
}

export function addUsage(value: unknown, query: string, target: string, now = Date.now()): UsageRecord[] {
  const history = normalizeUsage(value, now);
  const normalized = usageQuery(query);
  if ((!normalized && !target.startsWith('command:')) || normalized.length > 200 || !target || target.length > 4096) return history;
  const previous = history.find(record => record.query === normalized && record.target === target);
  return [{ query: normalized, target, weight: Math.min(100, (previous ? usageWeight(previous, now) : 0) + 1), lastUsed: now },
    ...history.filter(record => record !== previous)].slice(0, MAX_RECORDS);
}

export function queryUsage(history: UsageRecord[], query: string, now = Date.now()): Map<string, number> {
  const normalized = usageQuery(query);
  return new Map(history.filter(record => record.query === normalized && record.lastUsed > now - MAX_AGE)
    .map(record => [record.target, usageWeight(record, now)]));
}

/** Sum each selection once across queries, including commands run from home/actions. */
export function commandUsage(history: UsageRecord[], now = Date.now()): Map<string, number> {
  const scores = new Map<string, number>();
  for (const record of normalizeUsage(history, now)) {
    if (record.target.startsWith('command:')) {
      scores.set(record.target, (scores.get(record.target) || 0) + usageWeight(record, now));
    }
  }
  return scores;
}
