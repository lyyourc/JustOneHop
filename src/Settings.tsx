import { BackLayer, useNavigateBack } from './Navigation';
import { SearchDismissButton } from './SearchDismissButton';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, ExternalLink, FlaskConical, Keyboard, Search, SlidersHorizontal, X } from 'lucide-react';
import { HighlightedText } from './HighlightedText';
import { matchingSettings, type SettingRow } from './settingsSearch';
import { PaletteFooter } from './PaletteFooter';
import { describeShortcut } from './Shortcut';
import type { SettingsSection } from './types';
import { ScriptLibrary } from './ScriptLibrary';
import { systemLanguage, t } from './i18n';
import { savePreferences, type Preferences } from './preferences';
import { openShortcuts, resetSearchRanking } from './api';

function Choice<T extends string>({ label, value, options, onChange, query }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; query: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const [menuHeight, setMenuHeight] = useState(114);
  const [index, setIndex] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const selected = options.findIndex(option => option.value === value);
  useLayoutEffect(() => {
    if (!open || !container.current) return;
    const box = container.current.getBoundingClientRect();
    const body = container.current.closest('.settings-body')!.getBoundingClientRect();
    const belowSpace = body.bottom - box.bottom;
    const aboveSpace = box.top - body.top;
    const menu = container.current.querySelector<HTMLElement>('.choice-menu');
    const desiredHeight = (menu?.scrollHeight ?? 114) + 8;
    const upwards = belowSpace < desiredHeight && aboveSpace > belowSpace;
    setAbove(upwards);
    setMenuHeight(Math.max(40, (upwards ? aboveSpace : belowSpace) - 8));
  }, [open]);
  useLayoutEffect(() => {
    if (open) container.current?.querySelectorAll('.choice-option')[index]?.scrollIntoView({ block: 'nearest' });
  }, [index, open, menuHeight]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (container.current && !event.composedPath().includes(container.current)) setOpen(false);
    };
    // The root can be a closed shadow tree inside the page overlay.
    const root = container.current!.getRootNode();
    root.addEventListener('mousedown', outside as EventListener);
    return () => root.removeEventListener('mousedown', outside as EventListener);
  }, [open]);
  function choose(at: number) { onChange(options[at].value); setOpen(false); button.current?.focus(); }
  function key(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const emacs = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && ['n', 'p'].includes(event.key.toLowerCase());
    if ((!event.shiftKey && !event.metaKey && !event.altKey && !event.ctrlKey && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) || emacs) {
      event.preventDefault(); event.stopPropagation();
      if (!open) { setOpen(true); setIndex(selected); }
      else setIndex(event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 :
        (index + (event.key === 'ArrowDown' || event.key.toLowerCase() === 'n' ? 1 : -1) + options.length) % options.length);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopPropagation();
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (open) choose(index); else { setOpen(true); setIndex(selected); }
    } else if (event.key === 'Tab') setOpen(false);
  }
  return <BackLayer active={open} onBack={() => { setOpen(false); button.current?.focus(); }}><div className="setting-choice" ref={container} onKeyDown={key}>
    <button ref={button} className="choice-trigger" role="combobox" aria-label={label}
      aria-expanded={open} aria-controls={id} aria-haspopup="listbox" aria-activedescendant={open ? `${id}-${index}` : undefined}
      onClick={() => { setOpen(!open); setIndex(selected); }}>
      <span><HighlightedText text={options[selected].label} query={query} allowTypos={false} /></span><ChevronDown size={14} />
    </button>
    {open ? <div className={`choice-menu ${above ? 'above' : ''}`} style={{ maxHeight: menuHeight, overflowY: 'auto' }} role="listbox" id={id} aria-label={label}>
      {options.map((option, at) => <div key={option.value} id={`${id}-${at}`} role="option" aria-selected={value === option.value}
        className={`choice-option ${at === index ? 'highlighted' : ''}`} onMouseMove={() => setIndex(at)}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(at)}>
        <span><HighlightedText text={option.label} query={query} allowTypos={false} /></span>{value === option.value ? <Check size={14} /> : null}
      </div>)}
    </div> : null}
  </div></BackLayer>;
}

export function Settings({ preferences, shortcut, onBack, onClose, isMac, initialSection }: {
  initialSection?: SettingsSection; preferences: Preferences; shortcut: string; onBack: () => void; onClose: () => void; isMac: boolean;
}) {
  const back = useNavigateBack();
  const [library, setLibrary] = useState<'all' | 'binding' | null>(null);
  const [error, setError] = useState(false);
  const [rankingReset, setRankingReset] = useState<'idle' | 'busy' | 'done'>('idle');
  const [tuckSaving, setTuckSaving] = useState(false);
  const tuckHint = useId();
  const tuckToggle = useId();
  const body = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const returnTo = useRef<SettingRow | undefined>(initialSection);
  const scrollTop = useRef(0);
  const [query, setQuery] = useState('');
  const matches = matchingSettings(query);
  const paletteHotkeyHelp = `${shortcut ? describeShortcut(shortcut) : t('notAssigned')} — ${t('paletteHotkey')}. ${t('hotkeyHint')}`;
  const bindingHelp = `Control + Tab (Ctrl+Tab) — ${t('bindingHint')}`;
  const highlight = (text: string) => <HighlightedText text={text} query={query} allowTypos={false} />;
  function openLibrary(mode: 'all' | 'binding') {
    returnTo.current = mode === 'all' ? 'scripts' : 'binding';
    scrollTop.current = body.current?.scrollTop ?? 0;
    setLibrary(mode);
  }
  function clearSearch() { setQuery(''); input.current?.focus(); }
  useLayoutEffect(() => {
    if (library) return;
    const target = returnTo.current && body.current?.querySelector<HTMLElement>(`[data-setting="${returnTo.current}"] button`);
    if (body.current) body.current.scrollTop = scrollTop.current;
    if (target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest' }); }
    else input.current?.focus();
  }, [library]);
  async function change(patch: Partial<Preferences>) {
    setError(false);
    try { await savePreferences(patch); } catch { setError(true); }
  }
  async function changeHotkey() {
    try { await openShortcuts(); onClose(); } catch { setError(true); }
  }
  async function toggleAutoTuck() {
    if (tuckSaving) return;
    setTuckSaving(true);
    try { await change({ autoTuck: !preferences.autoTuck }); }
    finally { setTuckSaving(false); }
  }
  async function resetRanking() {
    if (rankingReset === 'busy') return;
    setError(false); setRankingReset('busy');
    try { await resetSearchRanking(); setRankingReset('done'); }
    catch { setError(true); setRankingReset('idle'); }
  }
  return <BackLayer onBack={onBack}>{library ? <ScriptLibrary initialBinding={library === 'binding'} onBack={() => setLibrary(null)} onClose={onClose} isMac={isMac} /> : <section tabIndex={-1} className="palette settings-view settings-page" aria-label={t('settings')}>
    <header className="search-bar settings-search">
      <span className="search-icon"><Search size={20} /></span>
      <input ref={input} data-back-on-empty aria-label={t('searchSettings')} placeholder={t('searchSettingsPlaceholder')}
        value={query} onChange={event => { setQuery(event.target.value); if (body.current) body.current.scrollTop = 0; }}
        onKeyDown={event => { if (event.key === 'Enter') event.stopPropagation(); }} autoComplete="off" spellCheck={false} />
      {query ? <button className="settings-clear" title={t('clearSettingsSearch')} aria-label={t('clearSettingsSearch')}
        onClick={clearSearch}><X size={16} /></button> : null}
      <SearchDismissButton label={t('back')} />
    </header>
    <div className="settings-body" ref={body}>
      {matches.has('language') || matches.has('theme') ? <>
        <h2><SlidersHorizontal size={14} />{highlight(t('general'))}</h2>
        <div className="settings-group settings-preferences">
          {matches.has('language') ? <div data-setting="language">
            <div className="setting-row">
              <div className="setting-copy"><label>{highlight(t('language'))}</label>{preferences.language === 'system' ? <p>{highlight(t('systemLanguage', systemLanguage() === 'zh' ? '简体中文' : 'English'))}</p> : null}</div>
              <Choice query={query} label={t('language')} value={preferences.language} onChange={language => void change({ language })}
                options={[{ value: 'system', label: t('followSystem') }, { value: 'zh', label: '简体中文' }, { value: 'en', label: 'English' }]} />
            </div>
          </div> : null}
          {matches.has('theme') ? <div data-setting="theme">
            <div className="setting-row">
              <div className="setting-copy"><label>{highlight(t('theme'))}</label></div>
              <Choice query={query} label={t('theme')} value={preferences.theme} onChange={theme => void change({ theme })}
                options={[{ value: 'system', label: t('followSystem') }, { value: 'light', label: t('lightTheme') }, { value: 'dark', label: t('darkTheme') }]} />
            </div>
          </div> : null}
        </div>
      </> : null}
      {matches.has('keyboard') || matches.has('binding') ? <>
        <h2><Keyboard size={14} />{highlight(t('keyboard'))}</h2>
        <div className="settings-group settings-keyboard">
          {matches.has('keyboard') ? <div className="setting-row hotkey-row" data-setting="keyboard">
            <div className="setting-copy"><label>{highlight(t('paletteHotkey'))}</label></div>
            <div className="hotkey-controls"><kbd className="hotkey-value" title={paletteHotkeyHelp} aria-label={paletteHotkeyHelp}>{shortcut || t('notAssigned')}</kbd>
              <button className="hotkey-change" onClick={() => void changeHotkey()}>{highlight(t('changeHotkey'))}<ExternalLink size={12} /></button>
            </div>
          </div> : null}
          {matches.has('binding') ? <div className="setting-row" data-setting="binding"><div className="setting-copy"><label>{highlight(t('ctrlTabSetting'))}</label><p>{highlight(t('bindingHint'))}</p></div>
            <div className="hotkey-controls"><kbd className="hotkey-value" title={bindingHelp} aria-label={bindingHelp}>{highlight(isMac ? '⌃Tab' : 'Ctrl+Tab')}</kbd>
              <button className="ranking-reset" onClick={() => openLibrary('binding')}>{highlight(t('setUpShortcut'))}</button></div></div> : null}
        </div>
      </> : null}
      {matches.has('tabs') || matches.has('ranking') || matches.has('scripts') ? <>
        <h2><FlaskConical size={14} />{highlight(t('experimentalFeatures'))}</h2>
        <div className="settings-group settings-experiments">
          {matches.has('tabs') ? <div data-setting="tabs">
            <div className="setting-row">
              <div className="setting-copy"><label htmlFor={tuckToggle}>{highlight(t('autoTuck'))}</label><p id={tuckHint}>{highlight(t('autoTuckHint'))}</p></div>
              <button id={tuckToggle} className="setting-toggle" role="switch" aria-label={t('autoTuck')} aria-checked={preferences.autoTuck}
                aria-describedby={tuckHint} disabled={tuckSaving} onClick={() => void toggleAutoTuck()}><span /></button>
            </div>
          </div> : null}
          {matches.has('ranking') ? <div data-setting="ranking">
            <div className="setting-row">
              <div className="setting-copy"><label>{highlight(t('searchRanking'))}</label><p>{highlight(t('searchRankingHint'))}</p>{rankingReset === 'done' ? <p className="setting-note" role="status">{t('rankingReset')}</p> : null}</div>
              <button className="ranking-reset" onClick={() => void resetRanking()} aria-disabled={rankingReset === 'busy'}>{highlight(t('resetSearchRanking'))}</button>
            </div>
          </div> : null}
          {matches.has('scripts') ? <div className="setting-row" data-setting="scripts"><div className="setting-copy"><label>{highlight(t('scriptLibrary'))}</label><p>{highlight(t('scriptLibraryHint'))}</p></div>
            <button className="ranking-reset" onClick={() => openLibrary('all')}>{highlight(t('manageScripts'))}</button></div> : null}
        </div>
      </> : null}
      {!matches.size ? <div className="empty"><Search size={26} /><strong role="status">{t('noResults')}</strong>
        <button className="ranking-reset" onClick={clearSearch}>{t('clearSettingsSearch')}</button></div> : null}
    </div>
    {error ? <div className="error-banner" role="alert">{t('errorSaveSettings')}</div> : null}
    <PaletteFooter title={t('settings')}
      navigation={{ kind: 'back', label: t('back'), tooltip: `${t('back')} · Esc`, onAction: back }}
      context={<span className="settings-navigation" title={t('settingsNavigationHelp')} aria-label={t('settingsNavigationHelp')}>
        <span className="navigation-key"><span className="key-chord"><kbd>Tab</kbd></span><span>{t('nextControl')}</span></span>
        <span aria-hidden="true">·</span>
        <span className="navigation-key"><span className="key-chord"><kbd>Shift+Tab</kbd></span><span>{t('previousControl')}</span></span>
      </span>} />
  </section>}</BackLayer>;
}
