import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, RotateCcw, X } from 'lucide-react';
import { BackLayer, useNavigateBack } from './Navigation';
import { PaletteFooter } from './PaletteFooter';
import { ActionMenu } from './ActionMenu';
import { execute } from './api';
import { errorMessage, t } from './i18n';
import type { TuckRecoveryItem } from './types';

export function TuckRecoveryView({ item, windowId, isMac, onBack, onComplete }: {
  item?: TuckRecoveryItem; windowId: number; isMac: boolean; onBack: () => void; onComplete: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<number>();
  const [menu, setMenu] = useState(false);
  const [query, setQuery] = useState('');
  const [actionId, setActionId] = useState('resume');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const back = useNavigateBack();
  const surface = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const candidates = item?.candidates.filter(group => group.windowId === windowId) || [];
  const selected = candidates.find(group => group.id === selectedId) || candidates[0];
  const actions: { id: string; title: string; keywords: string; icon: React.ReactNode; danger?: boolean }[] = [
    ...(selected ? [{ id: 'resume', title: t('resumeTuck'), keywords: 'resume continue 恢复 继续管理', icon: <RotateCcw size={16} /> }] : []),
    ...(item ? [{ id: 'forget', title: t('forgetTuckRecovery'), keywords: 'stop forget delete 停止 放弃 删除', icon: <X size={16} />, danger: true }] : []),
    { id: 'back', title: t('tuckRecoveryLater'), keywords: 'later back 稍后 返回', icon: <ArrowLeft size={16} /> },
  ].filter(action => !query || `${action.title} ${action.keywords}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const action: { id: string; title: string; danger?: boolean } | undefined = menu ? actions.find(action => action.id === actionId) || actions[0]
    : { id: selected ? 'resume' : 'back', title: selected ? t('resumeTuck') : t('tuckRecoveryLater') };
  useLayoutEffect(() => {
    if (!menu) (selected ? list.current : surface.current?.querySelector<HTMLButtonElement>('.footer-back'))?.focus();
  }, [menu, selected?.id]);
  useLayoutEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selected?.id]);
  function toggleMenu() { if (!busy) { setMenu(!menu); setQuery(''); setActionId(selected ? 'resume' : 'back'); } }
  async function run(id: string) {
    if (busy) return;
    if (id === 'back') { onBack(); return; }
    if (!item || (id === 'resume' && !selected)) return;
    setBusy(true); setError('');
    try {
      await execute({ action: id === 'resume' ? 'resumeTuck' : 'forgetTuckRecovery', windowId, recoveryId: item.id,
        groupId: selected?.id, fingerprint: selected?.fingerprint });
      await onComplete();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }
  return <BackLayer onBack={onBack}><section ref={surface} className="palette settings-view tuck-recovery" aria-label={t('reviewTuck')} aria-busy={busy}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229 || menu) return;
      const mod = isMac ? event.metaKey : event.ctrlKey;
      if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') { event.preventDefault(); toggleMenu(); return; }
      if (busy) return;
      const emacs = event.ctrlKey && !event.metaKey && !event.altKey && ['n', 'p'].includes(event.key.toLowerCase());
      if (!event.shiftKey && ((!event.metaKey && !event.ctrlKey && !event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) || emacs)) {
        event.preventDefault();
        if (!candidates.length) return;
        const index = candidates.findIndex(group => group.id === selected?.id);
        const down = event.key === 'ArrowDown' || event.key.toLowerCase() === 'n';
        setSelectedId(candidates[(index + (down ? 1 : -1) + candidates.length) % candidates.length].id);
        list.current?.focus();
      } else if (event.key === 'Enter' && (event.target as HTMLElement).tagName !== 'BUTTON') {
        event.preventDefault();
        // Reviewing a candidate never confirms ownership. Tab to the footer or
        // open its action menu to explicitly resume management.
      }
    }}>
    <div className="settings-body" inert={menu ? true : undefined}>
      <p className="recovery-explanation">{item ? t('tuckRecoveryHint') : t('tuckRecoveryResolved')}</p>
      {item ? <p className="setting-note">{item.title} — {item.urls.join(' · ')}</p> : null}
      {item && !candidates.length ? <p>{t('tuckRecoveryMissing')}</p> : null}
      <div ref={list} role="listbox" aria-label={t('tuckRecoveryGroups')} tabIndex={0} aria-activedescendant={selected ? `recover-group-${selected.id}` : undefined}>
        {candidates.map(group => <div id={`recover-group-${group.id}`} key={group.id} role="option" aria-selected={group.id === selected?.id}
          className={`recovery-candidate ${group.id === selected?.id ? 'selected' : ''}`} onClick={() => { setSelectedId(group.id); list.current?.focus(); }}
          onContextMenu={event => {
            event.preventDefault();
            if (busy) return;
            setSelectedId(group.id); setMenu(true); setQuery(''); setActionId('resume');
          }}>
          <strong>{group.title || `${t('tuckGroupTitle')} · ${group.tabs.length}`}</strong>
          <ul>{group.tabs.map(tab => <li key={tab.id}><span>{tab.title}</span><small>{tab.url}</small></li>)}</ul>
        </div>)}
      </div>
      <p className="setting-note">{t('tuckRecoveryForgetHint')}</p>
    </div>
    {error ? <div className="error-banner" role="alert">{error}</div> : null}
    <PaletteFooter isMac={isMac}
      navigation={{ kind: 'back', label: `${t('back')} · ${t('reviewTuck')}`, tooltip: `${t('back')} (Esc)`, onAction: back }}
      title={t('reviewTuck')} context={item?.title}
      primary={{ label: action?.title || t('runCommand'), keys: ['↵'], disabled: busy || !action, danger: !!action?.danger, onAction: () => void run(action?.id || 'back') }}
      actions={{ open: menu, disabled: busy, onToggle: toggleMenu }} />
    {menu ? <ActionMenu id="tuck-recovery-actions" title={t('reviewTuck')} actions={actions} query={query} onQueryChange={setQuery}
      selectedId={action?.id} onSelectionChange={setActionId} onAction={id => void run(id)} onClose={() => setMenu(false)} isMac={isMac} /> : null}
  </section></BackLayer>;
}
