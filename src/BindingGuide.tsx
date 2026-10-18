import { BackLayer } from './Navigation';
import { BindingNavigation } from './BindingNavigation';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { t } from './i18n';
import { copyText } from './clipboard';
import { openShortcuts } from './api';
import { PaletteFooter } from './PaletteFooter';
import { ActionMenu } from './ActionMenu';

export function bindingCode() {
  return `['switch-recent', 'switch-recent-back'].forEach((commandName, i) => chrome.developerPrivate.updateExtensionCommand({extensionId: ${JSON.stringify(chrome.runtime.id)}, commandName, keybinding: i ? 'Ctrl+Shift+Tab' : 'Ctrl+Tab'}));`;
}

export function BindingGuide({ onBack, isMac }: { onBack: () => void; isMac: boolean }) {
  const retainGuide = useContext(BindingNavigation);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState('');
  const back = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<[number, number] | null>(null);
  const revision = useRef(0);
  const pending = useRef(false);
  const wasMenu = useRef(false);
  useLayoutEffect(() => retainGuide(), [retainGuide]);
  useEffect(() => () => { revision.current++; }, []);
  function focusPrimary() { back.current?.closest('.palette-footer')?.querySelector<HTMLButtonElement>('.primary-action')?.focus(); }
  useLayoutEffect(() => { focusPrimary(); }, []);
  useLayoutEffect(() => {
    if (!menu && wasMenu.current) {
      if (caret.current && field.current) { field.current.focus(); field.current.setSelectionRange(...caret.current); }
      else focusPrimary();
    }
    wasMenu.current = menu;
  }, [menu]);
  const actions = [
    { id: 'copy', title: t('copyBindingCode'), keywords: 'copy code 复制代码', icon: <Copy size={16} /> },
    { id: 'shortcuts', title: t('openShortcutPage'), keywords: 'open chrome shortcuts 快捷键 打开', icon: <ExternalLink size={16} /> },
  ].filter(action => `${action.title} ${action.keywords}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selected = actions.find(action => action.id === selection) || actions[0];
  function toggleMenu() {
    if (pending.current) return;
    if (!menu) {
      const code = field.current;
      caret.current = code && (code.getRootNode() as Document | ShadowRoot).activeElement === code ? [code.selectionStart, code.selectionEnd] : null;
      setQuery(''); setSelection('');
    }
    setMenu(!menu);
  }
  function leave() { if (menu) setMenu(false); else { revision.current++; onBack(); } }
  function openBindingShortcuts() {
    const page = back.current?.ownerDocument;
    const transient = back.current?.closest('.justonehop-app.popup') &&
      (page?.location.hash.startsWith('#window=') || chrome.extension.getViews({ type: 'popup' }).includes(page?.defaultView as Window));
    return openShortcuts(Boolean(transient));
  }
  async function perform(action: 'copy' | 'shortcuts' | 'both') {
    const anchor = back.current;
    if (!anchor || pending.current) return;
    const version = revision.current;
    pending.current = true; setBusy(true); setError(''); setNotice(''); setMenu(false);
    try {
      if (action !== 'shortcuts') {
        try { await copyText(bindingCode(), anchor); }
        catch { if (version === revision.current) setError(t('bindingCopyError')); return; }
        if (version !== revision.current) return;
        setNotice(t('bindingCodeCopied'));
      }
      if (action !== 'copy' && version === revision.current) await openBindingShortcuts();
    } catch { if (version === revision.current) setError(t('errorGeneric')); }
    finally { pending.current = false; if (version === revision.current) setBusy(false); }
  }
  return <BackLayer onBack={leave}><section tabIndex={-1} className="palette binding-view" aria-label={t('bindCtrlTab')} onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const modifier = isMac ? event.metaKey : event.ctrlKey;
    if (modifier && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
      event.preventDefault(); event.stopPropagation(); if (!event.repeat) toggleMenu(); return;
    }
    if (event.key !== 'Enter' || menu) return;
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
      if ((event.target as HTMLElement).tagName !== 'TEXTAREA') { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    if (!['BUTTON', 'TEXTAREA'].includes((event.target as HTMLElement).tagName)) { event.preventDefault(); void perform('both'); }
  }}>
    <div className={`binding-surface ${menu ? 'subdued' : ''}`} inert={menu ? true : undefined}>
      <div className="binding-body">
        <div className="binding-guide"><p>{t('bindingEffect')}</p>
          <ol><li>{t('bindingStepCopy')}</li><li>{t('bindingStepConsole', isMac ? '⌘⌥J' : 'Ctrl+Shift+J')}</li></ol>
          <p>{t('bindingPasteHint')}</p>
        </div>
        <label className="binding-code-field">{t('bindingCode')}<textarea ref={field} aria-label={t('bindingCode')} value={bindingCode()} readOnly spellCheck={false} /></label>
      </div>
    </div>
    {error ? <div className="error-banner" role="alert">{error}</div> : null}
    {menu ? <ActionMenu id="binding-actions" isMac={isMac} title={<span>{t('bindCtrlTab')}</span>}
      actions={actions} query={query} onQueryChange={value => { setQuery(value); setSelection(''); }} selectedId={selected?.id}
      onSelectionChange={setSelection} onAction={id => void perform(id as 'copy' | 'shortcuts')} onClose={() => setMenu(false)} /> : null}
    <PaletteFooter isMac={isMac} title={t('bindCtrlTab')}
      navigation={{ kind: 'back', label: `${t('back')} · ${t('bindCtrlTab')}`, tooltip: `${t('back')} · Esc`, buttonRef: back, onAction: leave }}
      status={notice ? <span role="status">{notice}</span> : busy ? <span role="status">{t('running')}</span> : undefined}
      primary={menu ? { label: selected?.title || t('actions'), keys: ['↵'], disabled: busy || !selected, onAction: () => { if (selected) void perform(selected.id as 'copy' | 'shortcuts'); } }
        : { label: t('bindingCopyOpen'), keys: ['↵'], disabled: busy, onAction: () => void perform('both') }}
      actions={{ open: menu, disabled: busy, onToggle: toggleMenu }} />
  </section></BackLayer>;
}
