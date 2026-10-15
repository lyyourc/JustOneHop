import { preferencesReady } from './preferences';
import { usageReady } from './usageState';
import { t } from './i18n';
import { createRoot, type Root } from 'react-dom/client';
import { App } from './App';
import styles from './style.css';

const marker = '__zingInstalled';
const scope = globalThis as typeof globalThis & { [marker]?: boolean };
if (!scope[marker]) {
  scope[marker] = true;
  let host: HTMLDivElement | null = null;
  let dialog: HTMLDialogElement | null = null;
  let root: Root | null = null;
  let previousFocus: HTMLElement | null = null;
  const close = () => {
    root?.unmount();
    dialog?.close();
    host?.remove();
    host = null; dialog = null; root = null;
    if (previousFocus?.isConnected) {
      // Reset Chromium's editing target as well as its reported activeElement.
      previousFocus.blur();
      previousFocus.focus({ preventScroll: true });
    }
  };
  const open = () => {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Remove an inert host left behind if the extension was reloaded in chrome://extensions.
    document.getElementById('zing-command-palette')?.remove();
    host = document.createElement('div');
    host.id = 'zing-command-palette';
    const shadow = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(styles);
    shadow.adoptedStyleSheets = [sheet];
    dialog = document.createElement('dialog');
    dialog.className = 'zing-dialog';
    dialog.setAttribute('aria-label', t('paletteLabel'));
    shadow.append(dialog);
    document.documentElement.append(host);
    // A separate document keeps page keyboard handlers out of the palette. Its
    // editable body is the closed shadow host: Vimium treats that document as an
    // editor and passes through every key, including Escape, without inspecting
    // our private input. The actual UI remains non-editable except its inputs.
    const frame = document.createElement('iframe');
    frame.className = 'zing-frame';
    frame.title = t('paletteLabel');
    frame.setAttribute('sandbox', 'allow-same-origin');
    dialog.append(frame);
    const frameDocument = frame.contentDocument;
    if (!frameDocument?.body) throw new Error('Unable to create keyboard surface');
    frameDocument.documentElement.lang = t('languageTag');
    frameDocument.body.style.margin = '0';
    frameDocument.body.contentEditable = 'true';
    const frameShadow = frameDocument.body.attachShadow({ mode: 'closed' });
    const frameWindow = frame.contentWindow as Window & typeof globalThis;
    const frameSheet = new frameWindow.CSSStyleSheet();
    frameSheet.replaceSync(styles);
    frameShadow.adoptedStyleSheets = [frameSheet];
    const surface = frameDocument.createElement('div');
    surface.contentEditable = 'false';
    frameShadow.append(surface);
    root = createRoot(surface);
    root.render(<App mode="overlay" onClose={close} />);
    dialog.showModal();
    dialog.addEventListener('cancel', event => event.preventDefault());
    // React handles keys first; then prevent page-level bubbling shortcuts.
    dialog.addEventListener('keydown', event => event.stopPropagation());
    dialog.addEventListener('keyup', event => event.stopPropagation());
  };
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.source !== 'zing') return;
    if (message.type === 'ping') { respond(true); return; }
    if (message.type === 'toggle') {
      void Promise.all([preferencesReady, usageReady]).then(() => {
        try { if (host) close(); else open(); respond(true); }
        catch { close(); respond(false); }
      });
      return true;
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && host) close(); });
}
