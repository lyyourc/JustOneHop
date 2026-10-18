const scheme = matchMedia('(prefers-color-scheme: dark)');
const report = () => chrome.runtime.sendMessage({ source: 'justonehop', type: 'toolbar-theme', dark: matchMedia('(prefers-color-scheme: dark)').matches });
const changed = () => { void report().catch(error => console.warn('justonehop: unable to report toolbar theme.', error)); };
scheme.addEventListener('change', changed);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.source !== 'justonehop' || message.type !== 'read-toolbar-theme') return;
  void report().then(respond, () => respond({ ok: false }));
  return true;
});
changed();
