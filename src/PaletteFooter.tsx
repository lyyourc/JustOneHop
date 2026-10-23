import { useSyncExternalStore, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { ChevronLeft } from 'lucide-react';
import { t } from './i18n';
import { OperationFeedbackStatus, useOperationFeedbackActive } from './OperationFeedback';
import { FooterHint } from './FooterHint';
import { getPreferences, subscribePreferences } from './preferences';
import { describeShortcut, formatShortcut } from './Shortcut';

function buttonKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  // Keep native activation on the focused button, away from list shortcuts.
  event.stopPropagation();
  if (event.nativeEvent.isComposing || event.keyCode === 229 || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) event.preventDefault();
}

/** Left: one navigation control, the current location, then quiet context or status.
 *  Right: the primary action and action menu. Every layer uses the same slots. */
export function PaletteFooter({ navigation, title, hints, context, status, primary, secondary, actions, isMac = false }: {
  navigation?: { kind: 'settings' | 'back'; label: string; tooltip: string; disabled?: boolean; buttonRef?: Ref<HTMLButtonElement>; onAction: () => void };
  title?: string;
  hints?: ReactNode | boolean;
  context?: ReactNode;
  status?: ReactNode;
  primary?: { label: string; shortLabel?: string; keys: string[]; disabled?: boolean; danger?: boolean; buttonRef?: Ref<HTMLButtonElement>; onAction: () => void };
  secondary?: { label: string; shortLabel?: string; keys: string[]; icon?: ReactNode; trailingIcon?: ReactNode; disabled?: boolean; onAction: () => void };
  actions?: { open: boolean; disabled?: boolean; onToggle: () => void };
  isMac?: boolean;
}) {
  const preferences = useSyncExternalStore(subscribePreferences, getPreferences);
  const footer = useRef<HTMLElement>(null);
  const [textSlot, setTextSlot] = useState<HTMLDivElement | null>(null);
  const feedbackActive = useOperationFeedbackActive();
  const [modalOpen, setModalOpen] = useState(false);
  useLayoutEffect(() => {
    const scope = footer.current!.closest('.justonehop-app')!;
    const update = () => setModalOpen(!!scope.querySelector('[aria-modal="true"]'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(scope, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal'] });
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const root = footer.current!;
    const location = root.querySelector<HTMLElement>('.palette-footer-text')!;
    const context = root.querySelector<HTMLElement>('.palette-footer-context');
    const content = context?.firstElementChild as HTMLElement | null;
    if (!context || !content) return;
    const fitContext = () => {
      context.toggleAttribute('data-overflow', content.getBoundingClientRect().width > location.clientWidth);
    };
    fitContext();
    const observer = new ResizeObserver(fitContext);
    for (const element of [location, content]) observer.observe(element);
    return () => observer.disconnect();
  });
  return <footer ref={footer} className="footer palette-footer" data-pet-layout={!!hints}>
    <div className="palette-footer-location">
      {navigation?.kind === 'back' ? <button ref={navigation.buttonRef} className="footer-navigation footer-back"
        onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
        onKeyDown={buttonKeyboard} onClick={navigation.onAction} disabled={navigation.disabled} aria-label={navigation.label} title={navigation.tooltip}>
        <ChevronLeft size={15} aria-hidden="true" />
      </button> : null}
      {title ? <div className="palette-footer-title">
        {navigation?.kind === 'settings' ? <button ref={navigation.buttonRef} className="footer-title-label settings-button"
          onKeyDown={buttonKeyboard} onClick={navigation.onAction} disabled={navigation.disabled} aria-label={navigation.label} title={navigation.tooltip}>{title}</button>
          : <span className="footer-title-label" title={title}>{title}</span>}
      </div> : null}
      {hints ? <div className="palette-footer-pet" inert={modalOpen}>
        {!preferences.hidePet ? <FooterHint textSlot={textSlot} suppressed={feedbackActive || !!status || modalOpen}>{typeof hints === 'boolean' ? undefined : hints}</FooterHint> : null}
      </div> : null}
      <div ref={setTextSlot} className="palette-footer-text">
        <OperationFeedbackStatus />
        {status || context ? <div className={status ? 'palette-footer-status' : 'palette-footer-context'}>
          {status || <span className="palette-footer-context-content">{context}</span>}
        </div> : null}
      </div>
    </div>
    <div className="footer-actions">
      {primary ? <button ref={primary.buttonRef} className={`primary-action ${primary.danger ? 'danger' : ''}`} disabled={primary.disabled} onKeyDown={buttonKeyboard} onClick={primary.onAction} title={`${describeShortcut(formatShortcut(primary.keys))} — ${primary.label}`} aria-label={primary.label}>
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
