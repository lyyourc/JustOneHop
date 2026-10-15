import type { ReactNode } from 'react';
import { t } from './i18n';

export function PaletteFooter({ leading, status, primary, actions, isMac }: {
  leading?: ReactNode;
  status?: ReactNode;
  primary?: { label: string; keys: string[]; disabled?: boolean; onAction: () => void };
  actions?: { open: boolean; disabled?: boolean; onToggle: () => void };
  isMac: boolean;
}) {
  return <footer className="footer palette-footer">
    {leading}
    {status ? <div className="palette-footer-status">{status}</div> : null}
    <div className="footer-actions">
      {primary ? <button className="primary-action" disabled={primary.disabled} onClick={primary.onAction} title={primary.label} aria-label={primary.label}>
        <span className="primary-label">{primary.label}</span><span className="key-chord">{primary.keys.map(key => <kbd key={key}>{key}</kbd>)}</span>
      </button> : null}
      {primary && actions ? <span className="footer-separator" /> : null}
      {actions ? <button className={`actions-button ${actions.open ? 'pressed' : ''}`} aria-label={t('openActions')} aria-expanded={actions.open}
        disabled={actions.disabled} onClick={actions.onToggle}>{t('actions')}<span className="key-chord"><kbd>{isMac ? '⌘' : 'Ctrl'}</kbd><kbd>K</kbd></span></button> : null}
    </div>
  </footer>;
}
