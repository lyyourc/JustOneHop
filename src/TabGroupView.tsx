import { useLayoutEffect, useRef, useState } from 'react';
import { useResultSelection } from './useResultSelection';
import { keepsPaletteOpen } from './paletteActions';
import { Layers, PanelTop, Save, X } from 'lucide-react';
import { groupActions } from './groupActions';
import { GroupConfirmation } from './GroupConfirmation';
import { BackLayer } from './Navigation';
import { SearchFocusButton } from './SearchFocusButton';
import { SearchDismissButton } from './SearchDismissButton';
import { PaletteFooter } from './PaletteFooter';
import { ActionMenu } from './ActionMenu';
import { Favicon } from './Favicon';
import { CurrentTabBadge } from './CurrentTabBadge';
import { HighlightedText } from './HighlightedText';
import { bookmarkTabAction, entries, search } from './model';
import { BookmarkConfirmation, type BookmarkRemoval } from './BookmarkConfirmation';
import { EntryGlyph } from './SearchResultItem';
import { t, countMessage } from './i18n';
import { useOperationFeedback } from './OperationFeedback';
import type { Snapshot, Entry, Execution, ExecutionOutcome, PaletteState } from './types';

export function TabGroupView({ groupId, data, isMac, onBack, onClose, onExecute, executionBusy, refreshError, paletteState, initialState, initialEditor }: {
  groupId: number; data: Snapshot; isMac: boolean; onBack: () => void; onClose: () => void; executionBusy: boolean; refreshError: string;
  onExecute: (execution: Execution) => Promise<ExecutionOutcome | undefined>; paletteState: PaletteState; initialState?: PaletteState['group']; initialEditor?: 'name';
}) {
  const group = data.groups?.find(group => group.id === groupId);
  const [query, setQuery] = useState(initialState?.id === groupId ? initialState.query : '');
  const [menu, setMenu] = useState(false);
  const [actionQuery, setActionQuery] = useState('');
  const [actionId, setActionId] = useState('');
  const [editor, setEditor] = useState<'name' | undefined>(initialEditor);
  const [name, setName] = useState(group?.title || '');
  const [groupRemoval, setGroupRemoval] = useState<Entry | null>(null);
  const [localBusy, setBusy] = useState(false);
  const busy = localBusy || executionBusy;
  const feedback = useOperationFeedback();
  const executing = useRef(false);
  const [bookmarkRemoval, setBookmarkRemoval] = useState<BookmarkRemoval | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<[number, number]>(initialState?.id === groupId ? initialState.caret : [0, 0]);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const members = entries({ ...data, groups: [], bookmarks: [], tabs: data.tabs.filter(tab => tab.groupId === groupId) }).filter(entry => entry.kind === 'tab');
  const results = search(members, query);
  const { selected, selection, setSelection } = useResultSelection(results, query, data.currentTabId,
    initialState?.id === groupId ? initialState.selection : '');
  const bookmarkAction = bookmarkTabAction(data.tabs.find(tab => tab.id === selected?.tabId), data.bookmarks);
  const allActions: { id: string; title: string; keywords: string; icon: React.ReactNode; danger?: boolean }[] = editor ? [{ id: 'save', title: t('groupSave'), keywords: 'save 保存', icon: <Save size={16} /> }] : [
    ...(selected ? [
      { id: 'switch', title: t('switchTabPrimary'), keywords: 'switch tab 切换标签页', icon: <PanelTop size={16} /> },
      ...(bookmarkAction ? [{ id: bookmarkAction.action, title: bookmarkAction.title, keywords: [bookmarkAction.keywords, ...(bookmarkAction.aliases || [])].join(' '), icon: <EntryGlyph name="bookmark" size={16} />, danger: bookmarkAction.danger }] : []),
      { id: 'ungroupTab', title: t('groupRemoveTab'), keywords: 'remove ungroup tab 移出 取消分组', icon: <Layers size={16} /> },
      { id: 'close', title: t('closeTab'), keywords: 'close tab 关闭标签页', icon: <X size={16} />, danger: true },
    ] : []),
    ...(group ? groupActions(group).map(action => ({ id: action.action, title: action.title, keywords: action.keywords, icon: <EntryGlyph name={action.icon} size={16} />, danger: action.danger })) : []),
  ];
  const actions = allActions.filter(action => `${action.title} ${action.keywords}`.toLocaleLowerCase().includes(actionQuery.trim().toLocaleLowerCase()));
  const chosen = actions.find(action => action.id === actionId) || actions[0];
  useLayoutEffect(() => {
    if (menu || busy || bookmarkRemoval || groupRemoval) return;
    if (editor === 'name') { nameInput.current?.focus(); nameInput.current?.select(); }
    else { input.current?.focus(); input.current?.setSelectionRange(...caret.current); }
  }, [menu, editor, busy, bookmarkRemoval, groupRemoval]);
  useLayoutEffect(() => {
    if (!editor && !menu) list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected?.id, editor, menu]);
  function rememberCaret() {
    if (!menu && !editor) caret.current = [input.current?.selectionStart ?? query.length, input.current?.selectionEnd ?? query.length];
  }
  function toggleMenu() {
    if (!busy) { rememberCaret(); setMenu(!menu); setActionQuery(''); setActionId(''); }
  }
  /** The footer breadcrumb mirrors Escape: it leaves exactly the deepest layer. */
  function back() {
    if (groupRemoval) { setGroupRemoval(null); return; }
    if (bookmarkRemoval) { setBookmarkRemoval(null); return; }
    if (menu) { setMenu(false); return; }
    if (editor) { if (initialEditor) onBack(); else setEditor(undefined); return; }
    onBack();
  }
  async function run(id: string, target: Entry | undefined = selected, confirmed?: Entry) {
    if (busy || executing.current || !group || ((bookmarkRemoval || groupRemoval) && !confirmed)) return;
    if (id === 'closeGroup' && !confirmed) {
      rememberCaret();
      setGroupRemoval({ ...groupActions(group).find(action => action.action === id)!, groupTabIds: members.map(tab => tab.tabId!) });
      return;
    }
    const bookmark = confirmed?.action === 'unbookmarkTab' ? confirmed : bookmarkAction?.action === id ? bookmarkAction : undefined;
    if (bookmark && !confirmed && id === 'unbookmarkTab') {
      const bookmarks = data.bookmarks.filter(item => bookmark.bookmarkIds?.includes(item.id));
      if (bookmarks.some(item => item.unmodifiable)) { feedback.error(feedback.begin(t('running')), t('errorBookmarkManaged')); return; }
      if (bookmarks.length > 1) {
        rememberCaret();
        setBookmarkRemoval({ entry: { ...bookmark, bookmarkIds: [...bookmark.bookmarkIds!] }, bookmarks });
        return;
      }
    }
    if (confirmed) { setBookmarkRemoval(null); setGroupRemoval(null); }
    if (id === 'renameGroup') { rememberCaret(); setName(group.title); setEditor('name'); setMenu(false); return; }
    rememberCaret();
    let execution: Execution;
    let message: string;
    let after = () => { setMenu(false); setEditor(undefined); };
    if (bookmark && (id === 'bookmarkTab' || id === 'unbookmarkTab')) {
      execution = { action: id, windowId: data.windowId, groupId, tabId: bookmark.tabId,
        expectedUrl: bookmark.expectedUrl, bookmarkIds: bookmark.bookmarkIds };
      message = t(id === 'bookmarkTab' ? 'tabBookmarked' : 'tabUnbookmarked');
    } else if (id === 'save') {
      execution = { action: 'updateGroup', windowId: data.windowId, groupId, groupChanges: { title: name.trim() } };
      message = t('groupRenamed');
      if (initialEditor) after = onBack;
    } else if (id === 'ungroupGroup' || id === 'closeGroup') {
      execution = { action: id, windowId: data.windowId, groupId, groupTabIds: confirmed?.groupTabIds };
      message = t(id === 'ungroupGroup' ? 'groupUngrouped' : 'groupClosed');
      after = onBack;
    } else if (id === 'updateGroup') {
      execution = { action: 'updateGroup', windowId: data.windowId, groupId, groupChanges: { collapsed: !group.collapsed } };
      message = t(group.collapsed ? 'groupExpanded' : 'groupCollapsed');
    } else if (target && (id === 'switch' || id === 'close' || id === 'ungroupTab')) {
      const keep = keepsPaletteOpen(id, target.tabId, data.currentTabId);
      execution = { action: id, windowId: data.windowId, groupId, tabId: target.tabId,
        ...(keep && id === 'close' ? { paletteState: { ...paletteState, group: { id: groupId, query, selection, caret: caret.current } } } : {}) };
      message = t(id === 'close' ? 'tabClosed' : id === 'ungroupTab' ? 'tabUngrouped' : 'actionCompleted');
      if (!keep) after = onClose;
    } else return;
    executing.current = true; setBusy(true);
    try {
      const result = await feedback.run(() => onExecute(execution), outcome => outcome?.message || message);
      if (result.ok) after();
    } finally { executing.current = false; setBusy(false); }
  }
  const primary: { id: string; title: string; danger?: boolean } | undefined = menu ? chosen : editor ? { id: 'save', title: t('groupSave') } : selected ? { id: 'switch', title: t('switchTabPrimary') } : undefined;
  const groupLabel = `${t('categoryTabGroup')}: ${group?.title || t('unnamedGroup')}`;
  const body = <>
    <div className="group-surface" inert={menu || bookmarkRemoval || groupRemoval ? true : undefined}>
      {!group ? <p className="empty">{t('groupMissing')}</p> : editor ? <div className="settings-body">
        <h2>{t('groupRename')}</h2>
        <label className="group-field">{t('groupName')}<input ref={nameInput} value={name} onChange={event => setName(event.target.value)} disabled={busy} /></label>
      </div> : <>
        <div className="search-bar"><SearchFocusButton input={input} disabled={busy} /><input ref={input} data-back-on-empty value={query} onChange={event => { setQuery(event.target.value); setSelection(''); }}
          placeholder={t('groupSearch')} aria-label={t('groupSearch')} role="combobox" aria-expanded="true" aria-controls="justonehop-group-tabs" aria-activedescendant={selected ? `group-${selected.id}` : undefined} disabled={busy} />
          <SearchDismissButton label={t('back')} /></div>
        <div ref={list} className="results" id="justonehop-group-tabs" role="listbox" aria-label={t('resultsLabel')}>
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
              rememberCaret(); setSelection(entry.id); setMenu(true); setActionQuery(''); setActionId('');
            }}>
            <span className="entry-icon"><Favicon pageUrl={entry.faviconPageUrl} fallback={<PanelTop size={18} />} /></span>
            <span className="entry-copy"><span className="entry-title"><HighlightedText text={entry.title} query={query} /></span><span className="entry-subtitle"><HighlightedText text={entry.subtitle} query={query} /></span></span>
            <CurrentTabBadge current={!!entry.active} />
          </div>)}
          {!results.length ? <div className="empty">{t('groupEmpty')}</div> : null}
        </div>
      </>}
    </div>
    {refreshError ? <div className="error-banner" role="alert">{refreshError}</div> : null}
    <PaletteFooter isMac={isMac}
      navigation={{ kind: 'back', label: `${t('back')} · ${groupLabel}`, tooltip: `${t('back')} (Esc)`, onAction: back }}
      title={groupLabel}
      context={!editor && group ? countMessage('groupTabOne', 'groupTabCount', members.length) : undefined}
      status={selection === null && !editor ? <span role="status">{t('chooseNextTab')}</span> : undefined}
      primary={primary ? { label: primary.title, keys: ['↵'], disabled: busy || !group || !!bookmarkRemoval || !!groupRemoval, danger: !!primary.danger, onAction: () => void run(primary.id) } : undefined}
      actions={{ open: menu, disabled: busy || !group || !!bookmarkRemoval || !!groupRemoval, onToggle: toggleMenu }} />
    {groupRemoval ? <GroupConfirmation target={groupRemoval} onCancel={() => setGroupRemoval(null)} onConfirm={() => void run('closeGroup', undefined, groupRemoval)} /> : bookmarkRemoval ? <BookmarkConfirmation target={bookmarkRemoval} onCancel={() => setBookmarkRemoval(null)}
      onConfirm={() => void run('unbookmarkTab', undefined, bookmarkRemoval.entry)} /> : menu ? <ActionMenu id="group-actions" title={editor ? t('groupRename') : group?.title} actions={actions} query={actionQuery} onQueryChange={setActionQuery}
      selectedId={chosen?.id} onSelectionChange={setActionId} onAction={id => void run(id)} onClose={() => setMenu(false)} isMac={isMac} /> : null}
  </>;
  return <BackLayer onBack={onBack}><section className="palette group-view" aria-label={groupLabel} aria-busy={busy} onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || menu || bookmarkRemoval || groupRemoval) return;
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
  }}>{editor ? <BackLayer onBack={() => { if (initialEditor) onBack(); else setEditor(undefined); }}>{body}</BackLayer> : body}</section></BackLayer>;
}
