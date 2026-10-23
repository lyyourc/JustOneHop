import { normalizeSearchIcon } from './searchIconData';

export type Language = 'system' | 'zh' | 'en';
export type Theme = 'system' | 'light' | 'dark';
export interface Preferences { language: Language; theme: Theme; autoTuck: boolean; autoTuckAfterHours: number; searchIcon?: string; hidePet?: boolean }
export const DEFAULT_AUTO_TUCK_HOURS = 168;
export function isAutoTuckAfterHours(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 8760;
}

export function normalizePreferences(value: unknown): Preferences {
  const data = value as Partial<Preferences> | null;
  const searchIcon = normalizeSearchIcon(data?.searchIcon);
  return {
    ...(searchIcon ? { searchIcon } : {}),
    ...(data?.hidePet === true ? { hidePet: true } : {}),
    language: data?.language === 'zh' || data?.language === 'en' ? data.language : 'system',
    theme: data?.theme === 'light' || data?.theme === 'dark' ? data.theme : 'system',
    autoTuck: data?.autoTuck === true,
    autoTuckAfterHours: isAutoTuckAfterHours(data?.autoTuckAfterHours) ? data.autoTuckAfterHours : DEFAULT_AUTO_TUCK_HOURS,
  };
}
let current = normalizePreferences(null);
const listeners = new Set<() => void>();
function update(value: unknown) {
  const next = normalizePreferences(value);
  if (current.language === next.language && current.theme === next.theme && current.autoTuck === next.autoTuck && current.autoTuckAfterHours === next.autoTuckAfterHours && current.searchIcon === next.searchIcon && current.hidePet === next.hidePet) return;
  current = next;
  listeners.forEach(listener => listener());
}
export const getPreferences = () => current;
export const subscribePreferences = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
// Content scripts and extension pages share the same local extension storage.
const storage = globalThis.chrome?.storage;
export const preferencesReady = storage
  ? storage.local.get('preferences').then(data => update(data.preferences)).catch(() => {})
  : Promise.resolve();
storage?.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.preferences) update(changes.preferences.newValue);
});
let pendingSave = Promise.resolve();
export function savePreferences(patch: Partial<Preferences>): Promise<void> {
  // Keep rapid keyboard changes in order without disabling the next control.
  const write = pendingSave.then(async () => {
    const stored = await chrome.storage.local.get('preferences');
    const next = normalizePreferences({ ...normalizePreferences(stored.preferences), ...patch });
    await chrome.storage.local.set({ preferences: next });
    update(next);
  });
  pendingSave = write.catch(() => {});
  return write;
}
