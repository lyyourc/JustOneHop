import { useLayoutEffect, useRef, useState } from 'react';
import { useResultSelection } from './useResultSelection';
import { Layers, Palette, PanelTop, Pencil, Save, Search, X } from 'lucide-react';
import { BackLayer } from './Navigation';
import { PaletteFooter } from './PaletteFooter';
import { ActionMenu } from './ActionMenu';
import { Favicon } from './Favicon';
import { HighlightedText } from './HighlightedText';
import { entries, search } from './model';
import { errorMessage, t, countMessage, type MessageKey } from './i18n';
import type { Snapshot, Entry, Execution, PaletteState } from './types';

const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] as const;
export function TabGroupView({ groupId, data, isMac, onBack, onClose, onExecute, executionBusy, refreshError, paletteState, initialState }: {
  groupId: number; data: Snapshot; isMac: boolean; onBack: () => void; onClose: () => void; executionBusy: boolean; refreshError: string;
  onExecute: (execution: Execution) => Promise<void>; paletteState: PaletteState; initialState?: PaletteState['group'];
}) {
  const group = data.groups?.find(group => group.id === groupId);
  const [query, setQuery] = useState(initialState?.id === groupId ? initialState.query : '');
  const [menu, setMenu] = useState(false);
  const [actionQuery, setActionQuery] = useState('');
  const [actionId, setActionId] = useState('');
  const [editor, setEditor] = useState<'name' | 'color'>();
  const [name, setName] = useState('');
  const [color, setColor] = useState<chrome.tabGroups.TabGroup['color']>('grey');
  const [localBusy, setBusy] = useState(false);
  const busy = localBusy || executionBusy;
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<[number, number]>(initialState?.id === groupId ? initialState.caret : [0, 0]);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const colorInput = useRef<HTMLSelectElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const members = entries({ ...data, groups: [], bookmarks: [], tabs: data.tabs.filter(tab => tab.groupId === groupId) }).filter(entry => entry.kind === 'tab');
  const results = search(members, query);
  const { selected, selection, setSelection } = useResultSelection(results, query, data.currentTabId,
    initialState?.id === groupId ? initialState.selection : '');
  const allActions: { id: string; title: string; keywords: string; icon: React.ReactNode; danger?: boolean }[] = editor ? [{ id: 'save', title: t('groupSave'), keywords: 'save 保存', icon: <Save size={16} /> }] : [
    ...(selected ? [
      { id: 'switch', title: t('switchTabPrimary'), keywords: 'switch tab 切换标签页', icon: <PanelTop size={16} /> },
      { id: 'ungroupTab', title: t('groupRemoveTab'), keywords: 'remove ungroup tab 移出 取消分组', icon: <Layers size={16} /> },
      { id: 'close', title: t('closeTab'), keywords: 'close tab 关闭标签页', icon: <X size={16} />, danger: true },
    ] : []),
    ...(group ? [
      { id: 'collapse', title: t(group.collapsed ? 'groupExpand' : 'groupCollapse'), keywords: group.collapsed ? 'expand open 展开' : 'collapse fold 折叠', icon: <Layers size={16} /> },
      { id: 'name', title: t('groupRename'), keywords: 'rename group 重命名 名称', icon: <Pencil size={16} /> },
      { id: 'color', title: t('groupColor'), keywords: 'change group color 颜色 换色', icon: <Palette size={16} /> },
    ] : []),
  ];
  const actions = allActions.filter(action => `${action.title} ${action.keywords}`.toLocaleLowerCase().includes(actionQuery.trim().toLocaleLowerCase()));
  const chosen = actions.find(action => action.id === actionId) || actions[0];
  useLayoutEffect(() => {
    if (menu || busy) return;
    if (editor === 'name') { nameInput.current?.focus(); nameInput.current?.select(); }
    else if (editor === 'color') colorInput.current?.focus();
    else { input.current?.focus(); input.current?.setSelectionRange(...caret.current); }
  }, [menu, editor, busy]);
  useLayoutEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selected?.id]);
  function rememberCaret() {
    if (!menu && !editor) caret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
  }
  function toggleMenu() {
    if (!busy) { rememberCaret(); setMenu(!menu); setActionQuery(''); setActionId(''); }
  }
  /** The footer breadcrumb mirrors Escape: it leaves exactly the deepest layer. */
  function back() {
    if (menu) { setMenu(false); return; }
    if (editor) { setEditor(undefined); return; }
    onBack();
  }
  async function run(id: string, target: Entry | undefined = selected) {
    if (busy || !group) return;
    if (id === 'name' || id === 'color') { rememberCaret(); setName(group.title); setColor(group.color); setEditor(id); setMenu(false); setError(''); return; }
    rememberCaret(); setBusy(true); setError('');
    try {
      if (id === 'save') {
        await onExecute({ action: 'updateGroup', windowId: data.windowId, groupId, groupChanges: editor === 'name' ? { title: name.trim() } : { color } });
      } else if (id === 'collapse') {
        await onExecute({ action: 'updateGroup', windowId: data.windowId, groupId, groupChanges: { collapsed: !group.collapsed } });
      } else if (target && (id === 'switch' || id === 'close' || id === 'ungroupTab')) {
        await onExecute({ action: id, windowId: data.windowId, groupId, tabId: target.tabId,
          ...(id === 'close' ? { paletteState: { ...paletteState, group: { id: groupId, query, selection, caret: caret.current } } } : {}) });
        if (id === 'switch') { onClose(); return; }
      } else return;
      setMenu(false); setEditor(undefined);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }
  const primary: { id: string; title: string; danger?: boolean } | undefined = menu ? chosen : editor ? { id: 'save', title: t('groupSave') } : selected ? { id: 'switch', title: t('switchTabPrimary') } : undefined;
  const groupLabel = `${t('categoryTabGroup')}: ${group?.title || t('unnamedGroup')}`;
  const body = <>
    <div className="group-surface" inert={menu ? true : undefined}>
      {!group ? <p className="empty">{t('groupMissing')}</p> : editor ? <div className="settings-body">
        <h2>{t(editor === 'name' ? 'groupRename' : 'groupColor')}</h2>
        {editor === 'name' ? <label className="group-field">{t('groupName')}<input ref={nameInput} value={name} onChange={event => setName(event.target.value)} disabled={busy} /></label>
          : <label className="group-field">{t('groupColor')}<select aria-label={t('groupColor')} ref={colorInput} value={color} onChange={event => setColor(event.target.value as chrome.tabGroups.TabGroup['color'])} disabled={busy}>
            {colors.map(value => <option key={value} value={value}>{t(`color${value[0].toUpperCase()}${value.slice(1)}` as MessageKey)}</option>)}
          </select></label>}
      </div> : <>
        <div className="search-bar"><span className="search-icon"><Search size={20} /></span><input ref={input} data-back-on-empty value={query} onChange={event => { setQuery(event.target.value); setSelection(''); }}
          placeholder={t('groupSearch')} aria-label={t('groupSearch')} role="combobox" aria-expanded="true" aria-controls="zing-group-tabs" aria-activedescendant={selected ? `group-${selected.id}` : undefined} disabled={busy} /></div>
        <div ref={list} className="results" id="zing-group-tabs" role="listbox" aria-label={t('resultsLabel')}>
          {results.map(entry => <div key={entry.id} id={`group-${entry.id}`} role="option" aria-selected={entry.id === selected?.id} className="result tab"
            onMouseMove={event => {
              const next = { x: event.screenX, y: event.screenY };
              if (selection !== null && !busy && pointer.current && (pointer.current.x !== next.x || pointer.current.y !== next.y)) setSelection(entry.id);
              pointer.current = next;
            }}
            onClick={() => { if (!busy) { setSelection(entry.id); void run('switch', entry); } }}
            onContextMenu={event => {
              event.preventDefault();
              if (busy) return;
              rememberCaret(); setSelection(entry.id); setMenu(true); setActionQuery(''); setActionId(''); setError('');
            }}>
            <span className="entry-icon"><Favicon pageUrl={entry.faviconPageUrl} fallback={<PanelTop size={18} />} /></span>
            <span className="entry-copy"><span className="entry-title"><HighlightedText text={entry.title} query={query} /></span><span className="entry-subtitle"><HighlightedText text={entry.subtitle} query={query} /></span></span>
          </div>)}
          {!results.length ? <div className="empty">{t('groupEmpty')}</div> : null}
        </div>
      </>}
    </div>
    {error || refreshError ? <div className="error-banner" role="alert">{error || refreshError}</div> : null}
    <PaletteFooter isMac={isMac}
      navigation={{ kind: 'back', label: `${t('back')} · ${groupLabel}`, tooltip: `${t('back')} (Esc)`, onAction: back }}
      title={groupLabel}
      context={!editor && group ? countMessage('groupTabOne', 'groupTabCount', members.length) : undefined}
      status={selection === null && !editor ? <span role="status">{t('chooseNextTab')}</span> : undefined}
      primary={primary ? { label: primary.title, keys: ['↵'], disabled: busy || !group, danger: !!primary.danger, onAction: () => void run(primary.id) } : undefined}
      actions={{ open: menu, disabled: busy || !group, onToggle: toggleMenu }} />
    {menu ? <ActionMenu id="group-actions" title={editor ? t(editor === 'name' ? 'groupRename' : 'groupColor') : group?.title} actions={actions} query={actionQuery} onQueryChange={setActionQuery}
      selectedId={chosen?.id} onSelectionChange={setActionId} onAction={id => void run(id)} onClose={() => setMenu(false)} isMac={isMac} /> : null}
  </>;
  return <BackLayer onBack={onBack}><section className="palette group-view" aria-label={groupLabel} aria-busy={busy} onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || menu) return;
    const mod = isMac ? event.metaKey : event.ctrlKey;
    if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') { event.preventDefault(); toggleMenu(); return; }
    if (busy) return;
    const arrow = event.key === 'ArrowDown' || event.key === 'ArrowUp';
    const emacs = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && ['n', 'p'].includes(event.key.toLowerCase());
    if (!editor && !event.shiftKey && (arrow || emacs || ['PageDown', 'PageUp'].includes(event.key))) {
      event.preventDefault();
      if (!results.length) return;
      const index = results.findIndex(entry => entry.id === selected?.id);
      const down = event.key === 'ArrowDown' || event.key === 'PageDown' || event.key.toLowerCase() === 'n';
      let next = index < 0 ? (down ? 0 : results.length - 1) : (index + (down ? 1 : -1) + results.length) % results.length;
      if (arrow && mod) next = down ? results.length - 1 : 0;
      else if (event.altKey || event.key.startsWith('Page')) next = Math.max(0, Math.min(results.length - 1, index + (down ? 1 : -1) * 6));
      setSelection(results[next].id);
    } else if (event.key === 'Enter' && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && (event.target as HTMLElement).tagName !== 'BUTTON' && (event.target as HTMLElement).tagName !== 'SELECT') {
      event.preventDefault(); if (primary) void run(primary.id);
    }
  }}>{editor ? <BackLayer onBack={() => setEditor(undefined)}>{body}</BackLayer> : body}</section></BackLayer>;
}
