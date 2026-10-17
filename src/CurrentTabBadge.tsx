import { t } from './i18n';

export function CurrentTabBadge({ current }: { current: boolean }) {
  return current ? <span className="current-badge kind-label">{t('current')}</span> : null;
}
