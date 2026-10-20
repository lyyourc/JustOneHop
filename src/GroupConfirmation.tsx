import { useLayoutEffect, useRef } from 'react';
import { BackLayer } from './Navigation';
import { t } from './i18n';
import type { Entry } from './types';

export function GroupConfirmation({ target, onCancel, onConfirm }: {
  target: Entry; onCancel: () => void; onConfirm: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { cancel.current?.focus(); }, []);
  return <BackLayer onBack={onCancel}>
    <button className="action-scrim" aria-label={t('backToResults')} tabIndex={-1} onClick={onCancel} />
    <div className="action-menu bookmark-confirm" role="alertdialog" aria-modal="true"
      aria-labelledby="group-delete-title" aria-describedby="group-delete-detail" onKeyDown={event => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.keyCode === 229) {
          if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
          return;
        }
        if ((event.key === 'Enter' || event.key === ' ') && (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)) {
          event.preventDefault(); return;
        }
        if (event.key === 'Tab') {
          event.preventDefault();
          if (event.target === cancel.current) confirm.current?.focus(); else cancel.current?.focus();
        }
      }}>
      <h2 id="group-delete-title">{t('groupClose')}</h2>
      <p id="group-delete-detail">{t('groupClosePrompt', [target.subtitle, String(target.groupTabIds?.length || 0)])}</p>
      <div className="confirm-controls">
        <button ref={cancel} className="surface-button" onClick={onCancel}>{t('cancel')}</button>
        <button ref={confirm} className="surface-button delete-button" onClick={onConfirm}>{t('groupClose')}</button>
      </div>
    </div>
  </BackLayer>;
}
