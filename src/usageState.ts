import { normalizeUsage, USAGE_STORAGE_KEY, type UsageRecord } from './usage';

let current: UsageRecord[] = [];
let revision = 0;
const listeners = new Set<() => void>();
export const getUsage = () => current;
export const subscribeUsage = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
function update(value: unknown) {
  current = normalizeUsage(value);
  listeners.forEach(listener => listener());
}
const storage = globalThis.chrome?.storage;
const initialRevision = revision;
storage?.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[USAGE_STORAGE_KEY]) {
    revision += 1;
    update(changes[USAGE_STORAGE_KEY].newValue);
  }
});
export const usageReady = storage ? storage.local.get(USAGE_STORAGE_KEY).then(value => {
  if (revision === initialRevision) update(value[USAGE_STORAGE_KEY]);
}).catch(() => {}) : Promise.resolve();
