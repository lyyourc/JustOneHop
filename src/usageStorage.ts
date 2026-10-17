import { addUsage, normalizeUsage, usageQuery, USAGE_STORAGE_KEY } from './usage';

// Only the service worker writes history. Serialize read-modify-write operations
// so simultaneous palettes cannot overwrite each other's successful selections.
let pending = Promise.resolve();
function enqueue(write: () => Promise<void>): Promise<void> {
  const next = pending.then(write);
  pending = next.catch(() => {});
  return next;
}

export function recordUsage(query: string, target: string): Promise<void> {
  if (typeof query !== 'string' || typeof target !== 'string') return Promise.resolve();
  const normalized = usageQuery(query);
  if ((!normalized && !/^(command|tab|bookmark):.+/.test(target)) || normalized.length > 200 || !target || target.length > 4096) return Promise.resolve();
  return enqueue(async () => {
    const stored = await chrome.storage.local.get(USAGE_STORAGE_KEY);
    await chrome.storage.local.set({ [USAGE_STORAGE_KEY]: addUsage(stored[USAGE_STORAGE_KEY], normalized, target) });
  });
}

export async function forgetUsage(target: string | string[], query?: string): Promise<void> {
  const targets = Array.isArray(target) ? target : [target];
  if (!targets.length || targets.length > 502 || targets.some(value => typeof value !== 'string' || !value || value.length > 4096)) throw new Error('Invalid usage target');
  const identities = new Set(targets);
  if (query !== undefined && typeof query !== 'string') throw new Error('Invalid usage query');
  const normalized = query === undefined ? undefined : usageQuery(query);
  if (normalized !== undefined && normalized.length > 200) throw new Error('Invalid usage query');
  return enqueue(async () => {
    const stored = await chrome.storage.local.get(USAGE_STORAGE_KEY);
    const history = normalizeUsage(stored[USAGE_STORAGE_KEY]);
    await chrome.storage.local.set({ [USAGE_STORAGE_KEY]: history.filter(record =>
      !identities.has(record.target) || (normalized !== undefined && record.query !== normalized)) });
  });
}

export const resetUsage = () => enqueue(() => chrome.storage.local.remove(USAGE_STORAGE_KEY));
