import { t } from './i18n';
import type { Entry } from './types';

export interface SavedScript { id: string; title: string; code: string }
const prefix = 'saved-script:';
let current: SavedScript[] = [];
const listeners = new Set<() => void>();
export const getScripts = () => current;
export const subscribeScripts = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function parse(key: string, value: unknown): SavedScript | undefined {
  const script = value as Partial<SavedScript> | null;
  if (key.startsWith(prefix) && script && typeof script.title === 'string' && typeof script.code === 'string')
    return { id: key.slice(prefix.length), title: script.title, code: script.code };
}
function changed() { current.sort((a, b) => a.title.localeCompare(b.title)); listeners.forEach(listener => listener()); }
export const scriptsReady = chrome.storage.local.get(null).then(values => {
  current = Object.entries(values).flatMap(([key, value]) => { const script = parse(key, value); return script ? [script] : []; });
  changed();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [key, change] of Object.entries(changes)) {
    if (!key.startsWith(prefix)) continue;
    current = current.filter(script => script.id !== key.slice(prefix.length));
    const script = parse(key, change.newValue);
    if (script) current.push(script);
    changed();
  }
});
export async function saveScript(script: SavedScript) {
  await scriptsReady;
  if (!script.title.trim() || !script.code.trim()) throw new Error(t('scriptRequired'));
  await chrome.storage.local.set({ [prefix + script.id]: { title: script.title.trim(), code: script.code } });
}
export async function deleteScript(id: string) { await chrome.storage.local.remove(prefix + id); }
export function bindingScript(): SavedScript {
  return {
    id: 'builtin-ctrl-tab', title: t('bindCtrlTab'),
    code: `['switch-recent', 'switch-recent-back'].forEach((commandName, i) => chrome.developerPrivate.updateExtensionCommand({extensionId: ${JSON.stringify(chrome.runtime.id)}, commandName, keybinding: i ? 'Ctrl+Shift+Tab' : 'Ctrl+Tab'}));`,
  };
}
export function scriptEntries(scripts: SavedScript[]): Entry[] {
  return [bindingScript(), ...scripts].map(script => ({
    id: `script:${script.id}`, scriptId: script.id, kind: 'script', category: 'script', action: script.id === 'builtin-ctrl-tab' ? 'copyScript' : 'runScript', icon: 'script', title: script.title,
    subtitle: t(script.id === 'builtin-ctrl-tab' ? 'copyScript' : 'runScript'), keywords: script.id === 'builtin-ctrl-tab' ? 'ctrl tab shortcut binding keyboard 快捷键 绑定 脚本 script' : 'script snippet 脚本 代码',
  }));
}
