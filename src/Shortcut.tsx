import { t } from './i18n';

/** Canonical bindings use Mod for Command on macOS and Control elsewhere. */
export function shortcutKeys(binding: string, isMac: boolean): string[] {
  return binding.split('+').map(key => key === 'Mod' ? isMac ? '⌘' : 'Ctrl'
    : key === 'Shift' ? isMac ? '⇧' : 'Shift' : key === 'Alt' ? isMac ? '⌥' : 'Alt' : key === 'Enter' ? '↵' : key);
}
export function matchesShortcut(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, binding: string, isMac: boolean): boolean {
  const parts = binding.toLowerCase().split('+');
  return event.key.toLowerCase() === parts.at(-1) && event.metaKey === (isMac && parts.includes('mod'))
    && event.ctrlKey === (!isMac && parts.includes('mod')) && event.shiftKey === parts.includes('shift') && event.altKey === parts.includes('alt');
}
export function formatShortcut(keys: string[]): string {
  return keys.every((key, index) => index === keys.length - 1 || /^[⌘⇧⌥⌃]$/.test(key)) ? keys.join('') : keys.join('+');
}
const keyNames: Record<string, string> = {
  '⌘': 'Command', '⇧': 'Shift', '⌃': 'Control', '⌥': 'Option', '↵': 'Enter', '⇥': 'Tab',
  '↑': 'Arrow Up', '↓': 'Arrow Down', '←': 'Arrow Left', '→': 'Arrow Right',
  '⌫': 'Backspace', '⌦': 'Delete', '⎋': 'Escape', Ctrl: 'Control', Cmd: 'Command', Esc: 'Escape', esc: 'Escape',
};

export function describeShortcut(shortcut: string): string {
  return (shortcut.match(/[⌘⇧⌃⌥↵⇥↑↓←→⌫⌦⎋]|[^⌘⇧⌃⌥↵⇥↑↓←→⌫⌦⎋+]+|\+(?=$)/g) || [])
    .map(key => key.trim()).filter(Boolean).map(key => keyNames[key] || key).join(' + ');
}

export function Shortcut({ binding, isMac }: { binding: string; isMac: boolean }) {
  const keys = shortcutKeys(binding, isMac);
  const description = describeShortcut(formatShortcut(keys));
  return <span className="key-chord entry-shortcut" title={description} aria-label={description}><kbd>{formatShortcut(keys)}</kbd></span>;
}

export function NavigationHint({ controls = false }: { controls?: boolean }) {
  const help = t(controls ? 'settingsNavigationHelp' : 'navigationHelp');
  return <span className={`navigation-hint${controls ? ' settings-navigation' : ''}`} title={help} aria-label={help}>
    <span className="navigation-key"><span className="key-chord"><kbd>{controls ? 'Tab' : 'Ctrl+P'}</kbd></span><span className="navigation-label">{t(controls ? 'nextControl' : 'previousControl')}</span></span>
    <span aria-hidden="true">·</span>
    <span className="navigation-key"><span className="key-chord"><kbd>{controls ? 'Shift+Tab' : 'Ctrl+N'}</kbd></span><span className="navigation-label">{t(controls ? 'previousControl' : 'nextControl')}</span></span>
  </span>;
}
