import { BackLayer } from './Navigation';
import { SearchFocusButton } from './SearchFocusButton';
import { SearchDismissButton } from './SearchDismissButton';
import { ActionMenu } from './ActionMenu';
import { PaletteFooter } from './PaletteFooter';
import { TaskHeader } from './TaskHeader';
import { useOperationFeedback } from './OperationFeedback';
import { ReadOnlyPreview } from './ReadOnlyPreview';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Copy, Database, Cookie, RotateCcw, FileText, LoaderCircle } from 'lucide-react';
import { readPageStorage, openCookieAccess } from './api';
import { copyText } from './clipboard';
import { t, errorMessage } from './i18n';
import { HighlightedText } from './HighlightedText';
import type { PageStorage, StorageEntry, StorageRead } from './types';

export function StorageView({ request, onBack, isMac }: { request: StorageRead; onBack: () => void; isMac: boolean }) {
  const [data, setData] = useState<PageStorage | null>(null);
  const [busy, setBusy] = useState(true);
  const [showLoading, setShowLoading] = useState(false);
  const [error, setError] = useState('');
  const feedback = useOperationFeedback();
  const executing = useRef(false);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState('');
  const [detail, setDetail] = useState<StorageEntry | null>(null);
  const [menu, setMenu] = useState(false);
  const [actionQuery, setActionQuery] = useState('');
  const [actionSelection, setActionSelection] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const detailBody = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const waitingForAccess = useRef(false);
  const learned = useRef(false);
  const caret = useRef<[number, number]>([0, 0]);
  const title = request.kind === 'local' ? 'Local Storage' : request.kind === 'session' ? 'Session Storage' : 'Cookies';
  const normalized = query.trim().toLocaleLowerCase();
  const rows = data?.entries.filter(row => row.name.toLocaleLowerCase().includes(normalized)) || [];
  const selected = rows.find(row => row.id === selection) || rows[0];
  const current = detail || selected;
  const actions = [
    ...(current ? [
      { id: 'value', title: t('copyValue'), keywords: 'copy value 复制值', icon: Copy },
      { id: 'name', title: t('copyName'), keywords: 'copy name key 复制名称', icon: Copy },
      ...(!detail ? [{ id: 'detail', title: t('viewDetails'), keywords: 'view details 查看详情', icon: FileText }] : []),
    ] : []),
    { id: 'refresh', title: t('refreshStorage'), keywords: 'refresh reload 刷新', icon: RotateCcw },
  ].filter(action => `${action.title} ${action.keywords}`.toLowerCase().includes(actionQuery.trim().toLowerCase()));
  const activeAction = actions.find(action => action.id === actionSelection) || actions[0];

  async function refresh(learn = false, report = false) {
    const revision = ++sequence.current;
    const operation = report ? feedback.begin(t('running')) : undefined;
    setBusy(true); if (!report) setError(''); setDetail(null);
    try {
      const result = await readPageStorage({ ...request, query: learn && !learned.current ? request.query : undefined });
      if (sequence.current === revision) { setData(result); setError(''); if (learn) learned.current = true; }
      if (operation !== undefined) feedback.success(operation, t('storageRefreshed'));
    } catch (reason) {
      if (sequence.current === revision && !report) { setData(null); setError(errorMessage(reason)); }
      if (operation !== undefined) feedback.error(operation, errorMessage(reason));
    } finally { if (sequence.current === revision) setBusy(false); }
  }
  useEffect(() => {
    setShowLoading(false);
    if (!busy || data) return;
    const timer = setTimeout(() => setShowLoading(true), 150);
    return () => clearTimeout(timer);
  }, [busy, data]);
  useEffect(() => {
    void refresh(true);
    // The overlay lives in an isolated iframe. Chrome restores focus to that
    // window after the permission popup closes, not to the parent page window.
    const view = input.current?.ownerDocument.defaultView || window;
    const focus = () => {
      if (waitingForAccess.current) {
        waitingForAccess.current = false;
        void refresh(true).then(() => input.current?.focus());
      }
    };
    view.addEventListener('focus', focus);
    return () => { sequence.current++; view.removeEventListener('focus', focus); };
  }, []);
  async function authorize() {
    if (executing.current) return;
    executing.current = true; waitingForAccess.current = true;
    try {
      const result = await feedback.run(() => openCookieAccess({ tabId: request.tabId, windowId: request.windowId, expectedUrl: request.expectedUrl }), t('cookieAccessOpened'));
      if (!result.ok) waitingForAccess.current = false;
    } finally { executing.current = false; }
  }
  useEffect(() => {
    if (menu) return;
    if (detail) detailBody.current?.focus();
    else { input.current?.focus(); input.current?.setSelectionRange(...caret.current); }
  }, [menu, detail]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selected?.id, detail]);
  function openMenu() {
    if (busy) return;
    if (!menu && !detail) caret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
    setMenu(!menu); setActionQuery(''); setActionSelection('');
  }
  function back() { if (menu) setMenu(false); else if (detail) setDetail(null); else onBack(); }
  async function act(id: string, targetEntry = current) {
    if (busy || executing.current || (id !== 'refresh' && !targetEntry)) return;
    setMenu(false);
    if (id === 'refresh') {
      executing.current = true;
      try { await refresh(false, true); }
      finally { executing.current = false; }
      return;
    }
    if (!targetEntry) return;
    if (!detail) caret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
    if (id === 'detail') { setDetail(targetEntry); return; }
    const anchor = detail ? detailBody.current : input.current;
    if (!anchor) return;
    executing.current = true; setBusy(true);
    try {
      await feedback.run(() => copyText(id === 'name' ? targetEntry.name : targetEntry.value, anchor), t(id === 'name' ? 'copiedName' : 'copiedValue'), t('errorStorageCopy'));
    } finally { executing.current = false; setBusy(false); }
  }
  function keyboard(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const modifier = isMac ? event.metaKey : event.ctrlKey;
    if (modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') { event.preventDefault(); openMenu(); return; }
    if (event.key === 'Tab') {
      const scope = event.currentTarget;
      const nodes = Array.from(scope.querySelectorAll<HTMLElement>('input, textarea, button:not(:disabled), [tabindex="0"]'))
        .filter(node => node.offsetParent !== null && !node.closest('[inert]') && !node.hasAttribute('disabled') && node.tabIndex >= 0 && (!menu || node.closest('.action-menu')));
      const index = nodes.indexOf(event.target as HTMLElement);
      const next = index < 0 ? (event.shiftKey ? nodes.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length;
      event.preventDefault(); nodes[next]?.focus(); return;
    }
    if (menu || busy || (event.target as HTMLElement).closest('.storage-preview')) return;
    const emacs = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && ['p', 'n'].includes(event.key.toLowerCase());
    const arrow = ['ArrowDown', 'ArrowUp'].includes(event.key);
    if (detail && !event.shiftKey && (arrow || emacs || ['PageDown', 'PageUp'].includes(event.key))) {
      event.preventDefault();
      const body = detailBody.current!;
      const down = ['arrowdown', 'pagedown', 'n'].includes(event.key.toLowerCase());
      if (arrow && modifier) body.scrollTop = down ? body.scrollHeight : 0;
      else body.scrollTop += (down ? 1 : -1) * (event.altKey || event.key.startsWith('Page') ? body.clientHeight - 40 : 40);
    } else if (!event.shiftKey && (arrow || emacs || ['PageDown', 'PageUp'].includes(event.key))) {
      event.preventDefault();
      const count = rows.length;
      if (!count) return;
      const index = rows.findIndex(row => row.id === selected?.id);
      const down = ['arrowdown', 'pagedown', 'n'].includes(event.key.toLowerCase());
      let next = (index + (down ? 1 : -1) + count) % count;
      if (arrow && modifier) next = down ? count - 1 : 0;
      else if (event.altKey || event.key.startsWith('Page')) next = Math.max(0, Math.min(count - 1, index + (down ? 1 : -1) * 6));
      setSelection(rows[next].id);
    } else if (event.key === 'Enter' && (event.target as HTMLElement).tagName !== 'BUTTON') {
      event.preventDefault();
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      void act('value');
    }
  }
  return <BackLayer onBack={onBack}><BackLayer active={!!detail} onBack={() => setDetail(null)}><section tabIndex={-1} className="palette storage-view" aria-label={title} aria-busy={busy} onKeyDown={keyboard}>
    {detail ? <TaskHeader /> : null}
    <span className="sr-only" id="storage-navigation">{t('navigationHelp')}</span>
    <div className={`storage-surface ${menu ? 'subdued' : ''}`} inert={menu ? true : undefined}>
      {detail ? <div className="storage-detail" ref={detailBody} tabIndex={0} aria-label={t('viewDetails')}>
        <StorageValue entry={detail} />
      </div> : <>
        <div className="storage-search"><SearchFocusButton input={input} /><input data-back-on-empty ref={input} value={query} onChange={event => { setQuery(event.target.value); setSelection(''); }}
          placeholder={t('storageSearch')} aria-label={t('storageSearchLabel')} role="combobox" aria-expanded="true" aria-controls="storage-results" aria-autocomplete="list"
          aria-activedescendant={selected ? `storage-row-${rows.indexOf(selected)}` : undefined} aria-describedby="storage-navigation" autoComplete="off" spellCheck={false} />
          <SearchDismissButton label={t('back')} query={query} input={input} onClear={() => { setQuery(''); setSelection(''); }} /></div>
        <div className={`storage-list-content ${selected ? 'with-detail' : ''}`}>
        <div className="storage-results" id="storage-results" role="listbox" aria-label={t('storageEntries')} ref={list}>
          {busy && !data && showLoading ? <div className="empty"><LoaderCircle className="spinner" size={24} /><p>{t('loading')}</p></div> : error && !data ? <div className="empty storage-error" role="alert"><Database size={24} /><p>{error}</p><button className="surface-button" onClick={() => { if (error === t('errorStoragePermission')) void authorize(); else void act('refresh'); }}>{t(error === t('errorStoragePermission') ? 'allowCookieAccess' : 'retry')}</button></div>
            : !rows.length && !busy ? <div className="empty"><Database size={26} /><strong>{query ? t('noResults') : t('storageEmpty')}</strong></div>
            : rows.map((row, index) => <div key={row.id} id={`storage-row-${index}`} className="result storage-row" role="option" aria-selected={row.id === selected?.id}
              title={row.name || t('storageEmptyName')}
              onClick={() => { setSelection(row.id); input.current?.focus({ preventScroll: true }); }}
              onDoubleClick={() => { setSelection(row.id); void act('detail', row); }}
              onContextMenu={event => {
                event.preventDefault();
                if (busy) return;
                caret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
                setSelection(row.id); setMenu(true); setActionQuery(''); setActionSelection('');
              }}>
              <span className="entry-icon command">{row.cookie ? <Cookie size={18} /> : <Database size={18} />}</span>
              <span className="entry-copy"><span className="entry-title"><HighlightedText text={row.name || t('storageEmptyName')} query={query} allowTypos={false} /></span></span>
              {row.cookie ? <span className="storage-cookie-scope">{row.cookie.domain}<span>{row.cookie.path}{row.cookie.partitionKey ? ` · ${t('cookiePartition')}` : ''}</span></span> : null}
            </div>)}
        </div>
        {selected ? <div className="storage-list-detail">
          <StorageValue entry={selected} preview />
        </div> : null}
        </div>
      </>}
    </div>
    {menu ? <ActionMenu id="storage-actions" isMac={isMac} title={<span>{current?.name || title}</span>}
      actions={actions.map(action => ({ id: action.id, title: action.title, icon: <action.icon size={16} /> }))}
      query={actionQuery} onQueryChange={value => { setActionQuery(value); setActionSelection(''); }}
      selectedId={activeAction?.id} onSelectionChange={setActionSelection} onAction={id => void act(id)} onClose={() => setMenu(false)} /> : null}
    <PaletteFooter isMac={isMac}
      navigation={detail ? undefined : { kind: 'back', label: `${t('back')} · ${title}`, tooltip: `${t('back')} (Esc)`, onAction: back }}
      title={title}
      context={<span className="storage-origin" title={request.expectedUrl}>{request.expectedUrl.replace(/^https?:\/\//, '').split('/')[0] || request.expectedUrl}</span>}
      primary={{ label: menu ? activeAction?.title || t('copyValue') : t('copyValue'), keys: ['↵'], disabled: busy || (menu ? !activeAction : !current), onAction: () => void act(menu ? activeAction?.id || '' : 'value') }}
      actions={{ open: menu, disabled: busy, onToggle: openMenu }} />
  </section></BackLayer></BackLayer>;
}

function StorageValue({ entry, preview = false }: { entry: StorageEntry; preview?: boolean }) {
  let formatted = entry.value;
  let json = false;
  try { formatted = JSON.stringify(JSON.parse(entry.value), null, 2); json = true; } catch { /* Plain text. */ }
  const cookie = entry.cookie;
  const metadata = cookie ? [
    { label: t('cookieDomain'), value: cookie.domain },
    { label: t('cookiePath'), value: cookie.path },
    { label: 'HttpOnly / Secure', value: `${cookie.httpOnly} / ${cookie.secure}` },
    { label: 'SameSite', value: cookie.sameSite },
    { label: t('cookieExpires'), value: cookie.session ? t('cookieSession') : new Date(cookie.expirationDate! * 1000).toLocaleString() },
    { label: t('cookiePartition'), value: cookie.partitionKey ? JSON.stringify(cookie.partitionKey) : t('cookieUnpartitioned') },
  ] : [];
  if (preview) return <ReadOnlyPreview className="storage-preview" label={t('storageValue')}
    content={{ id: entry.id, value: formatted, label: t('storageValue'), placeholder: t('storageEmptyValue') }}
    information={[
      { label: 'Key', value: entry.name || t('storageEmptyName') },
      { label: t('previewContentType'), value: json ? 'JSON' : 'Text' },
      ...metadata,
    ]} />;
  return <>
    <h1>{entry.name || t('storageEmptyName')}</h1>
    <p className="storage-value-label">{json ? t('storageJson') : t('storageValue')}</p>
    <pre className="storage-value">{formatted || t('storageEmptyValue')}</pre>
    {cookie ? <dl className="cookie-metadata">{metadata.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl> : null}
  </>;
}
