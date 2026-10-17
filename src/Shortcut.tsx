import { t } from './i18n';

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
export function formatShortcut(keys: string[]): string {
  return keys.every((key, index) => index === keys.length - 1 || /^[⌘⇧⌥⌃]$/.test(key)) ? keys.join('') : keys.join('+');
}
export function Shortcut({ binding, isMac }: { binding: string; isMac: boolean }) {
  const keys = shortcutKeys(binding, isMac);
  return <span className="key-chord entry-shortcut" aria-label={keys.join(' + ')}><kbd>{formatShortcut(keys)}</kbd></span>;
}

/** Control navigation works on every platform. Keep each chord semantic while
 *  the footer context renders the hint as quiet supporting text. */
const navigationChords = [{ arrow: '↑', keys: ['Ctrl', 'P'] }, { arrow: '↓', keys: ['Ctrl', 'N'] }];

export function NavigationHint() {
  return <span className="navigation-hint" title={t('navigationHelp')}>
    <span className="navigation-label">{t('navigate')}</span>
    {navigationChords.map(({ arrow, keys }) => <span className="navigation-key" key={arrow} aria-label={`${arrow} ${keys.join(' + ')}`}>
      <span className="navigation-arrow" aria-hidden="true">{arrow}</span>
      <span className="key-chord"><kbd>{formatShortcut(keys)}</kbd></span>
    </span>)}
  </span>;
}
