import { t } from './i18n';

export function ReadOnlyPreview({ className, label, content, information, emptyLabel }: {
  className: string; label: string; content?: { id: string; value: string; label: string; placeholder?: string };
  information: { label: string; value: string }[]; emptyLabel?: string;
}) {
  return <section className={`read-only-preview ${className}`} aria-label={label}>
    {content ? <>
      <textarea key={content.id} className="preview-code" aria-label={content.label} value={content.value}
        placeholder={content.placeholder} readOnly wrap="off" spellCheck={false} />
      <div className="preview-info" tabIndex={information.length > 2 ? 0 : undefined} aria-label={t('previewInformation')}>
        <h2>{t('previewInformation')}</h2>
        <dl>{information.map(item => <div key={item.label}><dt>{item.label}</dt><dd title={item.value}>{item.value}</dd></div>)}</dl>
      </div>
    </> : <p className="empty">{emptyLabel}</p>}
  </section>;
}
