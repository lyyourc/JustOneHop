import { BackLayer } from './Navigation';
import { ActionMenu } from './ActionMenu';
import { PaletteFooter } from './PaletteFooter';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, Copy, Database, Cookie, Search, RotateCcw, FileText, LoaderCircle } from 'lucide-react';
import { readPageStorage, openCookieAccess } from './api';
import { copyText } from './clipboard';
import { t, errorMessage } from './i18n';
import { HighlightedText } from './HighlightedText';
import type { PageStorage, StorageEntry, StorageRead } from './types';

export function StorageView({ request, onBack, isMac }: { request: StorageRead; onBack: () => void; isMac: boolean }) {
  const [data, setData] = useState<PageStorage | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
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
  const pointer = useRef<{ x: number; y: number } | null>(null);
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

  async function refresh(learn = false) {
    const revision = ++sequence.current;
    setBusy(true); setError(''); setNotice(''); setDetail(null);
    try {
      const result = await readPageStorage({ ...request, query: learn && !learned.current ? request.query : undefined });
      if (sequence.current === revision) { setData(result); if (learn) learned.current = true; }
    } catch (reason) {
      if (sequence.current === revision) { setData(null); setError(errorMessage(reason)); }
    } finally { if (sequence.current === revision) setBusy(false); }
  }
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
    waitingForAccess.current = true;
    try { await openCookieAccess({ tabId: request.tabId, windowId: request.windowId, expectedUrl: request.expectedUrl }); }
    catch (reason) { waitingForAccess.current = false; setError(errorMessage(reason)); }
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
  async function act(id: string) {
    if (busy || (id !== 'refresh' && !current)) return;
    setMenu(false); setNotice(''); setError('');
    if (id === 'refresh') { void refresh(); return; }
    if (!current) return;
    if (!detail) caret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
    if (id === 'detail') { setDetail(current); return; }
    const anchor = detail ? detailBody.current : input.current;
    if (!anchor) return;
    try { await copyText(id === 'name' ? current.name : current.value, anchor); setNotice(t(id === 'name' ? 'copiedName' : 'copiedValue')); }
    catch { setError(t('errorStorageCopy')); }
  }
  function keyboard(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const modifier = isMac ? event.metaKey : event.ctrlKey;
    if (modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') { event.preventDefault(); openMenu(); return; }
    if (event.key === 'Tab') {
      const scope = event.currentTarget;
      const nodes = Array.from(scope.querySelectorAll<HTMLElement>('input, button:not(:disabled), [tabindex="0"]')).filter(node => node.offsetParent !== null);
      const index = nodes.indexOf(event.target as HTMLElement);
      event.preventDefault(); nodes[(index + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length]?.focus(); return;
    }
    if (busy) return;
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
      setSelection(rows[next].id); setNotice('');
    } else if (event.key === 'Enter' && (event.target as HTMLElement).tagName !== 'BUTTON') {
      event.preventDefault();
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      void act('value');
    }
  }
  function hover(event: React.MouseEvent, change: () => void) {
    const next = { x: event.screenX, y: event.screenY };
    if (pointer.current && (next.x !== pointer.current.x || next.y !== pointer.current.y)) change();
    pointer.current = next;
  }
  let formatted = detail?.value || '';
  let json = false;
  if (detail) { try { formatted = JSON.stringify(JSON.parse(detail.value), null, 2); json = true; } catch { /* Plain text. */ } }
  const cookie = detail?.cookie;
  return <BackLayer onBack={onBack}><BackLayer active={!!detail} onBack={() => setDetail(null)}><section tabIndex={-1} className="palette storage-view" aria-label={title} aria-busy={busy} onKeyDown={keyboard}>
    <span className="sr-only" id="storage-navigation">{t('navigationHelp')}</span>
    <div className={`storage-surface ${menu ? 'subdued' : ''}`} inert={menu ? true : undefined}>
      <header className="storage-header">
        <button className="settings-back" onClick={back} aria-label={t('back')}><ArrowLeft size={18} /></button>
        <strong>{title}</strong><span className="storage-origin" title={request.expectedUrl}>{request.expectedUrl.replace(/^https?:\/\//, '').split('/')[0] || request.expectedUrl}</span><kbd>esc</kbd>
      </header>
      {detail ? <div className="storage-detail" ref={detailBody} tabIndex={0} aria-label={t('viewDetails')}>
        <h1>{detail.name || t('storageEmptyName')}</h1>
        {cookie ? <dl className="cookie-metadata">
          <dt>{t('cookieDomain')}</dt><dd>{cookie.domain}</dd><dt>{t('cookiePath')}</dt><dd>{cookie.path}</dd>
          <dt>HttpOnly / Secure</dt><dd>{String(cookie.httpOnly)} / {String(cookie.secure)}</dd>
          <dt>SameSite</dt><dd>{cookie.sameSite}</dd><dt>{t('cookieExpires')}</dt><dd>{cookie.session ? t('cookieSession') : new Date(cookie.expirationDate! * 1000).toLocaleString()}</dd>
          <dt>{t('cookiePartition')}</dt><dd>{cookie.partitionKey ? JSON.stringify(cookie.partitionKey) : t('cookieUnpartitioned')}</dd>
        </dl> : null}
        <p className="storage-value-label">{json ? t('storageJson') : t('storageValue')}</p>
        <pre className="storage-value">{formatted || t('storageEmptyValue')}</pre>
      </div> : <>
        <div className="storage-search"><Search size={18} /><input data-back-on-empty ref={input} value={query} onChange={event => { setQuery(event.target.value); setSelection(''); setNotice(''); }}
          placeholder={t('storageSearch')} aria-label={t('storageSearchLabel')} role="combobox" aria-expanded="true" aria-controls="storage-results" aria-autocomplete="list"
          aria-activedescendant={selected ? `storage-row-${rows.indexOf(selected)}` : undefined} aria-describedby="storage-navigation" autoComplete="off" spellCheck={false} /></div>
        <div className="storage-results" id="storage-results" role="listbox" aria-label={t('storageEntries')} ref={list}>
          {busy ? <div className="empty"><LoaderCircle className="spinner" size={24} /><p>{t('loading')}</p></div> : error && !data ? <div className="empty storage-error" role="alert"><Database size={24} /><p>{error}</p><button onClick={() => { if (error === t('errorStoragePermission')) void authorize(); else void refresh(); }}>{t(error === t('errorStoragePermission') ? 'allowCookieAccess' : 'retry')}</button></div>
            : !rows.length ? <div className="empty"><Database size={26} /><strong>{query ? t('noResults') : t('storageEmpty')}</strong></div>
            : rows.map((row, index) => <div key={row.id} id={`storage-row-${index}`} className="result storage-row" role="option" aria-selected={row.id === selected?.id}
              onMouseMove={event => hover(event, () => setSelection(row.id))} onClick={() => { setSelection(row.id); input.current?.focus(); }} onDoubleClick={() => { setSelection(row.id); setDetail(row); }}>
              <span className="entry-icon command">{row.cookie ? <Cookie size={18} /> : <Database size={18} />}</span>
              <span className="storage-copy"><span className="entry-title"><HighlightedText text={row.name || t('storageEmptyName')} query={query} allowTypos={false} /></span>
                <span className="storage-summary">{row.value.slice(0, 180) || t('storageEmptyValue')}</span></span>
              {row.cookie ? <span className="storage-cookie-scope">{row.cookie.domain}<span>{row.cookie.path}{row.cookie.partitionKey ? ` · ${t('cookiePartition')}` : ''}</span></span> : null}
            </div>)}
        </div>
      </>}
    </div>
    {menu ? <ActionMenu id="storage-actions" isMac={isMac} title={<span>{current?.name || title}</span>}
      actions={actions.map(action => ({ id: action.id, title: action.title, icon: <action.icon size={16} /> }))}
      query={actionQuery} onQueryChange={value => { setActionQuery(value); setActionSelection(''); }}
      selectedId={activeAction?.id} onSelectionChange={setActionSelection} onAction={id => void act(id)} onClose={() => setMenu(false)} /> : null}
    {error && data ? <div className="error-banner" role="alert">{error}</div> : null}
    <PaletteFooter isMac={isMac}
      status={notice ? <span className="storage-notice" role="status">{notice}</span> : <span className="navigation-hint" title={t('navigationHelp')}><span className="navigation-label">{t('navigate')}</span><span className="navigation-key"><span className="navigation-arrow">↑</span><kbd>Ctrl P</kbd></span><span className="navigation-key"><span className="navigation-arrow">↓</span><kbd>Ctrl N</kbd></span></span>}
      primary={{ label: menu ? activeAction?.title || t('copyValue') : t('copyValue'), keys: ['↵'], disabled: busy || (menu ? !activeAction : !current), onAction: () => void act(menu ? activeAction?.id || '' : 'value') }}
      actions={{ open: menu, disabled: busy, onToggle: openMenu }} />
  </section></BackLayer></BackLayer>;
}
