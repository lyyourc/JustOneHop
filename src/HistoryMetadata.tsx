import { t } from './i18n';
import { formatVisitTime } from './visitTime';

export function HistoryMetadata({ lastVisitTime, showKind = false }: { lastVisitTime?: number; showKind?: boolean }) {
  const time = formatVisitTime(lastVisitTime, t('languageTag'));
  return <span className={`history-metadata kind-label ${time ? 'has-time' : ''}`}>
    {showKind ? <span className="history-kind">{t('historyKind')}{time ? <span aria-hidden="true"> · </span> : null}</span> : null}
    {time ? <time dateTime={time.dateTime} title={t('historyLastVisited', time.full)} aria-label={t('historyLastVisited', time.full)}>{time.text}</time> : null}
  </span>;
}
