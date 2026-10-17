import { BackLayer } from './Navigation';
import { SearchDismissButton } from './SearchDismissButton';
import { ActionMenu } from './ActionMenu';
import { PaletteFooter } from './PaletteFooter';
import { HighlightedText } from './HighlightedText';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, Copy, LoaderCircle, Play, Search } from 'lucide-react';
import { getScripts, subscribeScripts } from './scripts';
import { openScriptSettings, runSavedScript } from './api';
import { copyText } from './clipboard';
import { errorMessage, t } from './i18n';
import type { ScriptResult, ScriptRun } from './types';

export function ScriptRunner({ target, initialScriptId, autoCopy, onBack }: {
  target: Omit<ScriptRun, 'scriptId'>; initialScriptId?: string; autoCopy: boolean; onBack: () => void;
}) {
  const scripts = useSyncExternalStore(subscribeScripts, getScripts);
  const [selectedId, setSelectedId] = useState(initialScriptId || '');
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScriptResult | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copyFailed, setCopyFailed] = useState(false);
  const [menu, setMenu] = useState(false);
  const [actionQuery, setActionQuery] = useState('');
  const [actionSelection, setActionSelection] = useState('');
  const surface = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const outputCaret = useRef<[number, number]>([0, 0]);
  const wasMenu = useRef(false);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const search = useRef<HTMLInputElement>(null);
  const searchCaret = useRef<[number, number]>([0, 0]);
  const list = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const pending = useRef(false);
  const runRevision = useRef(0);
  const rows = scripts.filter(script => script.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selected = rows[Math.min(index, rows.length - 1)];
  const script = scripts.find(script => script.id === selectedId);
  const actions = [
    ...(result?.success ? [{ id: 'copy', title: t('copyScriptResult'), keywords: 'copy result 复制结果', icon: <Copy size={16} /> }] : []),
    ...(script ? [{ id: 'rerun', title: t('rerunScript'), keywords: 'rerun run again 重新运行 再次执行', icon: <Play size={16} /> }] : []),
  ].filter(action => `${action.title} ${action.keywords}`.toLocaleLowerCase().includes(actionQuery.trim().toLocaleLowerCase()));
  const activeAction = actions.find(action => action.id === actionSelection) || actions[0];
  function primaryButton() { return surface.current?.querySelector<HTMLButtonElement>('.palette-footer .primary-action:not(:disabled)'); }
  async function copy() {
    const anchor = primaryButton() || back.current;
    if (!result?.success || pending.current || !anchor) return;
    const revision = runRevision.current;
    setNotice(''); setCopyFailed(false);
    try {
      await copyText(result.text, anchor);
      if (alive.current && revision === runRevision.current) setNotice(t('scriptResultCopied'));
    } catch {
      if (alive.current && revision === runRevision.current) { setNotice(t('scriptResultCopyFailed')); setCopyFailed(true); }
    }
  }
  function toggleMenu() {
    if (!selectedId || pending.current || busy) return;
    if (!menu) {
      const root = surface.current!.getRootNode() as Document | ShadowRoot;
      returnFocus.current = root.activeElement as HTMLElement | null;
      const field = returnFocus.current as HTMLTextAreaElement | null;
      if (field?.tagName === 'TEXTAREA') outputCaret.current = [field.selectionStart, field.selectionEnd];
      setActionQuery(''); setActionSelection('');
    }
    setMenu(!menu);
  }
  function act(id: string) {
    if (pending.current || busy) return;
    setMenu(false);
    if (id === 'copy') void copy();
    else if (id === 'rerun' && script) void run(script.id);
  }
  async function run(id: string) {
    if (pending.current) return;
    if (!selectedId) {
      setIndex(Math.max(0, rows.findIndex(row => row.id === id)));
      searchCaret.current = [search.current?.selectionStart ?? query.length, search.current?.selectionEnd ?? query.length];
    }
    const revision = ++runRevision.current;
    pending.current = true; setMenu(false); setSelectedId(id); setBusy(true); setResult(null); setError(''); setNotice(''); setCopyFailed(false);
    try {
      const value = await runSavedScript({ ...target, scriptId: id });
      if (!alive.current || revision !== runRevision.current) return;
      setResult(value);
      if (autoCopy && value.success && back.current) {
        try { await copyText(value.text, back.current); if (alive.current && revision === runRevision.current) setNotice(t('scriptResultCopied')); }
        catch { if (alive.current && revision === runRevision.current) { setNotice(t('scriptResultCopyFailed')); setCopyFailed(true); } }
      }
    } catch (reason) { if (alive.current && revision === runRevision.current) setError(errorMessage(reason)); }
    finally { if (revision === runRevision.current) { pending.current = false; if (alive.current) setBusy(false); } }
  }
  useEffect(() => {
    alive.current = true;
    if (initialScriptId) void run(initialScriptId);
    return () => { alive.current = false; };
  }, []);
  useLayoutEffect(() => {
    const restore = wasMenu.current && !menu;
    wasMenu.current = menu;
    if (menu) return;
    if (!selectedId) { search.current?.focus(); search.current?.setSelectionRange(...searchCaret.current); }
    else if (busy) back.current?.focus();
    else if (restore && returnFocus.current?.isConnected && !returnFocus.current.hasAttribute('disabled')) {
      const field = returnFocus.current;
      field.focus({ preventScroll: true });
      if (field.tagName === 'TEXTAREA') (field as HTMLTextAreaElement).setSelectionRange(...outputCaret.current);
    } else (primaryButton() || back.current)?.focus();
  }, [selectedId, busy, result, menu]);
  useLayoutEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selected?.id, !!selectedId]);
  function leave() {
    if (selectedId && !initialScriptId) {
      runRevision.current++; pending.current = false; setBusy(false);
      setSelectedId(''); setMenu(false); setResult(null); setError(''); setNotice(''); setCopyFailed(false);
    }
    else onBack();
  }
  return <BackLayer onBack={onBack}><BackLayer active={!!selectedId} onBack={leave}><section ref={surface} tabIndex={-1} className="palette settings-view script-runner" aria-label={t('runScript')} onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)) {
      event.preventDefault(); event.stopPropagation(); return;
    }
    const modifier = isMac ? event.metaKey : event.ctrlKey;
    if (selectedId && modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault(); event.stopPropagation(); if (!event.repeat) toggleMenu(); return;
    }
    if (selectedId && event.key === 'Enter' && (event.target as HTMLElement).tagName !== 'BUTTON') {
      // Text selection and native copy in the read-only result remain untouched.
      if ((event.target as HTMLElement).tagName === 'TEXTAREA') return;
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) act(result?.success ? 'copy' : 'rerun');
      return;
    }
    if (!selectedId && event.target === search.current) {
      const arrow = event.key === 'ArrowDown' || event.key === 'ArrowUp';
      const emacs = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && ['n', 'p'].includes(event.key.toLowerCase());
      if (!event.shiftKey && (arrow || emacs || ['PageDown', 'PageUp'].includes(event.key))) {
        event.preventDefault(); event.stopPropagation();
        if (!rows.length) return;
        const at = rows.indexOf(selected);
        const down = event.key === 'ArrowDown' || event.key === 'PageDown' || event.key.toLowerCase() === 'n';
        let next = (at + (down ? 1 : -1) + rows.length) % rows.length;
        if (arrow && modifier) next = down ? rows.length - 1 : 0;
        else if (event.altKey || event.key.startsWith('Page')) {
          const row = list.current?.querySelector<HTMLElement>('.script-item');
          const page = Math.max(1, Math.floor((list.current?.clientHeight ?? 280) / (row?.offsetHeight || 40)) - 1);
          next = Math.max(0, Math.min(rows.length - 1, at + (down ? page : -page)));
        }
        setIndex(next);
      } else if (event.key === 'Enter') {
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && selected) void run(selected.id);
      }
    }
  }}>
    <div className={`script-surface ${menu ? 'subdued' : ''}`} inert={menu ? true : undefined}>
      <header className="settings-header"><button ref={back} className="settings-back" onClick={leave} aria-label={t('back')}><ArrowLeft size={18} /></button>
        <h1>{selectedId ? script?.title || t('runScript') : t(autoCopy ? 'runCopyScript' : 'runScript')}</h1>{selectedId ? <kbd>esc</kbd> : null}</header>
      <div className="settings-body">
        <p className="script-description script-run-target">{t('scriptRunTarget', (() => { try { return new URL(target.expectedUrl).host; } catch { return target.expectedUrl; } })())}</p>
        {!selectedId ? <>
          <div className="script-search"><Search size={16} /><input data-back-on-empty ref={search} aria-label={t('searchScripts')} placeholder={t('searchScripts')} value={query} onChange={event => { setQuery(event.target.value); setIndex(0); }} />
            <SearchDismissButton label={t('back')} /></div>
          <div ref={list} className="script-list" role="listbox" aria-label={t('scriptLibrary')}>{rows.map(row => <button key={row.id} role="option" aria-selected={row.id === selected?.id} className={`script-item ${row.id === selected?.id ? 'selected' : ''}`} onClick={() => void run(row.id)}>
            <span><HighlightedText text={row.title} query={query} allowTypos={false} /></span><Play size={14} /></button>)}</div>
          {!rows.length ? <p className="empty">{t(scripts.length ? 'noResults' : 'noRunnableScripts')}</p> : null}
        </> : <>
          {busy ? <div className="script-run-status" role="status"><LoaderCircle className="spinner" size={18} />{t('scriptExecuting')}<p>{t('scriptRunningBack')}</p></div> : null}
          {result ? <><p className="setting-note">{t(result.success ? 'scriptResult' : 'scriptRunFailed')}</p>
            <textarea className="script-output" aria-label={t('scriptResult')} value={result.text} readOnly spellCheck={false} />
            {!result.success ? <p className="recent-error" role="alert">{t('scriptRunFailed')}</p> : null}</> : null}
          {error ? <p className="recent-error" role="alert">{error}</p> : null}
          {error === t('errorScriptDisabled') ? <div className="binding-guide"><p>{t('scriptEnableHint')}</p><button className="ranking-reset" onClick={() => { void openScriptSettings().catch(reason => setError(errorMessage(reason))); }}>{t('enableUserScripts')}</button></div> : null}
        </>}
      </div>
    </div>
    {menu ? <ActionMenu id="script-result-actions" isMac={isMac} title={<span>{script?.title || t('scriptResult')}</span>}
      actions={actions} query={actionQuery} onQueryChange={value => { setActionQuery(value); setActionSelection(''); }}
      selectedId={activeAction?.id} onSelectionChange={setActionSelection} onAction={act} onClose={() => setMenu(false)} /> : null}
    {notice ? <div className="script-feedback"><p className={copyFailed ? 'recent-error' : 'setting-note'} role={copyFailed ? 'alert' : 'status'}>{notice}</p></div> : null}
    <PaletteFooter isMac={isMac} status={<span className="footer-note" title={t('scriptResultsTemporary')}>{t('scriptResultsTemporary')}</span>}
      primary={selectedId ? {
        label: busy ? t('scriptExecuting') : menu ? activeAction?.title || t('copyScriptResult') : t(result?.success ? 'copyScriptResult' : 'rerunScript'),
        keys: ['↵'], disabled: busy || (menu ? !activeAction : !result?.success && !script),
        onAction: () => act(menu ? activeAction?.id || '' : result?.success ? 'copy' : 'rerun'),
      } : { label: t('runScript'), keys: ['↵'], disabled: !selected, onAction: () => { if (selected) void run(selected.id); } }}
      actions={selectedId ? { open: menu, disabled: busy || (!result?.success && !script), onToggle: toggleMenu } : undefined} />
  </section></BackLayer></BackLayer>;
}
