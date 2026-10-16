import type { ReactNode } from 'react';
import { ChevronLeft, Settings2 } from 'lucide-react';
import { t } from './i18n';

/** Left: one navigation control, the current location, then quiet context or status.
 *  Right: the primary action and action menu. Every layer uses the same slots. */
export function PaletteFooter({ navigation, title, context, status, primary, secondary, actions, isMac = false }: {
  navigation?: { kind: 'settings' | 'back'; label: string; tooltip: string; disabled?: boolean; onAction: () => void };
  title?: string;
  context?: ReactNode;
  status?: ReactNode;
  primary?: { label: string; keys: string[]; disabled?: boolean; danger?: boolean; onAction: () => void };
  secondary?: { label: string; keys: string[]; disabled?: boolean; onAction: () => void };
  actions?: { open: boolean; disabled?: boolean; onToggle: () => void };
  isMac?: boolean;
}) {
  const NavigationIcon = navigation?.kind === 'back' ? ChevronLeft : Settings2;
  return <footer className="footer palette-footer">
    <div className="palette-footer-location">
      {navigation ? <button className={`footer-navigation ${navigation.kind === 'back' ? 'footer-back' : 'settings-button'}`}
        onClick={navigation.onAction} disabled={navigation.disabled} aria-label={navigation.label} title={navigation.tooltip}>
        <NavigationIcon size={15} aria-hidden="true" />
      </button> : null}
      {title ? <div className="palette-footer-title"><span className="footer-title-label">{title}</span></div> : null}
      {status || context ? <div className={status ? 'palette-footer-status' : 'palette-footer-context'}>
        {title ? <span className="footer-divider" aria-hidden="true">·</span> : null}{status || context}
      </div> : null}
    </div>
    <div className="footer-actions">
      {primary ? <button className={`primary-action ${primary.danger ? 'danger' : ''}`} disabled={primary.disabled} onClick={primary.onAction} title={primary.label} aria-label={primary.label}>
        <span className="primary-label">{primary.label}</span><span className="key-chord">{primary.keys.map(key => <kbd key={key}>{key}</kbd>)}</span>
      </button> : null}
      {primary && (secondary || actions) ? <span className="footer-separator" /> : null}
      {secondary ? <button className="secondary-action" disabled={secondary.disabled} onClick={secondary.onAction} title={secondary.label} aria-label={secondary.label}>
        <span className="primary-label">{secondary.label}</span><span className="key-chord">{secondary.keys.map(key => <kbd key={key}>{key}</kbd>)}</span>
      </button> : null}
      {actions ? <button className={`actions-button ${actions.open ? 'pressed' : ''}`} aria-label={t('openActions')} aria-expanded={actions.open}
        disabled={actions.disabled} onClick={actions.onToggle}>{t('actions')}<span className="key-chord"><kbd>{isMac ? '⌘' : 'Ctrl'}</kbd><kbd>K</kbd></span></button> : null}
    </div>
  </footer>;
}
