import type { Ref } from 'react';
import { SearchIcon } from './SearchIcon';
import { useNavigateBack } from './Navigation';
import { t } from './i18n';

export function TaskHeader({ buttonRef }: { buttonRef?: Ref<HTMLButtonElement> }) {
  const back = useNavigateBack();
  return <header className="task-header">
    <button ref={buttonRef} type="button" className="task-back is-back" aria-label={t('back')} title={`${t('back')} · Esc`} aria-keyshortcuts="Escape"
      onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.keyCode === 229 || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) event.preventDefault();
      }} onClick={back}><SearchIcon size={20} /></button>
  </header>;
}
