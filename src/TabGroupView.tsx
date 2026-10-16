import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Layers, PanelTop } from 'lucide-react';
import { BackLayer } from './Navigation';
import { PaletteFooter } from './PaletteFooter';
import { ActionMenu } from './ActionMenu';
import { Favicon } from './Favicon';
import { HighlightedText } from './HighlightedText';
import { entries, search } from './model';
import { execute } from './api';
import { errorMessage, t, countMessage, type MessageKey } from './i18n';
import type { Snapshot } from './types';

const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] as const;
export function TabGroupView({ groupId, data, isMac, onBack, onClose, onRefresh }: {
  groupId: number; data: Snapshot; isMac: boolean; onBack: () => void; onClose: () => void; onRefresh: () => Promise<void>;
}) {
  const group = data.groups?.find(group => group.id === groupId);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState('');
  const [menu, setMenu] = useState(false);
  const [actionQuery, setActionQuery] = useState('');
  const [actionId, setActionId] = useState('');
  const [editor, setEditor] = useState<'name' | 'color'>();
  const [name, setName] = useState('');
  const [color, setColor] = useState<chrome.tabGroups.TabGroup['color']>('grey');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const colorInput = useRef<HTMLSelectElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const members = entries({ ...data, groups: [], bookmarks: [], tabs: data.tabs.filter(tab => tab.groupId === groupId) }).filter(entry => entry.kind === 'tab');
  const results = search(members, query);
  const selected = results.find(entry => entry.id === selection) || results[0];
  const allActions = editor ? [{ id: 'save', title: t('groupSave') }] : [
    ...(selected ? [{ id: 'switch', title: t('switchTabPrimary') }, { id: 'ungroupTab', title: t('groupRemoveTab') }, { id: 'close', title: t('closeTab'), danger: true }] : []),
    ...(group ? [{ id: 'collapse', title: t(group.collapsed ? 'groupExpand' : 'groupCollapse') }, { id: 'name', title: t('groupRename') }, { id: 'color', title: t('groupColor') }] : []),
  ];
  const actions = allActions.filter(action => action.title.toLocaleLowerCase().includes(actionQuery.toLocaleLowerCase()));
  const chosen = actions.find(action => action.id === actionId) || actions[0];
  useLayoutEffect(() => {
    if (menu) return;
    if (editor === 'name') { nameInput.current?.focus(); nameInput.current?.select(); }
    else if (editor === 'color') colorInput.current?.focus();
    else input.current?.focus();
  }, [menu, editor]);
  useLayoutEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selected?.id]);
  function toggleMenu() { if (!busy) { setMenu(!menu); setActionQuery(''); setActionId(''); } }
  async function run(id: string) {
    if (busy || !group) return;
    if (id === 'name' || id === 'color') { setName(group.title); setColor(group.color); setEditor(id); setMenu(false); setError(''); return; }
    setBusy(true); setError('');
    try {
      if (id === 'save') {
        await execute({ action: 'updateGroup', windowId: data.windowId, groupId, groupChanges: editor === 'name' ? { title: name.trim() } : { color } });
      } else if (id === 'collapse') {
        await execute({ action: 'updateGroup', windowId: data.windowId, groupId, groupChanges: { collapsed: !group.collapsed } });
      } else if (selected && (id === 'switch' || id === 'close' || id === 'ungroupTab')) {
        await execute({ action: id, windowId: data.windowId, groupId, tabId: selected.tabId });
        if (id === 'switch' || (id === 'close' && selected.tabId === data.currentTabId)) { onClose(); return; }
      } else return;
      await onRefresh(); setMenu(false); setEditor(undefined);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }
  const primary = menu ? chosen : editor ? { id: 'save', title: t('groupSave') } : selected ? { id: 'switch', title: t('switchTabPrimary') } : undefined;
  const body = <>
    <header className="settings-header"><button className="settings-back" aria-label={t('back')} onClick={() => editor ? setEditor(undefined) : onBack()}><ArrowLeft size={18} /></button>
      <h1><Layers size={18} data-color={group?.color} /> {editor ? t(editor === 'name' ? 'groupRename' : 'groupColor') : `${t('categoryTabGroup')}: ${group?.title || t('unnamedGroup')}`}</h1><kbd>esc</kbd></header>
    <div className="group-surface" inert={menu ? true : undefined}>
      {!group ? <p className="empty">{t('groupMissing')}</p> : editor ? <div className="settings-body">
        {editor === 'name' ? <label className="group-field">{t('groupName')}<input ref={nameInput} value={name} onChange={event => setName(event.target.value)} disabled={busy} /></label>
          : <label className="group-field">{t('groupColor')}<select aria-label={t('groupColor')} ref={colorInput} value={color} onChange={event => setColor(event.target.value as chrome.tabGroups.TabGroup['color'])} disabled={busy}>
            {colors.map(value => <option key={value} value={value}>{t(`color${value[0].toUpperCase()}${value.slice(1)}` as MessageKey)}</option>)}
          </select></label>}
      </div> : <>
        <div className="search-bar"><input ref={input} data-back-on-empty value={query} onChange={event => { setQuery(event.target.value); setSelection(''); }}
          placeholder={t('groupSearch')} aria-label={t('groupSearch')} role="combobox" aria-expanded="true" aria-controls="zing-group-tabs" aria-activedescendant={selected ? `group-${selected.id}` : undefined} disabled={busy} /></div>
        <div ref={list} className="results" id="zing-group-tabs" role="listbox" aria-label={t('resultsLabel')}>
          {results.map(entry => <div key={entry.id} id={`group-${entry.id}`} role="option" aria-selected={entry.id === selected?.id} className="result tab"
            onMouseMove={event => { if (event.movementX || event.movementY) setSelection(entry.id); }} onClick={() => { if (!busy) { setSelection(entry.id); void execute({ action: 'switch', groupId, tabId: entry.tabId, windowId: data.windowId }).then(onClose).catch(reason => setError(errorMessage(reason))); } }}>
            <span className="entry-icon"><Favicon pageUrl={entry.faviconPageUrl} fallback={<PanelTop size={18} />} /></span>
            <span className="entry-copy"><span className="entry-title"><HighlightedText text={entry.title} query={query} /></span><span className="entry-subtitle"><HighlightedText text={entry.subtitle} query={query} /></span></span>
          </div>)}
          {!results.length ? <div className="empty">{t('groupEmpty')}</div> : null}
        </div>
      </>}
    </div>
    {error ? <div className="error-banner" role="alert">{error}</div> : null}
    <PaletteFooter isMac={isMac} status={!editor && group ? countMessage('groupTabOne', 'groupTabCount', members.length) : undefined}
      primary={primary ? { label: primary.title, keys: ['↵'], disabled: busy || !group, onAction: () => void run(primary.id) } : undefined}
      actions={{ open: menu, disabled: busy || !group, onToggle: toggleMenu }} />
    {menu ? <ActionMenu id="group-actions" title={editor ? t(editor === 'name' ? 'groupRename' : 'groupColor') : group?.title} actions={actions} query={actionQuery} onQueryChange={setActionQuery}
      selectedId={chosen?.id} onSelectionChange={setActionId} onAction={id => void run(id)} onClose={() => setMenu(false)} isMac={isMac} /> : null}
  </>;
  return <BackLayer onBack={onBack}><section className="palette group-view" aria-busy={busy} onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || menu) return;
    if ((isMac ? event.metaKey : event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') { event.preventDefault(); toggleMenu(); return; }
    if (busy) return;
    const down = event.key === 'ArrowDown' || (event.ctrlKey && event.key.toLowerCase() === 'n');
    const up = event.key === 'ArrowUp' || (event.ctrlKey && event.key.toLowerCase() === 'p');
    if (!editor && !event.metaKey && !event.altKey && !event.shiftKey && (down || up)) {
      event.preventDefault(); const index = results.findIndex(entry => entry.id === selected?.id);
      if (results.length) setSelection(results[(index + (down ? 1 : -1) + results.length) % results.length].id);
    } else if (event.key === 'Enter' && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && (event.target as HTMLElement).tagName !== 'BUTTON' && (event.target as HTMLElement).tagName !== 'SELECT') {
      event.preventDefault(); if (primary) void run(primary.id);
    }
  }}>{editor ? <BackLayer onBack={() => setEditor(undefined)}>{body}</BackLayer> : body}</section></BackLayer>;
}
