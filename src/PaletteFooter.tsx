import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { ChevronLeft, Settings2 } from 'lucide-react';
import { t } from './i18n';
import { OperationFeedbackStatus } from './OperationFeedback';
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
  primary?: { label: string; shortLabel?: string; keys: string[]; disabled?: boolean; danger?: boolean; onAction: () => void };
  secondary?: { label: string; shortLabel?: string; keys: string[]; icon?: ReactNode; trailingIcon?: ReactNode; disabled?: boolean; onAction: () => void };
  actions?: { open: boolean; disabled?: boolean; onToggle: () => void };
  isMac?: boolean;
}) {
  const footer = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const root = footer.current!;
    const location = root.querySelector<HTMLElement>('.palette-footer-location')!;
    const context = root.querySelector<HTMLElement>('.palette-footer-context');
    const content = context?.firstElementChild as HTMLElement | null;
    if (!context || !content) return;
    const title = root.querySelector<HTMLElement>('.footer-title-label');
    const navigation = root.querySelector<HTMLElement>('.footer-navigation');
    const fitContext = () => {
      const style = root.ownerDocument.defaultView!.getComputedStyle(location);
      const gap = parseFloat(style.columnGap) || 0;
      const required = (navigation?.offsetWidth || 0) + (title?.scrollWidth || 0) + content.getBoundingClientRect().width
        + gap * (Number(!!navigation) + Number(!!title)) + (title ? 16 : 0);
      context.toggleAttribute('data-overflow', required > location.clientWidth);
    };
    fitContext();
    const observer = new ResizeObserver(fitContext);
    for (const element of [location, content, title]) if (element) observer.observe(element);
    return () => observer.disconnect();
  });
  const NavigationIcon = navigation?.kind === 'back' ? ChevronLeft : Settings2;
  return <footer ref={footer} className="footer palette-footer">
    <div className="palette-footer-location">
      {navigation ? <button ref={navigation.buttonRef} className={`footer-navigation ${navigation.kind === 'back' ? 'footer-back' : 'settings-button'}`}
        onMouseDown={event => { if (navigation.kind === 'back') { event.preventDefault(); event.stopPropagation(); } }}
        onKeyDown={buttonKeyboard} onClick={navigation.onAction} disabled={navigation.disabled} aria-label={navigation.label} title={navigation.tooltip}>
        <NavigationIcon size={15} aria-hidden="true" />
      </button> : null}
      {title ? <div className="palette-footer-title"><span className="footer-title-label">{title}</span></div> : null}
      <OperationFeedbackStatus />
      {status || context ? <div className={status ? 'palette-footer-status' : 'palette-footer-context'}>
        {status || <span className="palette-footer-context-content">{context}</span>}
      </div> : null}
    </div>
    <div className="footer-actions">
      {primary ? <button className={`primary-action ${primary.danger ? 'danger' : ''}`} disabled={primary.disabled} onKeyDown={buttonKeyboard} onClick={primary.onAction} title={`${describeShortcut(formatShortcut(primary.keys))} — ${primary.label}`} aria-label={primary.label}>
        <span className="primary-label">{primary.shortLabel || primary.label}</span><span className="key-chord"><kbd>{formatShortcut(primary.keys)}</kbd></span>
      </button> : null}
      {secondary ? <button className={`secondary-action ${secondary.icon ? 'has-compact-icon' : ''}`} disabled={secondary.disabled} onKeyDown={buttonKeyboard} onClick={secondary.onAction} title={secondary.keys.length ? `${describeShortcut(formatShortcut(secondary.keys))} — ${secondary.label}` : secondary.label} aria-label={secondary.label}>
        {secondary.icon ? <span className="secondary-compact-icon" aria-hidden="true">{secondary.icon}</span> : null}<span className="primary-label">{secondary.shortLabel || secondary.label}</span>{secondary.keys.length ? <span className="key-chord"><kbd>{formatShortcut(secondary.keys)}</kbd></span> : null}{secondary.trailingIcon ? <span className="secondary-trailing-icon" aria-hidden="true">{secondary.trailingIcon}</span> : null}
      </button> : null}
      {actions && (primary || secondary) ? <span className="footer-separator" aria-hidden="true" /> : null}
      {actions ? <button className={`actions-button ${actions.open ? 'pressed' : ''}`} aria-label={t('openActions')} aria-expanded={actions.open}
        disabled={actions.disabled} onKeyDown={buttonKeyboard} title={`${isMac ? 'Command' : 'Control'} + K — ${t('openActions')}`} onClick={actions.onToggle}>{t('actions')}<span className="key-chord"><kbd>{formatShortcut([isMac ? '⌘' : 'Ctrl', 'K'])}</kbd></span></button> : null}
    </div>
  </footer>;
}
