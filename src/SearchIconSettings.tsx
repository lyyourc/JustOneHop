import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { BackLayer, useNavigateBack } from './Navigation';
import { SettingsPage, SettingsPageFooter } from './SettingsPage';
import { TaskHeader } from './TaskHeader';
import { SearchIconPreview } from './SearchIcon';
import { Logo } from './Logo';
import { useOperationFeedback } from './OperationFeedback';
import { isSingleEmoji, prepareSearchIcon } from './searchIconData';
import { savePreferences } from './preferences';
import { t } from './i18n';
import { openHelpUrl } from './api';
import { OverlayRetention } from './OverlayRetention';

export function SearchIconSettings({ value, onBack }: { value?: string; onBack: () => void }) {
  const page = useContext(SettingsPage);
  const retainOverlay = useContext(OverlayRetention);
  useLayoutEffect(() => retainOverlay(), [retainOverlay]);
  const back = useNavigateBack();
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const emoji = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const chooseImage = useRef<HTMLButtonElement>(null);
  const wearBadge = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const hint = useId();
  const [emojiHintBefore, emojiHintAfter] = t('searchIconEmojiHint').split('Emoji');
  const feedback = useOperationFeedback();
  const isImage = draft?.startsWith('data:') ?? false;
  const valid = !draft || isImage || isSingleEmoji(draft);
  useLayoutEffect(() => { chooseImage.current?.focus(); }, []);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function save() {
    if (busy || !valid || draft === value) return;
    setBusy(true);
    const result = await feedback.run(() => savePreferences({ searchIcon: draft }),
      t(draft ? 'searchIconSaved' : 'searchIconRestored'), t('errorSaveSettings'));
    if (!alive.current) return;
    setBusy(false);
    if (result.ok) onBack();
  }
  async function upload(selected: File) {
    setBusy(true);
    const result = await feedback.run(() => prepareSearchIcon(selected), t('searchIconPreviewReady'), t('errorSearchIconImage'));
    if (!alive.current) return;
    // Commit the draft and enabled buttons before focusing the next action.
    flushSync(() => {
      setBusy(false);
      if (result.ok) setDraft(result.value);
    });
    const next = result.ok && wearBadge.current && !wearBadge.current.disabled ? wearBadge.current : chooseImage.current;
    next?.focus();
  }
  return <BackLayer onBack={onBack} active={page?.active ?? true}><section className="palette settings-page search-icon-settings" aria-label={t('searchIcon')} onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') {
      if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement;
      if (target.closest('button, a')) return;
      event.preventDefault();
      event.stopPropagation();
      void save();
    }
  }}>
    {!page ? <TaskHeader /> : null}
    <div className="settings-body">
      <h1 className="task-title">{t('searchIcon')}</h1>
      <p className="search-icon-description">{t('searchIconHint')}</p>
      <div className="search-icon-preview" role="img" aria-label={t('searchIconPreview')}>
        <SearchIconPreview value={valid ? draft : value} />
        <span>{t('searchIconPreview')}</span>
      </div>
      <div className="settings-group">
        <div className="setting-row"><div className="setting-copy"><label>{t('searchIconDefault')}</label>
          <p>{t('searchIconDefaultHint')}</p></div>
          <button type="button" className="surface-button" disabled={busy || draft === undefined} title={t('searchIconDefault')}
            onClick={() => { setDraft(undefined); emoji.current?.focus(); }}>
            <Logo size={16} />
            <span>{t('searchIconRestore')}</span>
          </button>
        </div>
        <div className="setting-row"><div className="setting-copy"><label htmlFor={`${hint}-emoji`}>Emoji</label>
          <p id={hint}>{emojiHintBefore}<a className="search-icon-emoji-link" href="https://emoji.muan.co/" target="_blank" rel="noopener noreferrer"
            onClick={event => {
              event.preventDefault(); event.stopPropagation();
              void feedback.run(() => openHelpUrl('https://emoji.muan.co/'), t('searchIconEmojiOpened'));
            }}>Emoji</a>{emojiHintAfter}</p></div>
          <input ref={emoji} id={`${hint}-emoji`} className="search-icon-emoji" aria-describedby={hint} aria-invalid={!valid}
            value={isImage ? '' : draft || ''} autoComplete="off" spellCheck={false} maxLength={64}
            onChange={event => setDraft(event.target.value || undefined)} readOnly={busy} />
        </div>
        <div className="setting-row"><div className="setting-copy"><label>{t('searchIconImage')}</label><p>{t('searchIconImageHint')}</p></div>
          <button ref={chooseImage} type="button" className="surface-button" disabled={busy} onClick={() => file.current?.click()}>{t('searchIconUpload')}</button>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => {
            const selected = event.target.files?.[0]; event.target.value = '';
            if (selected) void upload(selected);
          }} />
        </div>
      </div>
      {!valid ? <p className="search-icon-error" role="alert">{t('errorSearchIconEmoji')}</p> : null}
    </div>
    <SettingsPageFooter title={t('searchIcon')}
      navigation={page ? { kind: 'back', label: t('back'), tooltip: `${t('back')} · Esc`, onAction: back } : undefined}
      primary={{ buttonRef: wearBadge, label: t('searchIconSave'), keys: ['↵'], disabled: busy || !valid || draft === value, onAction: () => void save() }} />
  </section></BackLayer>;
}
