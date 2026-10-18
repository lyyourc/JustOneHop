import type { KeyboardEvent, ReactNode, Ref } from 'react';
import { ChevronLeft, Settings2 } from 'lucide-react';
import { t } from './i18n';
import { describeShortcut, formatShortcut } from './Shortcut';

function buttonKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  // Keep native activation on the focused button, away from list shortcuts.
  event.stopPropagation();
  if (event.nativeEvent.isComposing || event.keyCode === 229 || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) event.preventDefault();
}

/** Left: one navigation control, the current location, then quiet context or status.
 *  Right: the primary action and action menu. Every layer uses the same slots. */
export function PaletteFooter({ navigation, title, context, status, primary, secondary, actions, isMac = false }: {
  navigation?: { kind: 'settings' | 'back'; label: string; tooltip: string; disabled?: boolean; buttonRef?: Ref<HTMLButtonElement>; onAction: () => void };
  title?: string;
  context?: ReactNode;
  status?: ReactNode;
  primary?: { label: string; keys: string[]; disabled?: boolean; danger?: boolean; onAction: () => void };
  secondary?: { label: string; keys: string[]; icon?: ReactNode; disabled?: boolean; onAction: () => void };
  actions?: { open: boolean; disabled?: boolean; onToggle: () => void };
  isMac?: boolean;
}) {
  const NavigationIcon = navigation?.kind === 'back' ? ChevronLeft : Settings2;
  return <footer className="footer palette-footer">
    <div className="palette-footer-location">
      {navigation ? <button ref={navigation.buttonRef} className={`footer-navigation ${navigation.kind === 'back' ? 'footer-back' : 'settings-button'}`}
        onMouseDown={event => { if (navigation.kind === 'back') { event.preventDefault(); event.stopPropagation(); } }}
        onKeyDown={buttonKeyboard} onClick={navigation.onAction} disabled={navigation.disabled} aria-label={navigation.label} title={navigation.tooltip}>
        <NavigationIcon size={15} aria-hidden="true" />
      </button> : null}
      {title ? <div className="palette-footer-title"><span className="footer-title-label">{title}</span></div> : null}
      {status || context ? <div className={status ? 'palette-footer-status' : 'palette-footer-context'}>
        {status || context}
      </div> : null}
    </div>
    <div className="footer-actions">
      {primary ? <button className={`primary-action ${primary.danger ? 'danger' : ''}`} disabled={primary.disabled} onKeyDown={buttonKeyboard} onClick={primary.onAction} title={`${describeShortcut(formatShortcut(primary.keys))} — ${primary.label}`} aria-label={primary.label}>
        <span className="primary-label">{primary.label}</span><span className="key-chord"><kbd>{formatShortcut(primary.keys)}</kbd></span>
      </button> : null}
      {primary && (secondary || actions) ? <span className="footer-separator" /> : null}
      {secondary ? <button className={`secondary-action ${secondary.icon ? 'has-compact-icon' : ''}`} disabled={secondary.disabled} onKeyDown={buttonKeyboard} onClick={secondary.onAction} title={`${describeShortcut(formatShortcut(secondary.keys))} — ${secondary.label}`} aria-label={secondary.label}>
        {secondary.icon ? <span className="secondary-compact-icon" aria-hidden="true">{secondary.icon}</span> : null}<span className="primary-label">{secondary.label}</span><span className="key-chord"><kbd>{formatShortcut(secondary.keys)}</kbd></span>
      </button> : null}
      {actions ? <button className={`actions-button ${actions.open ? 'pressed' : ''}`} aria-label={t('openActions')} aria-expanded={actions.open}
        disabled={actions.disabled} onKeyDown={buttonKeyboard} title={`${isMac ? 'Command' : 'Control'} + K — ${t('openActions')}`} onClick={actions.onToggle}>{t('actions')}<span className="key-chord"><kbd>{formatShortcut([isMac ? '⌘' : 'Ctrl', 'K'])}</kbd></span></button> : null}
    </div>
  </footer>;
}
