import { t } from './i18n';
import type { SavedScript } from './scripts';

export function ScriptPreview({ script }: { script?: SavedScript }) {
  return <section className="script-preview" aria-label={t('scriptPreview')}>
    {script ? <>
      <textarea key={script.id} className="script-preview-code" aria-label={t('scriptCode')} value={script.code} readOnly wrap="off" spellCheck={false} />
      <div className="script-preview-info">
        <h2>{t('scriptInformation')}</h2>
        <dl>
          <div><dt>{t('scriptName')}</dt><dd title={script.title}>{script.title}</dd></div>
          <div><dt>{t('scriptContentType')}</dt><dd>JavaScript</dd></div>
        </dl>
      </div>
    </> : <p className="empty">{t('scriptPreviewEmpty')}</p>}
  </section>;
}
