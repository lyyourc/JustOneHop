/** Persisted evidence, not a permanent Chrome identity. IDs never establish ownership. */
export interface TuckRecord {
  key: string;
  title: string;
  color?: string;
  customTitle?: boolean;
  urls: string[];
  context: string[];
  requiresConfirmation?: boolean;
}
export interface RecoveryGroup {
  id: number;
  windowId: number;
  title: string;
  color: string;
  tabs: { id: number; title: string; url: string }[];
  context: string[];
}
export function sameUrls(a: string[], b: string[]) {
  const left = [...a].sort(), right = [...b].sort();
  return left.length === right.length && left.every((url, index) => url === right[index]);
}
export const groupFingerprint = (group: RecoveryGroup) => JSON.stringify([group.id, group.windowId, group.title, group.color,
  group.tabs.map(tab => [tab.id, tab.url]).sort((a, b) => Number(a[0]) - Number(b[0]))]);
export function recoveryCandidates(record: TuckRecord, groups: RecoveryGroup[]) {
  return groups.filter(group => group.title === record.title ||
    group.tabs.some(tab => record.urls.includes(tab.url)));
}
const matchesEvidence = (record: TuckRecord, group: RecoveryGroup) =>
  group.title === record.title && group.color === (record.color || 'grey') &&
  sameUrls(record.urls, group.tabs.map(tab => tab.url)) && sameUrls(record.context, group.context);
/** Require a one-to-one match on name, color, full URL multiset and window context. */
export function matchRecovery(records: TuckRecord[], groups: RecoveryGroup[]): Map<string, RecoveryGroup> {
  const matches = new Map<string, RecoveryGroup>();
  for (const record of records) {
    if (record.requiresConfirmation) continue;
    const candidates = groups.filter(group => matchesEvidence(record, group));
    if (candidates.length !== 1) continue;
    const group = candidates[0];
    if (records.filter(other => matchesEvidence(other, group)).length !== 1) continue;
    matches.set(record.key, group);
  }
  return matches;
}
export function readTuckRecords(value: unknown): TuckRecord[] {
  const data = value as { version?: number; records?: unknown } | undefined;
  if (data?.version !== 1 || !Array.isArray(data.records)) return [];
  const seen = new Set<string>();
  return data.records.filter((record): record is TuckRecord => {
    const item = record as Partial<TuckRecord> | null;
    if (!item || typeof item.key !== 'string' || !item.key || seen.has(item.key) || typeof item.title !== 'string' ||
      (item.color !== undefined && !['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'].includes(item.color)) ||
      (item.customTitle !== undefined && typeof item.customTitle !== 'boolean') ||
      !Array.isArray(item.urls) || !item.urls.length || !item.urls.every(url => typeof url === 'string') ||
      !Array.isArray(item.context) || !item.context.every(url => typeof url === 'string')) return false;
    seen.add(item.key); return true;
  });
}
