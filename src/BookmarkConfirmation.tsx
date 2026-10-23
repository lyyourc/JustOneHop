import { useLayoutEffect, useRef } from 'react';
import { BackLayer } from './Navigation';
import { t } from './i18n';
import type { BookmarkItem, Entry } from './types';

export interface BookmarkRemoval { entry: Entry; bookmarks: BookmarkItem[] }

export function BookmarkConfirmation({ target, onCancel, onConfirm }: {
  target: BookmarkRemoval; onCancel: () => void; onConfirm: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { cancel.current?.focus(); }, []);
  return <BackLayer onBack={onCancel} modal>
    <button className="action-scrim" aria-label={t('backToResults')} tabIndex={-1} onClick={onCancel} />
    <div className="action-menu bookmark-confirm" role="alertdialog" aria-modal="true"
      aria-labelledby="bookmark-delete-title" aria-describedby="bookmark-delete-detail" onKeyDown={event => {
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
      <h2 id="bookmark-delete-title">{t('confirmUnbookmark')}</h2>
      <p id="bookmark-delete-detail">{t('unbookmarkPrompt', String(target.bookmarks.length))}</p>
      <div className="bookmark-confirm-details">
        <p>{target.entry.expectedUrl}</p>
        <ul>{target.bookmarks.map(bookmark => <li key={bookmark.id}>{bookmark.folder || bookmark.title}</li>)}</ul>
      </div>
      <div className="confirm-controls">
        <button ref={cancel} className="surface-button" onClick={onCancel}>{t('cancel')}</button>
        <button ref={confirm} className="surface-button delete-button" onClick={onConfirm}>{t('unbookmarkCount', String(target.bookmarks.length))}</button>
      </div>
    </div>
  </BackLayer>;
}
