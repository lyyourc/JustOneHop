let preparing: Promise<void> | undefined;
let updates = Promise.resolve();
const themeAlarm = 'justonehop-toolbar-theme';

export function ensureToolbarTheme(): Promise<void> {
  if (preparing) return preparing;
  preparing = (async () => {
    const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [chrome.runtime.getURL('theme.html')] });
    if (contexts.length) await chrome.runtime.sendMessage({ source: 'justonehop', type: 'read-toolbar-theme' });
    else await chrome.offscreen.createDocument({ url: 'theme.html', reasons: [chrome.offscreen.Reason.MATCH_MEDIA], justification: 'Follow system color scheme for the toolbar icon while the palette is closed.' });
  })().finally(() => { preparing = undefined; });
  return preparing;
}

export function startToolbarIcon() {
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('theme.html') || sender.tab ||
        message?.source !== 'justonehop' || message.type !== 'toolbar-theme' || typeof message.dark !== 'boolean') return;
    const suffix = message.dark ? '-dark' : '';
    updates = updates.catch(() => {}).then(() => chrome.action.setIcon({ path: {
      16: `icon16${suffix}.png`, 32: `icon32${suffix}.png`,
      48: `toolbar48${suffix}.png`, 128: `toolbar128${suffix}.png`,
    } }));
    void updates.then(() => respond({ ok: true }), error => { console.warn('justonehop: unable to update toolbar icon.', error); respond({ ok: false }); });
    return true;
  });
  const refresh = () => { void ensureToolbarTheme().catch(error => console.warn('justonehop: unable to watch toolbar theme.', error)); };
  // Offscreen pages may defer media-query change events without rendering frames.
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === themeAlarm) refresh(); });
  void chrome.alarms.create(themeAlarm, { periodInMinutes: 0.5 }).catch(error => console.warn('justonehop: unable to schedule toolbar theme sync.', error));
  chrome.runtime.onInstalled.addListener(refresh);
  chrome.runtime.onStartup.addListener(refresh);
  chrome.windows.onFocusChanged.addListener(id => { if (id !== chrome.windows.WINDOW_ID_NONE) refresh(); });
  refresh();
}
