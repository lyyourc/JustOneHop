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
  const normalized = usageQuery(query);
  if ((!normalized && !target.startsWith('command:')) || normalized.length > 200 || !target || target.length > 4096) return Promise.resolve();
  return enqueue(async () => {
    const stored = await chrome.storage.local.get(USAGE_STORAGE_KEY);
    await chrome.storage.local.set({ [USAGE_STORAGE_KEY]: addUsage(stored[USAGE_STORAGE_KEY], normalized, target) });
  });
}

export async function forgetUsage(target: string, query?: string): Promise<void> {
  if (typeof target !== 'string' || !target || target.length > 4096) throw new Error('Invalid usage target');
  if (query !== undefined && typeof query !== 'string') throw new Error('Invalid usage query');
  const normalized = query === undefined ? undefined : usageQuery(query);
  if (normalized !== undefined && normalized.length > 200) throw new Error('Invalid usage query');
  return enqueue(async () => {
    const stored = await chrome.storage.local.get(USAGE_STORAGE_KEY);
    const history = normalizeUsage(stored[USAGE_STORAGE_KEY]);
    await chrome.storage.local.set({ [USAGE_STORAGE_KEY]: history.filter(record =>
      record.target !== target || (normalized !== undefined && record.query !== normalized)) });
  });
}

export const resetUsage = () => enqueue(() => chrome.storage.local.remove(USAGE_STORAGE_KEY));
