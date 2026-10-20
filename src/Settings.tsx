import { BackLayer, useNavigateBack } from './Navigation';
import { SearchFocusButton } from './SearchFocusButton';
import { SearchDismissButton } from './SearchDismissButton';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, ExternalLink, FlaskConical, Keyboard, RotateCw, Search, SlidersHorizontal, X } from 'lucide-react';
import { HighlightedText } from './HighlightedText';
import { matchingSettings, type SettingRow } from './settingsSearch';
import { PaletteFooter } from './PaletteFooter';
import { useOperationFeedback } from './OperationFeedback';
import { describeShortcut } from './Shortcut';
import type { SettingsSection, TuckStatus } from './types';
import { BindingGuide } from './BindingGuide';
import { HelpView } from './HelpView';
import { systemLanguage, t } from './i18n';
import { isAutoTuckAfterHours, savePreferences, type Preferences } from './preferences';
import { getTuckStatus, openShortcuts, resetSearchRanking } from './api';

const tuckPresets = [1, 3, 12, 24, 72, 168];
const tuckDuration = (hours: number) => hours % 24 === 0 ? t('tuckDays', String(hours / 24)) : t('tuckHours', String(hours));

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

export function Settings({ preferences, shortcut, tabSwitcherShortcut, onBack, onClose, isMac, initialSection, onRankingReset }: {
  initialSection?: SettingsSection; preferences: Preferences; shortcut: string; tabSwitcherShortcut: string; onBack: () => void; onClose: () => void; isMac: boolean; onRankingReset?: () => void;
}) {
  const back = useNavigateBack();
  const [bindingOpen, setBindingOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const feedback = useOperationFeedback();
  const [rankingReset, setRankingReset] = useState<'idle' | 'busy'>('idle');
  const [tuckSaving, setTuckSaving] = useState(false);
  const [tuckRulesOpen, setTuckRulesOpen] = useState(false);
  const tuckRulesId = useId();
  const tuckHours = preferences.autoTuckAfterHours;
  // Keep a previously saved duration visible until the user chooses a preset.
  const tuckOptions = tuckPresets.includes(preferences.autoTuckAfterHours) ? tuckPresets : [...tuckPresets, preferences.autoTuckAfterHours];
  const [tuckStatus, setTuckStatus] = useState<TuckStatus | null>(null);
  const [tuckStatusHours, setTuckStatusHours] = useState<number | null>(null);
  const [tuckStatusError, setTuckStatusError] = useState(false);
  const [tuckRefreshing, setTuckRefreshing] = useState(false);
  const tuckHint = useId();
  const tuckToggle = useId();
  const body = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const returnTo = useRef<SettingRow | undefined>(initialSection);
  const scrollTop = useRef(0);
  const [query, setQuery] = useState('');
  const matches = matchingSettings(query);
  const paletteHotkeyHelp = `${shortcut ? describeShortcut(shortcut) : t('notAssigned')} — ${t('paletteHotkey')}. ${t('hotkeyHint')}`;
  const bindingHelp = `${tabSwitcherShortcut ? describeShortcut(tabSwitcherShortcut) : t('notAssigned')} — ${t('bindingHint')}`;
  const highlight = (text: string) => <HighlightedText text={text} query={query} allowTypos={false} />;
  function openBinding() {
    returnTo.current = 'binding';
    scrollTop.current = body.current?.scrollTop ?? 0;
    setBindingOpen(true);
  }
  function clearSearch() { setQuery(''); input.current?.focus(); }
  useLayoutEffect(() => {
    if (bindingOpen || helpOpen) return;
    const target = returnTo.current && body.current?.querySelector<HTMLElement>(`[data-setting="${returnTo.current}"] ${returnTo.current === 'tabs' ? '[role="switch"]' : 'button'}`);
    if (body.current) body.current.scrollTop = scrollTop.current;
    if (target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest' }); }
    else input.current?.focus();
  }, [bindingOpen, helpOpen]);
  const showTuck = preferences.autoTuck && matches.has('tabs') && !bindingOpen && !helpOpen;
  useEffect(() => {
    if (!showTuck) return;
    let cancelled = false;
    setTuckStatus(null); setTuckStatusError(false);
    const timer = setTimeout(() => {
      void getTuckStatus(tuckHours).then(status => {
        if (!cancelled) { setTuckStatus(status); setTuckStatusHours(tuckHours); }
      }).catch(() => { if (!cancelled) setTuckStatusError(true); });
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [showTuck, tuckHours, preferences.autoTuck]);
  async function refreshTuckStatus() {
    if (tuckRefreshing) return;
    setTuckRefreshing(true);
    const result = await feedback.run(() => getTuckStatus(tuckHours), () => t('tuckStatusRefreshed'), t('tuckStatusError'));
    if (result.ok) { setTuckStatus(result.value); setTuckStatusHours(tuckHours); setTuckStatusError(false); }
    setTuckRefreshing(false);
  }
  async function saveTuckDuration(value: string) {
    const hours = Number(value);
    if (!isAutoTuckAfterHours(hours) || tuckSaving) return;
    setTuckSaving(true);
    try { await change({ autoTuckAfterHours: hours }); }
    finally { setTuckSaving(false); }
  }
  async function change(patch: Partial<Preferences>) {
    await feedback.run(() => savePreferences(patch), () => {
      if (patch.language) return t('languageSaved', patch.language === 'system' ? t('followSystem') : patch.language === 'zh' ? '简体中文' : 'English');
      if (patch.theme) return t('themeSaved', t(patch.theme === 'system' ? 'followSystem' : patch.theme === 'light' ? 'lightTheme' : 'darkTheme'));
      if (patch.autoTuck !== undefined) return t(patch.autoTuck ? 'autoTuckEnabled' : 'autoTuckDisabled');
      return t('tuckDurationSaved', tuckDuration(patch.autoTuckAfterHours!));
    }, t('errorSaveSettings'));
  }
  async function changeHotkey() {
    const result = await feedback.run(openShortcuts, t('shortcutPageOpened'));
    if (result.ok) onClose();
  }
  async function toggleAutoTuck() {
    if (tuckSaving) return;
    setTuckSaving(true);
    try { await change({ autoTuck: !preferences.autoTuck }); }
    finally { setTuckSaving(false); }
  }
  async function resetRanking() {
    if (rankingReset === 'busy') return;
    setRankingReset('busy');
    try {
      const result = await feedback.run(resetSearchRanking, () => t('rankingReset'));
      if (result.ok) onRankingReset?.();
    } finally { setRankingReset('idle'); }
  }
  return <BackLayer onBack={onBack}>{helpOpen ? <HelpView shortcut={shortcut} onBack={() => setHelpOpen(false)} /> : bindingOpen ? <BindingGuide onBack={() => setBindingOpen(false)} isMac={isMac} /> : <section tabIndex={-1} className="palette settings-view settings-page" aria-label={t('settings')}>
    <header className="search-bar settings-search">
      <SearchFocusButton input={input} />
      <input ref={input} data-back-on-empty aria-label={t('searchSettings')} placeholder={t('searchSettingsPlaceholder')}
        value={query} onChange={event => { setQuery(event.target.value); if (body.current) body.current.scrollTop = 0; }}
        onKeyDown={event => { if (event.key === 'Enter') event.stopPropagation(); }} autoComplete="off" spellCheck={false} />
      {query ? <button className="settings-clear" title={t('clearSettingsSearch')} aria-label={t('clearSettingsSearch')}
        onClick={clearSearch}><X size={16} /></button> : null}
      <SearchDismissButton label={t('back')} />
    </header>
    <div className="settings-body" ref={body}>
      {matches.has('language') || matches.has('theme') || matches.has('help') ? <>
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
          {matches.has('help') ? <div className="setting-row" data-setting="help">
            <div className="setting-copy"><label>{highlight(t('help'))}</label><p>{highlight(t('helpHint'))}</p></div>
            <button className="ranking-reset" onClick={() => {
              returnTo.current = 'help'; scrollTop.current = body.current?.scrollTop ?? 0; setHelpOpen(true);
            }}>{highlight(t('openHelp'))}</button>
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
            <div className="hotkey-controls"><kbd className="hotkey-value" title={bindingHelp} aria-label={bindingHelp}>{tabSwitcherShortcut || t('notAssigned')}</kbd>
              <button className="ranking-reset" onClick={() => openBinding()}>{highlight(t('setUpShortcut'))}</button></div></div> : null}
        </div>
      </> : null}
      {matches.has('tabs') || matches.has('ranking') ? <>
        <h2><FlaskConical size={14} />{highlight(t('experimentalFeatures'))}</h2>
        <div className="settings-group settings-experiments">
          {matches.has('tabs') ? <div data-setting="tabs">
            <div className="setting-row tuck-heading">
              <div className="setting-copy"><label htmlFor={tuckToggle}>{highlight(t('autoTuck'))}</label>
                <p className="tuck-description"><span id={tuckHint}>{highlight(t('autoTuckHint'))}</span>{' '}
                  <button className="tuck-rules" aria-expanded={tuckRulesOpen} aria-controls={tuckRulesId} onClick={() => setTuckRulesOpen(value => !value)}>{t('tuckRules')}<ChevronDown size={12} /></button>
                </p>
              </div>
              <button id={tuckToggle} className="setting-toggle" role="switch" aria-label={t('autoTuck')} aria-checked={preferences.autoTuck}
                aria-describedby={tuckHint} aria-disabled={tuckSaving} onClick={() => void toggleAutoTuck()}><span /></button>
            </div>
            <div className="tuck-rules-copy" id={tuckRulesId} hidden={!tuckRulesOpen}>
              <p>{highlight(t('tuckScheduleHint'))}</p><p>{highlight(t('tuckTimingHint'))}</p><p>{highlight(t('autoTuckOffHint'))}</p>
            </div>
            {preferences.autoTuck ? <fieldset className="tuck-settings" disabled={tuckSaving}>
              <div className="setting-row">
                <div className="setting-copy">
                  <div className="tuck-duration-label"><label>{highlight(t('tuckAfter'))}</label>
                    <button className="tuck-refresh" aria-label={t('tuckRefresh')} title={t('tuckRefresh')} aria-disabled={tuckRefreshing} onClick={() => void refreshTuckStatus()}><RotateCw size={14} /></button>
                  </div>
                  <div className="tuck-status-copy" aria-live="polite">
                  {tuckStatusError ? <p role="alert">{t('tuckStatusError')}</p> : tuckStatus && tuckStatusHours === tuckHours && tuckStatus.enabled === preferences.autoTuck ? <>
                    <div className="tuck-status-summary">
                      <span>{tuckStatus.eligibleCount ? t('tuckWaiting', String(tuckStatus.eligibleCount)) : t('tuckNoCandidates')}</span>
                      <span className="tuck-last-check">{tuckStatus.lastScanAt
                        ? <time dateTime={new Date(tuckStatus.lastScanAt).toISOString()} title={new Date(tuckStatus.lastScanAt).toLocaleString()}>{t('tuckLastScan', new Date(tuckStatus.lastScanAt).toLocaleString(preferences.language === 'system' ? undefined : preferences.language, { dateStyle: 'short', timeStyle: 'short' }))}</time>
                        : t('tuckNotScanned')}</span>
                    </div>
                    {tuckStatus.blockedCount ? <p>{t('tuckBlocked', String(tuckStatus.blockedCount))}</p> : null}
                  </> : null}
                  </div>
                </div>
                <Choice query={query} label={t('tuckAfter')} value={String(tuckHours)} onChange={value => void saveTuckDuration(value)}
                  options={tuckOptions.map(hours => ({ value: String(hours), label: tuckDuration(hours) }))} />
              </div>
            </fieldset> : null}
          </div> : null}
          {matches.has('ranking') ? <div data-setting="ranking">
            <div className="setting-row">
              <div className="setting-copy"><label>{highlight(t('searchRanking'))}</label><p>{highlight(t('searchRankingHint'))}</p></div>
              <button className="ranking-reset" onClick={() => void resetRanking()} aria-disabled={rankingReset === 'busy'}>{highlight(t('resetSearchRanking'))}</button>
            </div>
          </div> : null}
        </div>
      </> : null}
      {!matches.size ? <div className="empty"><Search size={26} /><strong role="status">{t('noResults')}</strong>
        <button className="ranking-reset" onClick={clearSearch}>{t('clearSettingsSearch')}</button></div> : null}
    </div>
    <PaletteFooter title={t('settings')}
      navigation={{ kind: 'back', label: t('back'), tooltip: `${t('back')} · Esc`, onAction: back }}
      context={<span className="settings-navigation" title={t('settingsNavigationHelp')} aria-label={t('settingsNavigationHelp')}>
        <span className="navigation-key"><span className="key-chord"><kbd>Tab</kbd></span><span>{t('nextControl')}</span></span>
        <span aria-hidden="true">·</span>
        <span className="navigation-key"><span className="key-chord"><kbd>Shift+Tab</kbd></span><span>{t('previousControl')}</span></span>
      </span>} />
  </section>}</BackLayer>;
}
