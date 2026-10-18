// Runs in Chrome's isolated world. No page text, typed keys, or persistent data.
(() => {
  type Modifier = 'Control' | 'Meta' | 'Alt';
  const state = new Map<Modifier, boolean>();
  let armed: { session: string; modifier: Modifier } | undefined;
  const focused = () => document.hasFocus() && !['IFRAME', 'FRAME'].includes(document.activeElement?.tagName || '');
  const observe = (event: KeyboardEvent) => {
    if (!event.isTrusted || !focused()) return;
    state.set('Control', event.ctrlKey);
    state.set('Meta', event.metaKey);
    state.set('Alt', event.altKey);
    if (armed && event.type === 'keyup' && event.key === armed.modifier) {
      void chrome.runtime.sendMessage({ source: 'justonehop-recent', type: 'release', session: armed.session }).catch(() => {});
    }
  };
  window.addEventListener('keydown', observe, true);
  window.addEventListener('keyup', observe, true);
  window.addEventListener('focus', event => { if (event.target === window) state.clear(); }, true);
  window.addEventListener('blur', event => { if (event.target === window) state.clear(); }, true);
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.source !== 'justonehop-recent') return;
    if (message.type === 'disarm' && armed?.session === message.session) armed = undefined;
    if (message.type !== 'arm' || !focused()) return;
    armed = { session: message.session, modifier: message.modifier };
    respond({ held: state.get(armed.modifier) ?? null });
  });
})();
