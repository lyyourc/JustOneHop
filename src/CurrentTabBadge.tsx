import { t } from './i18n';

export function CurrentTabBadge({ current }: { current: boolean }) {
  return current ? <span className="current-badge">{t('current')}</span> : null;
}
