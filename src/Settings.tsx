import { BackLayer } from './Navigation';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, Check, ChevronDown, ExternalLink, Code, Globe2, Keyboard, Monitor, Search, PanelsTopLeft } from 'lucide-react';
import type { SettingsSection } from './types';
import { ScriptLibrary } from './ScriptLibrary';
import { systemLanguage, t } from './i18n';
import { savePreferences, type Preferences } from './preferences';
import { openShortcuts, resetSearchRanking } from './api';

function Choice<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void;
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
    const upwards = belowSpace < 120 && aboveSpace > belowSpace;
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
      <span>{options[selected].label}</span><ChevronDown size={14} />
    </button>
    {open ? <div className={`choice-menu ${above ? 'above' : ''}`} style={{ maxHeight: menuHeight, overflowY: 'auto' }} role="listbox" id={id} aria-label={label}>
      {options.map((option, at) => <div key={option.value} id={`${id}-${at}`} role="option" aria-selected={value === option.value}
        className={`choice-option ${at === index ? 'highlighted' : ''}`} onMouseMove={() => setIndex(at)}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(at)}>
        <span>{option.label}</span>{value === option.value ? <Check size={14} /> : null}
      </div>)}
    </div> : null}
  </div></BackLayer>;
}

export function Settings({ preferences, shortcut, onBack, onClose, isMac, initialSection }: {
  initialSection?: SettingsSection; preferences: Preferences; shortcut: string; onBack: () => void; onClose: () => void; isMac: boolean;
}) {
  const [library, setLibrary] = useState<'all' | 'binding' | null>(null);
  const [error, setError] = useState(false);
  const [rankingReset, setRankingReset] = useState<'idle' | 'busy' | 'done'>('idle');
  const [tuckSaving, setTuckSaving] = useState(false);
  const tuckHint = useId();
  const tuckToggle = useId();
  const back = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (library) return;
    const section = initialSection && body.current?.querySelector<HTMLElement>(`[data-setting="${initialSection}"]`);
    const target = section && section.querySelector<HTMLElement>('button');
    if (target) { section.scrollIntoView({ block: 'nearest' }); target.focus({ preventScroll: true }); }
    else back.current?.focus();
  }, [library, initialSection]);
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
  return <BackLayer onBack={onBack}>{library ? <ScriptLibrary initialBinding={library === 'binding'} onBack={() => setLibrary(null)} onClose={onClose} isMac={isMac} /> : <section tabIndex={-1} className="palette settings-view" aria-label={t('settings')}>
    <header className="settings-header">
      <button ref={back} className="settings-back" onClick={onBack} aria-label={t('back')}><ArrowLeft size={18} /></button>
      <h1>{t('settings')}</h1><kbd>esc</kbd>
    </header>
    <div className="settings-body" ref={body}>
      <h2><Globe2 size={15} />{t('general')}</h2>
      <div className="settings-group" data-setting="language">
        <div className="setting-row">
          <div className="setting-copy"><label>{t('language')}</label><p>{t('languageHint')}</p></div>
          <Choice label={t('language')} value={preferences.language} onChange={language => void change({ language })}
            options={[{ value: 'system', label: t('followSystem') }, { value: 'zh', label: '简体中文' }, { value: 'en', label: 'English' }]} />
        </div>
        {preferences.language === 'system' ? <p className="setting-note">{t('systemLanguage', systemLanguage() === 'zh' ? '简体中文' : 'English')}</p> : null}
      </div>
      <h2><Monitor size={15} />{t('appearance')}</h2>
      <div className="settings-group" data-setting="theme">
        <div className="setting-row">
          <div className="setting-copy"><label>{t('theme')}</label><p>{t('themeHint')}</p></div>
          <Choice label={t('theme')} value={preferences.theme} onChange={theme => void change({ theme })}
            options={[{ value: 'system', label: t('followSystem') }, { value: 'light', label: t('lightTheme') }, { value: 'dark', label: t('darkTheme') }]} />
        </div>
      </div>
      <h2><PanelsTopLeft size={15} />{t('tabManagement')}</h2>
      <div className="settings-group" data-setting="tabs">
        <div className="setting-row">
          <div className="setting-copy"><label htmlFor={tuckToggle}>{t('autoTuck')}</label><p id={tuckHint}>{t('autoTuckHint')}</p></div>
          <button id={tuckToggle} className="setting-toggle" role="switch" aria-label={t('autoTuck')} aria-checked={preferences.autoTuck}
            aria-describedby={tuckHint} disabled={tuckSaving} onClick={() => void toggleAutoTuck()}><span /></button>
        </div>
        <p className="setting-note">{t('autoTuckOffHint')}</p>
      </div>
      <h2><Search size={15} />{t('searchRanking')}</h2>
      <div className="settings-group" data-setting="ranking">
        <div className="setting-row">
          <div className="setting-copy"><label>{t('searchRanking')}</label><p>{t('searchRankingHint')}</p></div>
          <button className="ranking-reset" onClick={() => void resetRanking()} aria-disabled={rankingReset === 'busy'}>{t('resetSearchRanking')}</button>
        </div>
        {rankingReset === 'done' ? <p className="setting-note" role="status">{t('rankingReset')}</p> : null}
      </div>
      <h2><Keyboard size={15} />{t('keyboard')}</h2>
      <div className="settings-group" data-setting="keyboard">
        <div className="setting-row hotkey-row">
          <div className="setting-copy"><label>{t('paletteHotkey')}</label><p>{t('defaultHotkey', isMac ? '⌘⇧P' : 'Ctrl+Shift+P')}</p></div>
          <div className="hotkey-controls"><kbd className="hotkey-value">{shortcut || t('notAssigned')}</kbd>
            <button className="hotkey-change" onClick={() => void changeHotkey()}>{t('changeHotkey')}<ExternalLink size={12} /></button>
          </div>
        </div>
        <p className="setting-note">{t('hotkeyHint')}</p>
        <div className="setting-row binding-row"><div className="setting-copy"><label>{t('recentSwitcher')}</label><p>{t('bindingHint')}</p></div>
          <button className="ranking-reset" onClick={() => setLibrary('binding')}>{t('bindCtrlTab')}</button></div>
      </div>
      <h2><Code size={15} />{t('scriptLibrary')}</h2>
      <div className="settings-group"><div className="setting-row"><div className="setting-copy"><label>{t('scriptLibrary')}</label><p>{t('scriptLibraryHint')}</p></div>
        <button className="ranking-reset" onClick={() => setLibrary('all')}>{t('manageScripts')}</button></div></div>
    </div>
    {error ? <div className="error-banner" role="alert">{t('errorSaveSettings')}</div> : null}
    <footer className="footer settings-footer"><span>{t('savedLocally')}</span><span className="key-chord"><kbd>esc</kbd>{t('back')}</span></footer>
  </section>}</BackLayer>;
}
