import { t } from './i18n';
import { ReadOnlyPreview } from './ReadOnlyPreview';
import type { SavedScript } from './scripts';

export function ScriptPreview({ script }: { script?: SavedScript }) {
  return <ReadOnlyPreview className="script-preview" label={t('scriptPreview')}
    content={script ? { id: script.id, value: script.code, label: t('scriptCode') } : undefined}
    information={script ? [
      { label: t('scriptName'), value: script.title },
      { label: t('scriptContentType'), value: 'JavaScript' },
    ] : []} emptyLabel={t('scriptPreviewEmpty')} />;
}
