import { BackLayer } from './Navigation';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, Copy, Plus, Save, Search, Trash2 } from 'lucide-react';
import { t } from './i18n';
import { bindingScript, deleteScript, getScripts, saveScript, scriptsReady, subscribeScripts, type SavedScript } from './scripts';
import { copyText } from './clipboard';
import { openShortcuts } from './api';
import { PaletteFooter } from './PaletteFooter';
import { ActionMenu } from './ActionMenu';
import { HighlightedText } from './HighlightedText';

export function ScriptLibrary({ initialBinding = false, initialScript, onComplete, onBack, onClose, isMac }: {
  initialBinding?: boolean; initialScript?: SavedScript; onComplete?: (notice: string) => void; onBack: () => void; onClose: () => void; isMac: boolean;
}) {
  const scripts = useSyncExternalStore(subscribeScripts, getScripts);
  const [draft, setDraft] = useState<SavedScript | null>(initialScript ?? (initialBinding ? bindingScript() : null));
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState(false);
  const [actionQuery, setActionQuery] = useState('');
  const [actionSelection, setActionSelection] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const searchCaret = useRef<[number, number]>([0, 0]);
  const title = useRef<HTMLInputElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const lastField = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const caret = useRef<[number, number]>([0, 0]);
  const wasModal = useRef(false);
  const builtin = draft?.id === 'builtin-ctrl-tab';
  const mod = isMac ? '⌘' : 'Ctrl';
  const results = [bindingScript(), ...scripts].filter(script => script.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selected = Math.min(index, Math.max(0, results.length - 1));
  const availableActions: { id: string; title: string; shortcut?: string; keywords: string; icon: React.ReactNode; danger?: boolean }[] = [
    { id: 'save', title: t('saveScript'), shortcut: 'Mod+Enter', keywords: 'save 保存', icon: <Save size={16} /> },
    { id: 'copy', title: t('copyScript'), keywords: 'copy code 复制代码', icon: <Copy size={16} /> },
    ...(draft && scripts.some(script => script.id === draft.id) ? [{ id: 'delete', title: t('deleteScript'), keywords: 'delete 删除', icon: <Trash2 size={16} />, danger: true }] : []),
  ];
  const actions = availableActions.filter(action => `${action.title} ${action.keywords}`.toLocaleLowerCase().includes(actionQuery.trim().toLocaleLowerCase()));
  const activeAction = actions.find(action => action.id === actionSelection) || actions[0];
  useEffect(() => { void scriptsReady.then(() => setReady(true)).catch(() => setError(t('errorGeneric'))); }, []);
  useLayoutEffect(() => {
    (draft ? builtin ? back : title : search).current?.focus();
    if (!draft) search.current?.setSelectionRange(...searchCaret.current);
  }, [!!draft]);
  useLayoutEffect(() => { list.current?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' }); }, [selected, !!draft, query]);
  useLayoutEffect(() => {
    if (deleting) cancelDelete.current?.focus();
    else if (!menu && wasModal.current) {
      const field = lastField.current;
      if (field?.isConnected) { field.focus({ preventScroll: true }); field.setSelectionRange(...caret.current); }
      else back.current?.focus();
    }
    wasModal.current = menu || deleting;
  }, [menu, deleting]);
  function edit(script: SavedScript) {
    searchCaret.current = [search.current?.selectionStart ?? query.length, search.current?.selectionEnd ?? query.length];
    setDraft(script); setNotice(''); setError('');
  }
  function toggleMenu() {
    if (busy || !draft || builtin || deleting) return;
    if (!menu) {
      caret.current = [lastField.current?.selectionStart ?? 0, lastField.current?.selectionEnd ?? 0];
      setActionQuery(''); setActionSelection('');
    }
    setMenu(!menu);
  }
  function leave() {
    if (busy) return;
    if (deleting) { setDeleting(false); return; }
    if (menu) { setMenu(false); return; }
    if (initialScript) { onBack(); return; }
    if (draft) { setDraft(null); setNotice(''); setError(''); }
    else onBack();
  }
  async function copy(anchor: HTMLElement) {
    if (!draft) return;
    try { await copyText(draft.code, anchor); setNotice(t('scriptCopied')); setError(''); }
    catch { setError(t('scriptCopyError')); }
  }
  async function save() {
    if (!draft || builtin || busy || !ready) return;
    setMenu(false); setBusy(true); setError('');
    try { await saveScript(draft); if (onComplete) onComplete(t('scriptSaved')); else { setDraft(null); setNotice(t('scriptSaved')); } }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('errorGeneric')); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!draft || builtin || busy) return;
    setBusy(true);
    try { await deleteScript(draft.id); if (onComplete) onComplete(t('scriptDeleted')); else { setDraft(null); setNotice(t('scriptDeleted')); setDeleting(false); } }
    catch { setError(t('errorGeneric')); }
    finally { setBusy(false); }
  }
  function act(id: string) {
    if (busy) return;
    setMenu(false);
    if (id === 'save') void save();
    if (id === 'copy' && back.current) void copy(back.current);
    if (id === 'delete') setDeleting(true);
  }
  return <BackLayer onBack={onBack}><BackLayer active={!!draft} onBack={leave}><section tabIndex={-1} className="palette settings-view script-library" aria-label={t('scriptLibrary')} onFocusCapture={event => {
    const field = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (['INPUT', 'TEXTAREA'].includes(field.tagName) && field.closest('.script-field, .script-search')) lastField.current = field;
  }} onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const modifier = isMac ? event.metaKey : event.ctrlKey;
    if (draft && !builtin && modifier && !event.shiftKey && !event.altKey) {
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); event.stopPropagation(); toggleMenu(); return; }
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (!event.repeat && !deleting) void save(); return; }
    }
    if (!draft && event.target === search.current && !event.shiftKey && !event.altKey && !event.metaKey && ((!event.ctrlKey && ['ArrowDown', 'ArrowUp'].includes(event.key)) || (event.ctrlKey && ['n', 'p'].includes(event.key.toLowerCase())))) {
      event.preventDefault(); event.stopPropagation();
      setIndex((selected + (event.key === 'ArrowUp' || event.key.toLowerCase() === 'p' ? -1 : 1) + results.length) % (results.length || 1));
    }
    if (!draft && event.key === 'Enter' && event.target === search.current && results[selected]) {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) edit(results[selected]);
    }
    if (deleting && event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation();
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.script-confirm button:not(:disabled)'));
      buttons[(buttons.indexOf(event.target as HTMLButtonElement) + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }
  }}>
    <div className={`script-surface ${menu || deleting ? 'subdued' : ''}`} inert={menu || deleting ? true : undefined}>
      <header className="settings-header"><button ref={back} className="settings-back" onClick={leave} aria-label={t('back')} disabled={busy}><ArrowLeft size={18} /></button>
        <h1>{draft ? builtin ? t('bindCtrlTab') : t(scripts.some(script => script.id === draft.id) ? 'editScript' : 'newScript') : t('scriptLibrary')}</h1><kbd>esc</kbd></header>
      <div className="settings-body">
        <p className="script-description">{t('scriptLibraryHint')}</p>
        {draft ? <>
          {builtin ? <div className="binding-guide">
            <p>{t('bindingEffect')}</p>
            <ol><li>{t('bindingStepCopy')}</li><li>{t('bindingStepOpen')}</li><li>{t('bindingStepConsole', isMac ? '⌘⌥J' : 'Ctrl+Shift+J')}</li></ol>
            <div className="script-controls"><button className="ranking-reset" onClick={event => void copy(event.currentTarget)}><Copy size={14} />{t('copyScript')}</button>
            <button className="ranking-reset" onClick={() => { void openShortcuts().then(onClose).catch(() => setError(t('errorGeneric'))); }}>{t('openShortcutPage')}</button></div>
          </div> : <label className="script-field">{t('scriptName')}<input ref={title} value={draft.title} maxLength={120} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>}
          <label className="script-field">{t('scriptCode')}<textarea aria-label={t('scriptCode')} value={draft.code} readOnly={builtin} spellCheck={false}
            onChange={event => setDraft({ ...draft, code: event.target.value })} /></label>
          {!builtin ? <p className="script-description">{t('scriptExecutionHint')}</p> : null}
        </> : <>
          <div className="script-search"><Search size={16} /><input data-back-on-empty ref={search} aria-label={t('searchScripts')} placeholder={t('searchScripts')} value={query} onChange={event => { setQuery(event.target.value); setIndex(0); }} />
            <button className="ranking-reset" disabled={!ready} onClick={() => edit({ id: crypto.randomUUID(), title: '', code: '' })}><Plus size={14} />{t('newScript')}</button></div>
          <div className="script-list" ref={list}>{results.map((script, at) => <button key={script.id} className={`script-item ${at === selected ? 'selected' : ''}`} onClick={() => { setIndex(at); edit(script); }}>
            <span><HighlightedText text={script.title} query={query} allowTypos={false} /></span><span>{t(script.id === 'builtin-ctrl-tab' ? 'builtInScript' : 'editScript')}</span></button>)}</div>
          {!results.length ? <p className="empty">{t('noResults')}</p> : null}
        </>}
      </div>
    </div>
    {notice || error ? <div className="script-feedback">
      {notice ? <p className="setting-note" role="status">{notice}</p> : null}
      {error ? <p className="recent-error" role="alert">{error}</p> : null}
    </div> : null}
    {menu ? <ActionMenu id="script-editor-actions" isMac={isMac} title={<span>{draft?.title || t('newScript')}</span>}
      actions={actions} query={actionQuery} onQueryChange={value => { setActionQuery(value); setActionSelection(''); }}
      selectedId={activeAction?.id} onSelectionChange={setActionSelection} onAction={act} onClose={() => setMenu(false)} /> : null}
    {deleting ? <BackLayer onBack={() => { if (!busy) setDeleting(false); }}>
      <button className="action-scrim" tabIndex={-1} aria-label={t('backToResults')} onClick={() => { if (!busy) setDeleting(false); }} />
      <div className="action-menu script-confirm" role="alertdialog" aria-modal="true" aria-labelledby="editor-delete-title">
        <h2 id="editor-delete-title">{t('confirmDeleteScript')}</h2><p>{t('scriptDeletePrompt', draft?.title || '')}</p>
        <div className="script-controls"><button ref={cancelDelete} className="ranking-reset" disabled={busy} onClick={() => setDeleting(false)}>{t('cancelScriptDelete')}</button>
          <button className="ranking-reset delete-script-button" disabled={busy} onClick={() => void remove()}>{t('deleteScript')}</button></div>
      </div>
    </BackLayer> : null}
    <PaletteFooter isMac={isMac} status={<span className="footer-note">{t('scriptLocalOnly')}</span>}
      primary={draft && !builtin ? { label: menu ? activeAction?.title || t('saveScript') : t('saveScript'), keys: menu ? ['↵'] : [mod, '↵'], disabled: busy || !ready || deleting || (menu && !activeAction), danger: !!(menu && activeAction?.danger), onAction: () => { if (menu) { if (activeAction) act(activeAction.id); } else void save(); } }
        : { label: t('back'), keys: ['esc'], onAction: leave }}
      actions={draft && !builtin ? { open: menu, disabled: busy || !ready || deleting, onToggle: toggleMenu } : undefined} />
  </section></BackLayer></BackLayer>;
}
