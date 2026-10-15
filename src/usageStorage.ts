import { addUsage, usageQuery, USAGE_STORAGE_KEY } from './usage';

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

export const resetUsage = () => enqueue(() => chrome.storage.local.remove(USAGE_STORAGE_KEY));
