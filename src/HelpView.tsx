import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { t } from './i18n';
import { BackLayer, useNavigateBack } from './Navigation';
import { PaletteFooter } from './PaletteFooter';
import { SearchFocusButton } from './SearchFocusButton';
import { SearchDismissButton } from './SearchDismissButton';
import { HighlightedText } from './HighlightedText';
import { matchingHelp } from './helpSearch';
import { describeShortcut } from './Shortcut';

export function HelpView({ onBack, shortcut, standalone = false }: { onBack: () => void; shortcut: string; standalone?: boolean }) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const article = useRef<HTMLElement>(null);
  const navigateBack = useNavigateBack();
  const backLabel = t(standalone ? 'closeHelp' : 'back');
  const shortcutLabel = shortcut ? `${shortcut} (${describeShortcut(shortcut)})` : t('notAssigned');
  const sections = matchingHelp(query, shortcutLabel);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { article.current?.scrollTo({ top: 0 }); }, [query]);
  function clearSearch() { setQuery(''); input.current?.focus(); }

  return <BackLayer onBack={onBack} closes={standalone}><section tabIndex={-1} className="palette help-view" aria-label={t('help')} onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.key !== 'Tab') return;
    event.preventDefault(); event.stopPropagation();
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input, button:not(:disabled), article[tabindex]'));
    const at = controls.indexOf(event.target as HTMLElement);
    controls[(at + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
  }}>
    <header className="search-bar help-search">
      <SearchFocusButton input={input} />
      <input ref={input} data-back-on-empty value={query} onChange={event => setQuery(event.target.value)}
        aria-label={t('searchHelp')} placeholder={t('searchHelpPlaceholder')} aria-controls="zing-help-content"
        autoComplete="off" spellCheck={false} />
      {query ? <button className="settings-clear" aria-label={t('clearSettingsSearch')} title={t('clearSettingsSearch')}
        onClick={clearSearch}><X size={16} /></button> : null}
      <SearchDismissButton label={backLabel} />
    </header>
    <article ref={article} id="zing-help-content" className={`help-body ${query.trim() ? 'filtered' : ''}`} tabIndex={0} aria-label={t('help')} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.target !== event.currentTarget) return;
      const node = event.currentTarget;
      const distance = ({ ArrowDown: 40, ArrowUp: -40, PageDown: node.clientHeight * .8, PageUp: -node.clientHeight * .8 } as Record<string, number>)[event.key];
      if (distance !== undefined) { event.preventDefault(); event.stopPropagation(); node.scrollBy({ top: distance }); }
      else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault(); event.stopPropagation(); node.scrollTo({ top: event.key === 'Home' ? 0 : node.scrollHeight });
      }
    }}>
      {!query.trim() ? <p className="help-intro">{t('helpIntro')}</p> : null}
      <span className="sr-only" role="status">{t('helpSectionCount', String(sections.length))}</span>
      {sections.map(section => <section key={section.title}>
        <h2><HighlightedText text={t(section.title)} query={query} allowTypos={false} /></h2>
        {section.paragraphs.map(key => <p key={key}><HighlightedText text={t(key, key === 'helpStartBody' ? shortcutLabel : undefined)} query={query} allowTypos={false} /></p>)}
      </section>)}
      {!sections.length ? <div className="empty"><Search size={26} /><strong>{t('noResults')}</strong>
        <button className="ranking-reset" onClick={clearSearch}>{t('clearSettingsSearch')}</button></div> : null}
    </article>
    <PaletteFooter navigation={standalone ? undefined : { kind: 'back', label: backLabel, tooltip: `${backLabel} (Esc)`, onAction: navigateBack }}
      title={t('help')} primary={standalone ? { label: backLabel, keys: ['esc'], onAction: navigateBack } : undefined} />
  </section></BackLayer>;
}
