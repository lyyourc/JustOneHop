/** Canonical bindings use Mod for Command on macOS and Control elsewhere. */
export function shortcutKeys(binding: string, isMac: boolean): string[] {
  return binding.split('+').map(key => key === 'Mod' ? isMac ? '⌘' : 'Ctrl'
    : key === 'Shift' ? isMac ? '⇧' : 'Shift' : key === 'Enter' ? '↵' : key);
}
export function matchesShortcut(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, binding: string, isMac: boolean): boolean {
  const parts = binding.toLowerCase().split('+');
  return event.key.toLowerCase() === parts.at(-1) && event.metaKey === (isMac && parts.includes('mod'))
    && event.ctrlKey === (!isMac && parts.includes('mod')) && event.shiftKey === parts.includes('shift') && !event.altKey;
}
export function Shortcut({ binding, isMac }: { binding: string; isMac: boolean }) {
  const keys = shortcutKeys(binding, isMac);
  return <span className="key-chord entry-shortcut" aria-label={keys.join(' + ')}>{keys.map((key, index) => <kbd key={index}>{key}</kbd>)}</span>;
}
