import { BackLayer } from './Navigation';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Copy, ExternalLink, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { t } from './i18n';
import { bindingScript, deleteScript, getScripts, saveScript, scriptsReady, subscribeScripts, type SavedScript } from './scripts';
import { copyText } from './clipboard';
import { openShortcuts } from './api';
import { PaletteFooter } from './PaletteFooter';
import { ActionMenu } from './ActionMenu';
import { ScriptList } from './ScriptList';
import { ScriptPreview } from './ScriptPreview';
import { useResultSelection } from './useResultSelection';

export function ScriptLibrary({ initialBinding = false, initialScript, onComplete, onBack, onClose, isMac }: {
  initialBinding?: boolean; initialScript?: SavedScript; onComplete?: (notice: string) => void; onBack: () => void; onClose: () => void; isMac: boolean;
}) {
  const scripts = useSyncExternalStore(subscribeScripts, getScripts);
  const [draft, setDraft] = useState<SavedScript | null>(initialScript ?? (initialBinding ? bindingScript() : null));
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<SavedScript | null>(null);
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState(false);
  const [actionQuery, setActionQuery] = useState('');
  const [actionSelection, setActionSelection] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const searchCaret = useRef<[number, number]>([0, 0]);
  const title = useRef<HTMLInputElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const lastField = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const caret = useRef<[number, number]>([0, 0]);
  const wasModal = useRef(false);
  const revision = useRef(0);
  const builtin = draft?.id === 'builtin-ctrl-tab';
  const mod = isMac ? '⌘' : 'Ctrl';
  const results = [bindingScript(), ...scripts].filter(script => script.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const { selected, setSelection } = useResultSelection(results, query);
  const target = draft || selected;
  const location = draft ? builtin ? t('bindCtrlTab') : t(scripts.some(script => script.id === draft.id) ? 'editScript' : 'newScript') : t('scriptLibrary');
  const availableActions = [
    ...(draft && !builtin ? [{ id: 'save', title: t('saveScript'), shortcut: 'Mod+Enter', keywords: 'save 保存', icon: <Save size={16} /> }] : []),
    ...(target ? [{ id: 'copy', title: t('copyScript'), keywords: 'copy code 复制代码', icon: <Copy size={16} /> }] : []),
    ...(!draft && selected ? [{ id: 'edit', title: t(selected.id === 'builtin-ctrl-tab' ? 'viewScriptSetup' : 'editScript'), keywords: 'edit setup instructions 编辑 配置 说明', icon: <Pencil size={16} /> }] : []),
    ...(target?.id === 'builtin-ctrl-tab' ? [{ id: 'shortcuts', title: t('openShortcutPage'), keywords: 'open chrome shortcuts 快捷键 打开', icon: <ExternalLink size={16} /> }] : []),
    ...(!draft ? [{ id: 'new', title: t('newScript'), shortcut: 'Mod+Shift+N', keywords: 'new create 新建 创建', icon: <Plus size={16} /> }] : []),
    ...(target && scripts.some(script => script.id === target.id) ? [{ id: 'delete', title: t('deleteScript'), keywords: 'delete 删除', icon: <Trash2 size={16} />, danger: true }] : []),
  ];
  const actions = availableActions.filter(action => `${action.title} ${action.keywords}`.toLocaleLowerCase().includes(actionQuery.trim().toLocaleLowerCase()));
  const activeAction = actions.find(action => action.id === actionSelection) || actions[0];
  useEffect(() => {
    void scriptsReady.then(() => setReady(true)).catch(() => setError(t('errorGeneric')));
    return () => { revision.current++; };
  }, []);
  useLayoutEffect(() => {
    if (menu || deleting) return;
    if (draft) { if (builtin) focusBinding(); else title.current?.focus(); }
    else { search.current?.focus(); search.current?.setSelectionRange(...searchCaret.current); }
  }, [!!draft, ready]);
  useLayoutEffect(() => {
    if (deleting) cancelDelete.current?.focus();
    else if (!menu && wasModal.current) {
      const field = lastField.current;
      if (field?.isConnected) { field.focus({ preventScroll: true }); field.setSelectionRange(...caret.current); }
      else if (draft) { if (builtin) focusBinding(); else title.current?.focus(); }
      else { search.current?.focus(); search.current?.setSelectionRange(...searchCaret.current); }
    }
    wasModal.current = menu || !!deleting;
  }, [menu, deleting]);
  function focusBinding() { back.current?.closest('.palette-footer')?.querySelector<HTMLButtonElement>('.primary-action')?.focus(); }
  function rememberSearch() {
    searchCaret.current = [search.current?.selectionStart ?? query.length, search.current?.selectionEnd ?? query.length];
  }
  function edit(script: SavedScript) {
    if (busy || !ready || deleting) return;
    if (!draft) rememberSearch();
    revision.current++; setMenu(false); setDraft(script); setNotice(''); setError('');
  }
  function create() { edit({ id: crypto.randomUUID(), title: '', code: '' }); }
  function openMenu() {
    if (busy || !ready || deleting) return;
    if (!draft) rememberSearch();
    caret.current = [lastField.current?.selectionStart ?? 0, lastField.current?.selectionEnd ?? 0];
    setActionQuery(''); setActionSelection(''); setMenu(true);
  }
  function toggleMenu() { if (menu) setMenu(false); else openMenu(); }
  function leave() {
    if (deleting) { if (!busy) setDeleting(null); return; }
    if (menu) { setMenu(false); return; }
    revision.current++;
    if (initialScript) { onBack(); return; }
    if (draft) { setDraft(null); setNotice(''); setError(''); }
    else onBack();
  }
  async function copy(script = target) {
    const anchor = !draft && !menu ? search.current : back.current?.closest('.palette-footer')?.querySelector<HTMLButtonElement>('.primary-action') || back.current;
    if (!script || !anchor || busy || !ready || deleting) return;
    const version = revision.current;
    const selection = search.current ? [search.current.selectionStart ?? 0, search.current.selectionEnd ?? 0] as const : undefined;
    try {
      await copyText(script.code, anchor);
      if (version === revision.current) { setNotice(t('scriptCopied')); setError(''); }
    } catch { if (version === revision.current) setError(t('scriptCopyError')); }
    if (anchor === search.current && selection) search.current?.setSelectionRange(...selection);
  }
  function select(id: string) { revision.current++; setSelection(id); setNotice(''); setError(''); }
  function filter(value: string) { revision.current++; setQuery(value); setNotice(''); setError(''); }
  async function save() {
    if (!draft || builtin || busy || !ready) return;
    const version = revision.current;
    setMenu(false); setBusy(true); setError('');
    try { await saveScript(draft); if (version !== revision.current) return; if (onComplete) onComplete(t('scriptSaved')); else { setSelection(draft.id); setDraft(null); setNotice(t('scriptSaved')); } }
    catch (reason) { if (version === revision.current) setError(reason instanceof Error ? reason.message : t('errorGeneric')); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true); setError('');
    try { await deleteScript(deleting.id); if (onComplete) onComplete(t('scriptDeleted')); else { setDraft(null); setNotice(t('scriptDeleted')); setDeleting(null); } }
    catch { setError(t('errorGeneric')); }
    finally { setBusy(false); }
  }
  function act(id: string) {
    if (busy || !ready || deleting) return;
    setMenu(false);
    if (id === 'save') void save();
    if (id === 'edit' && selected) edit(selected);
    if (id === 'new') create();
    if (id === 'copy') void copy();
    if (id === 'shortcuts') void openShortcuts().then(onClose).catch(() => setError(t('errorGeneric')));
    if (id === 'delete' && target && target.id !== 'builtin-ctrl-tab') setDeleting(target);
  }
  return <BackLayer onBack={onBack}><BackLayer active={!!draft} onBack={leave}><section tabIndex={-1} className="palette script-library" aria-label={t('scriptLibrary')} onFocusCapture={event => {
    const field = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (['INPUT', 'TEXTAREA'].includes(field.tagName) && field.closest('.script-field, .script-search, .script-preview')) lastField.current = field;
  }} onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const modifier = isMac ? event.metaKey : event.ctrlKey;
    if (!draft && modifier && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'n') {
      event.preventDefault(); event.stopPropagation(); if (!event.repeat) create(); return;
    }
    if (modifier && !event.shiftKey && !event.altKey && !deleting) {
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); event.stopPropagation(); if (!event.repeat) toggleMenu(); return; }
      if (draft && !builtin && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (!event.repeat) void save(); return; }
    }
    if (event.key === 'Enter' && (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
      && (!draft || !['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement).tagName))) {
      event.preventDefault(); event.stopPropagation(); return;
    }
    if (builtin && event.key === 'Enter' && !['BUTTON', 'TEXTAREA'].includes((event.target as HTMLElement).tagName)) {
      event.preventDefault(); void copy();
    }
    if (deleting && event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation();
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.script-confirm button:not(:disabled)'));
      buttons[(buttons.indexOf(event.target as HTMLButtonElement) + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }
  }}>
    <div className={`script-surface ${menu || deleting ? 'subdued' : ''}`} inert={menu || deleting ? true : undefined}>
      {draft ? <div className="script-editor-body">
        {builtin ? <div className="binding-guide">
          <p>{t('bindingEffect')}</p>
          <ol><li>{t('bindingStepCopy')}</li><li>{t('bindingStepOpen')}</li><li>{t('bindingStepConsole', isMac ? '⌘⌥J' : 'Ctrl+Shift+J')}</li></ol>
        </div> : <label className="script-field">{t('scriptName')}<input ref={title} value={draft.title} maxLength={120} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>}
        <label className="script-field script-code-field">{t('scriptCode')}<textarea aria-label={t('scriptCode')} value={draft.code} readOnly={builtin} spellCheck={false}
          onChange={event => setDraft({ ...draft, code: event.target.value })} /></label>
        {!builtin ? <p className="script-description">{t('scriptExecutionHint')}</p> : null}
      </div> : <ScriptList id="script-library-results" scripts={results} selected={selected} query={query} onQueryChange={filter}
        onSelect={select} onActivate={script => void copy(script)} onContextMenu={() => openMenu()} searchRef={search} isMac={isMac} active={!menu && !deleting}
        detail={<ScriptPreview script={selected} />} />}
    </div>
    {error ? <div className="error-banner" role="alert">{error}</div> : null}
    {menu ? <ActionMenu id="script-editor-actions" isMac={isMac} title={<span>{target?.title || location}</span>}
      actions={actions} query={actionQuery} onQueryChange={value => { setActionQuery(value); setActionSelection(''); }}
      selectedId={activeAction?.id} onSelectionChange={setActionSelection} onAction={act} onClose={() => setMenu(false)} /> : null}
    {deleting ? <BackLayer onBack={() => { if (!busy) setDeleting(null); }}>
      <button className="action-scrim" tabIndex={-1} aria-label={t('backToResults')} onClick={() => { if (!busy) setDeleting(null); }} />
      <div className="action-menu script-confirm" role="alertdialog" aria-modal="true" aria-labelledby="editor-delete-title">
        <h2 id="editor-delete-title">{t('confirmDeleteScript')}</h2><p>{t('scriptDeletePrompt', deleting.title)}</p>
        <div className="script-controls"><button ref={cancelDelete} className="surface-button" disabled={busy} onClick={() => setDeleting(null)}>{t('cancelScriptDelete')}</button>
          <button className="surface-button delete-script-button" disabled={busy} onClick={() => void remove()}>{t('deleteScript')}</button></div>
      </div>
    </BackLayer> : null}
    <PaletteFooter isMac={isMac} title={location}
      navigation={{ kind: 'back', label: `${t('back')} · ${location}`, tooltip: `${t('back')} · Esc`, buttonRef: back, onAction: leave }}
      context={<span className="storage-origin" title={t('scriptLocalOnly')}>{t('scriptLocalOnly')}</span>}
      status={notice ? <span role="status">{notice}</span> : busy ? <span role="status">{t('running')}</span> : undefined}
      primary={menu ? { label: activeAction?.title || t('actions'), keys: ['↵'], disabled: busy || !ready || !activeAction, danger: !!activeAction?.danger, onAction: () => { if (activeAction) act(activeAction.id); } }
        : draft && !builtin ? { label: t('saveScript'), keys: [mod, '↵'], disabled: busy || !ready || !!deleting, onAction: () => void save() }
          : builtin ? { label: t('copyScript'), keys: ['↵'], disabled: busy || !ready, onAction: () => void copy() }
            : { label: t('copyScript'), keys: ['↵'], disabled: busy || !ready || !selected || !!deleting, onAction: () => void copy() }}
      secondary={!draft && !menu ? { label: t('newScript'), keys: [mod, isMac ? '⇧' : 'Shift', 'N'], icon: <Plus size={16} />, disabled: busy || !ready || !!deleting, onAction: create } : undefined}
      actions={{ open: menu, disabled: busy || !ready || !!deleting, onToggle: toggleMenu }} />
  </section></BackLayer></BackLayer>;
}
