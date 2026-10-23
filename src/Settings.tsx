import { BackLayer, useNavigateBack } from './Navigation';
import { SearchFocusButton } from './SearchFocusButton';
import { SearchIcon } from './SearchIcon';
import { SearchIconSettings } from './SearchIconSettings';
import { SearchDismissButton } from './SearchDismissButton';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { BookOpen, Check, ChevronDown, ExternalLink, FlaskConical, Keyboard, Paintbrush, RotateCw, Search } from 'lucide-react';
import { SettingsPage } from './SettingsPage';
import { matchingSettings, settingCategory, settingsCategories, type SettingRow, type SettingsCategory } from './settingsSearch';
import { PaletteFooter } from './PaletteFooter';
import { useOperationFeedback } from './OperationFeedback';
import { describeShortcut } from './Shortcut';
import type { SettingsSection, TuckStatus } from './types';
import { BindingGuide } from './BindingGuide';
import { HelpView } from './HelpView';
import { systemLanguage, t } from './i18n';
import { isAutoTuckAfterHours, savePreferences, type Preferences } from './preferences';
import { getTuckStatus, openShortcuts, resetSearchRanking } from './api';

const categoryLabel = (category: SettingsCategory) => t(category === 'experimentalFeatures' ? 'settingsLabs' : category);
const tuckPresets = [1, 12, 24, 72, 168];
const tuckDuration = (hours: number) => hours % 24 === 0
  ? t(hours === 24 ? 'tuckDay' : 'tuckDays', String(hours / 24))
  : t(hours === 1 ? 'tuckHour' : 'tuckHours', String(hours));

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

export function Settings({ preferences, shortcut, tabSwitcherShortcut, onBack, onClose, isMac, initialSection, onRankingReset }: {
  initialSection?: SettingsSection; preferences: Preferences; shortcut: string; tabSwitcherShortcut: string; onBack: () => void; onClose: () => void; isMac: boolean; onRankingReset?: () => void;
}) {
  const back = useNavigateBack();
  const [detail, setDetail] = useState<'binding' | 'searchIcon' | 'help'>();
  const [detailRevision, setDetailRevision] = useState(0);
  const [category, setCategory] = useState<SettingsCategory>(initialSection ? settingCategory[initialSection] : 'appearance');
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  const bindingOpen = detail === 'binding', iconOpen = detail === 'searchIcon', helpOpen = detail === 'help';
  const detailReturn = useRef({ query: '', category, scroll: 0, selection: [0, 0] as [number, number] });
  const categoryScroll = useRef<Partial<Record<SettingsCategory, number>>>({});
  const searchReturn = useRef<{ scroll: number } | null>(null);
  const categories = useRef<HTMLElement>(null);
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
  const [showTuckLoading, setShowTuckLoading] = useState(false);
  const currentTuckStatus = tuckStatusHours === tuckHours && tuckStatus?.enabled === preferences.autoTuck ? tuckStatus : null;
  const [tuckRefreshing, setTuckRefreshing] = useState(false);
  const tuckHint = useId();
  const tuckToggle = useId();
  const body = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const returnTo = useRef<SettingRow | undefined>(initialSection);
  const scrollTop = useRef(0);
  const [query, setQuery] = useState('');
  const searching = !!query.trim();
  const matches = new Set([...matchingSettings(query)].filter(row => searching || settingCategory[row] === category));
  const resultCategories = new Set([...matches].map(row => settingCategory[row]));
  const highlightedCategory = searching && resultCategories.size && !resultCategories.has(category)
    ? settingsCategories.find(item => resultCategories.has(item))! : category;
  const helpCategory = category === 'help' && !detail;
  const detailVisible = (!!detail || helpCategory) && !searching;
  const categoryIcons = { appearance: Paintbrush, keyboard: Keyboard, experimentalFeatures: FlaskConical, help: BookOpen };
  const paletteHotkeyHelp = `${shortcut ? describeShortcut(shortcut) : t('notAssigned')} — ${t('paletteHotkey')}. ${t('hotkeyHint')}`;
  const bindingHelp = `${tabSwitcherShortcut ? describeShortcut(tabSwitcherShortcut) : t('notAssigned')} — ${t('bindingHint')}`;
  function openDetail(next: 'binding' | 'searchIcon' | 'help') {
    feedback.dismiss();
    detailReturn.current = { query, category, scroll: body.current?.scrollTop ?? 0, selection: [input.current?.selectionStart ?? 0, input.current?.selectionEnd ?? 0] };
    returnTo.current = next;
    searchReturn.current = null;
    setCategory(settingCategory[next]); setQuery(''); setDetail(next); setDetailRevision(value => value + 1);
  }
  function closeDetail() {
    feedback.dismiss();
    const previous = detailReturn.current;
    scrollTop.current = previous.scroll;
    setCategory(previous.category); setQuery(previous.query); setDetail(undefined);
  }
  function selectCategory(next: SettingsCategory) {
    feedback.dismiss();
    if (!searching && !detail) categoryScroll.current[category] = body.current?.scrollTop ?? 0;
    returnTo.current = undefined; searchReturn.current = null;
    scrollTop.current = categoryScroll.current[next] ?? 0;
    setDetail(undefined); setQuery(''); setCategory(next);
  }
  function updateQuery(next: string) {
    if (!searching && next.trim()) searchReturn.current = { scroll: body.current?.scrollTop ?? 0 };
    if (searching && !next.trim()) scrollTop.current = searchReturn.current?.scroll ?? 0;
    else if (next.trim()) scrollTop.current = 0;
    setQuery(next);
  }
  function clearSearch() { updateQuery(''); input.current?.focus(); }
  useLayoutEffect(() => {
    if (detailVisible) return;
    if (body.current) body.current.scrollTop = scrollTop.current;
  }, [category, detailVisible, query]);
  useLayoutEffect(() => {
    if (detail) return;
    input.current?.setSelectionRange(...detailReturn.current.selection);
    const target = returnTo.current && body.current?.querySelector<HTMLElement>(`[data-setting="${returnTo.current}"] ${returnTo.current === 'tabs' ? '[role="switch"]' : 'button'}`);
    if (target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest' }); }
    else if (!categories.current?.contains((categories.current.getRootNode() as ShadowRoot | Document).activeElement)) input.current?.focus();
  }, [detail]);
  const showTuck = matches.has('tabs') && !detailVisible;
  useEffect(() => {
    if (!showTuck) return;
    let cancelled = false;
    setTuckStatus(null); setTuckStatusError(false); setShowTuckLoading(false);
    const timer = setTimeout(() => setShowTuckLoading(true), 150);
    void getTuckStatus(tuckHours).then(status => {
      if (!cancelled) { setTuckStatus(status); setTuckStatusHours(tuckHours); }
    }).catch(() => { if (!cancelled) setTuckStatusError(true); }).finally(() => {
      clearTimeout(timer);
      if (!cancelled) setShowTuckLoading(false);
    });
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
      if (patch.hidePet !== undefined) return null;
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
  const tuckRulesButton = <button className="tuck-rules" aria-expanded={tuckRulesOpen} aria-controls={tuckRulesId} onClick={() => setTuckRulesOpen(value => !value)}>{t('tuckRules')}<ChevronDown size={12} /></button>;
  return <BackLayer onBack={onBack}><BackLayer active={searching} onBack={clearSearch}><section tabIndex={-1} className="palette settings-view settings-page" aria-label={t('settings')}>
    <header className="search-bar settings-search">
      <SearchFocusButton input={input} onBack={back} />
      <input ref={input} data-back-on-empty aria-label={t('searchSettings')} placeholder={t('searchSettingsPlaceholder')}
        value={query} onChange={event => updateQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') event.stopPropagation(); }} autoComplete="off" spellCheck={false} />
      <SearchDismissButton label={t('back')} query={query} input={input} onClear={clearSearch} />
    </header>
    <div className="settings-workspace">
      <nav ref={categories} className="settings-sidebar" aria-label={t('settingsCategories')}>
        <label className="settings-category-select">{t('settingsCategories')}
          <select aria-label={t('settingsCategories')} value={highlightedCategory} onChange={event => selectCategory(event.target.value as SettingsCategory)}>
            {settingsCategories.map(item => <option key={item} value={item}>{categoryLabel(item)}</option>)}
          </select>
        </label>
        <div className="settings-category-list" role="tablist" aria-label={t('settingsCategories')} aria-orientation="vertical">
          {settingsCategories.map(item => {
            const Icon = categoryIcons[item];
            return <button key={item} type="button" role="tab" aria-selected={highlightedCategory === item}
              aria-controls="settings-content" onClick={() => selectCategory(item)}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) {
                  if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
                  return;
                }
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault(); event.stopPropagation();
                const at = settingsCategories.indexOf(item);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? settingsCategories.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + settingsCategories.length) % settingsCategories.length;
                selectCategory(settingsCategories[next]);
                categories.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
              }}><Icon size={16} aria-hidden="true" /><span>{categoryLabel(item)}</span></button>;
          })}
        </div>
      </nav>
      <div id="settings-content" className="settings-content">
      {detail || helpCategory ? <SettingsPage.Provider value={{ active: detailVisible, footer }}>
        <div key={detailRevision} className="settings-detail" hidden={!detailVisible} inert={!detailVisible}>
          {iconOpen ? <SearchIconSettings value={preferences.searchIcon} onBack={closeDetail} /> : helpOpen || helpCategory ? <HelpView shortcut={shortcut} onBack={helpCategory ? onBack : closeDetail} autoFocus={!helpCategory} /> : bindingOpen ? <BindingGuide onBack={closeDetail} isMac={isMac} /> : null}
        </div>
      </SettingsPage.Provider> : null}
    <div className="settings-body" ref={body} hidden={detailVisible} inert={detailVisible}>
      {matches.has('language') || matches.has('theme') || matches.has('searchIcon') || matches.has('hidePet') ? <>
        <div className="settings-group settings-appearance">
          {matches.has('language') ? <div data-setting="language">
            <div className="setting-row">
              <div className="setting-copy"><label>{t('language')}</label>{preferences.language === 'system' ? <p>{t('systemLanguage', systemLanguage() === 'zh' ? '简体中文' : 'English')}</p> : null}</div>
              <Choice label={t('language')} value={preferences.language} onChange={language => void change({ language })}
                options={[{ value: 'system', label: t('followSystem') }, { value: 'zh', label: '简体中文' }, { value: 'en', label: 'English' }]} />
            </div>
          </div> : null}
          {matches.has('theme') ? <div data-setting="theme">
            <div className="setting-row">
              <div className="setting-copy"><label>{t('theme')}</label></div>
              <Choice label={t('theme')} value={preferences.theme} onChange={theme => void change({ theme })}
                options={[{ value: 'system', label: t('followSystem') }, { value: 'light', label: t('lightTheme') }, { value: 'dark', label: t('darkTheme') }]} />
            </div>
          </div> : null}
          {matches.has('searchIcon') ? <div className="setting-row" data-setting="searchIcon">
            <div className="setting-copy"><label>{t('searchIcon')}</label><p>{t('searchIconHint')}</p></div>
            <button className="surface-button" aria-label={t('searchIconChange')} onClick={() => openDetail('searchIcon')}><SearchIcon />{t('searchIconChange')}</button>
          </div> : null}
          {matches.has('hidePet') ? <div className="setting-row" data-setting="hidePet">
            <div className="setting-copy"><label>{t('hidePet')}</label><p>{t('hidePetHint')}</p></div>
            <button className="setting-toggle" role="switch" aria-label={t('hidePet')} aria-checked={!!preferences.hidePet}
              onClick={() => void change({ hidePet: !preferences.hidePet })}><span /></button>
          </div> : null}
        </div>
      </> : null}
      {matches.has('keyboard') || matches.has('binding') ? <>
        <div className="settings-group settings-keyboard">
          {matches.has('keyboard') ? <div className="setting-row hotkey-row" data-setting="keyboard">
            <div className="setting-copy"><label>{t('paletteHotkey')}</label><p>{t('paletteHotkeyHint')}</p></div>
            <div className="hotkey-controls"><kbd className="hotkey-value" title={paletteHotkeyHelp} aria-label={paletteHotkeyHelp}>{shortcut || t('notAssigned')}</kbd>
              <button className="hotkey-change" onClick={() => void changeHotkey()}>{t('changeHotkey')}<ExternalLink size={12} /></button>
            </div>
          </div> : null}
          {matches.has('binding') ? <div className="setting-row" data-setting="binding"><div className="setting-copy"><label>{t('ctrlTabSetting')}</label><p>{t('bindingHint')}</p></div>
            <div className="hotkey-controls"><kbd className="hotkey-value" title={bindingHelp} aria-label={bindingHelp}>{tabSwitcherShortcut || t('notAssigned')}</kbd>
              <button className="surface-button" onClick={() => openDetail('binding')}>{t('setUpShortcut')}</button></div></div> : null}
        </div>
      </> : null}
      {matches.has('tabs') || matches.has('ranking') ? <>
        <div className="settings-group settings-experiments">
          {matches.has('tabs') ? <div data-setting="tabs">
            <div className="setting-row tuck-heading">
              <div className="setting-copy"><label htmlFor={tuckToggle}>{t('autoTuck')}</label>
                <p className="tuck-description" id={tuckHint}>{t('autoTuckHint')}</p>
              </div>
              <button id={tuckToggle} className="setting-toggle" role="switch" aria-label={t('autoTuck')} aria-checked={preferences.autoTuck}
                aria-describedby={tuckHint} aria-disabled={tuckSaving} onClick={() => void toggleAutoTuck()}><span /></button>
            </div>
            {!preferences.autoTuck && (tuckStatus?.pendingReleaseCount || tuckStatusError) ? <div className="tuck-status-copy" role="status">
              <p>{tuckStatusError ? t('tuckStatusError') : t('tuckReleasePending', String(tuckStatus!.pendingReleaseCount))}</p>
              <button className="tuck-refresh" aria-label={t('tuckRefresh')} aria-disabled={tuckRefreshing} onClick={() => void refreshTuckStatus()}><RotateCw size={14} /></button>
            </div> : null}
            {preferences.autoTuck ? <fieldset className="tuck-settings" disabled={tuckSaving}>
              <div className="setting-row">
                <div className="setting-copy tuck-duration-label"><label>{t('tuckAfter')}</label></div>
                <Choice label={t('tuckAfter')} value={String(tuckHours)} onChange={value => void saveTuckDuration(value)}
                  options={tuckOptions.map(hours => ({ value: String(hours), label: tuckDuration(hours) }))} />
              </div>
              <div className="tuck-status-copy" aria-live="polite">
                <div className="tuck-status-details">
                  {tuckStatusError ? <p role="alert">{t('tuckStatusError')}</p> : currentTuckStatus ? <>
                    <div className="tuck-status-summary">
                      <span>{currentTuckStatus.eligibleCount ? t(currentTuckStatus.waitingReason === 'active' ? 'tuckWaitingActive' : currentTuckStatus.waitingReason === 'grace' ? 'tuckWaitingGrace' : 'tuckWaiting', String(currentTuckStatus.eligibleCount)) : t('tuckNoCandidates')}</span>
                    </div>
                    {currentTuckStatus.notDueCount || currentTuckStatus.protectedCount ? <p>{[
                      currentTuckStatus.notDueCount ? t('tuckNotDue', String(currentTuckStatus.notDueCount)) : '',
                      currentTuckStatus.protectedCount ? t('tuckProtected', String(currentTuckStatus.protectedCount)) : '',
                    ].filter(Boolean).join(' · ')}</p> : null}
                    {currentTuckStatus.blockedCount ? <p>{t('tuckBlocked', String(currentTuckStatus.blockedCount))}</p> : null}
                    {currentTuckStatus.lastFailureAt ? <p><time dateTime={new Date(currentTuckStatus.lastFailureAt).toISOString()} title={new Date(currentTuckStatus.lastFailureAt).toLocaleString()}>{t('tuckLastFailure', new Date(currentTuckStatus.lastFailureAt).toLocaleString(preferences.language === 'system' ? undefined : preferences.language, { dateStyle: 'short', timeStyle: 'short' }))}</time></p> : null}
                  </> : <span className="tuck-loading">{showTuckLoading ? t('loading') : null}</span>}
                </div>
                <button className="tuck-refresh" aria-label={t('tuckRefresh')} title={t('tuckRefresh')} aria-disabled={tuckRefreshing} onClick={() => void refreshTuckStatus()}><RotateCw size={14} /></button>
                <div className="tuck-check-row">
                  <span className="tuck-last-check">{!tuckStatusError && currentTuckStatus ? currentTuckStatus.lastScanAt
                    ? <time dateTime={new Date(currentTuckStatus.lastScanAt).toISOString()} title={new Date(currentTuckStatus.lastScanAt).toLocaleString()}>{t('tuckLastScan', new Date(currentTuckStatus.lastScanAt).toLocaleString(preferences.language === 'system' ? undefined : preferences.language, { dateStyle: 'short', timeStyle: 'short' }))}</time>
                    : t('tuckNotScanned') : null}</span>
                  {tuckRulesButton}
                </div>
              </div>
            </fieldset> : null}
            <div className="tuck-rules-section">
              {!preferences.autoTuck ? tuckRulesButton : null}
              <ul className="tuck-rules-copy" id={tuckRulesId} hidden={!tuckRulesOpen}>
                <li>{t('tuckTimingHint')}</li><li>{t('tuckScheduleHint')}</li><li>{t('tuckProtectedHint')}</li><li>{t('autoTuckOffHint')}</li>
              </ul>
            </div>
          </div> : null}
          {matches.has('ranking') ? <div data-setting="ranking">
            <div className="setting-copy"><label>{t('searchRanking')}</label><p>{t('searchRankingHint')}</p></div>
            <div className="setting-action-row">
              <p>{t('searchRankingResetHint')}</p>
              <button className="ranking-reset" onClick={() => void resetRanking()} aria-disabled={rankingReset === 'busy'}>{t('resetSearchRanking')}</button>
            </div>
          </div> : null}
        </div>
      </> : null}
      {searching && matches.has('help') ? <>
        <div className="settings-group"><div className="setting-row" data-setting="help">
          <div className="setting-copy"><label>{t('help')}</label><p>{t('helpHint')}</p></div>
          <button className="surface-button" onClick={() => openDetail('help')}>{t('openHelp')}</button>
        </div></div>
      </> : null}
      {!matches.size ? <div className="empty"><Search size={26} /><strong role="status">{t('noResults')}</strong>
        <button className="surface-button" onClick={clearSearch}>{t('clearSettingsSearch')}</button></div> : null}
    </div>
      </div>
    </div>
    <div className="settings-footer" ref={setFooter} />
    {!detailVisible ? <PaletteFooter title={t('settings')} hints={true} /> : null}
  </section></BackLayer></BackLayer>;
}
