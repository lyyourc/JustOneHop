import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { Cookie } from 'lucide-react';
import { getPreferences, preferencesReady } from './preferences';
import { t } from './i18n';
import { cookiePatterns } from './cookieAccess';
import './style.css';

function CookieAccess() {
  const params = new URLSearchParams(location.search);
  const tabId = Number(params.get('tab'));
  const windowId = Number(params.get('window'));
  const origin = params.get('origin') || '';
  let patterns: string[] = [];
  try { patterns = cookiePatterns(origin); } catch { /* An invalid URL stays disabled. */ }
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let alive = true;
    const check = () => {
      void chrome.tabs.get(tabId).then(tab => {
        if (!alive) return;
        const valid = patterns.length > 0 && tab.windowId === windowId && !tab.pendingUrl && new URL(tab.url || '').origin === origin;
        setReady(valid); if (!valid) setError(t('errorStorageChanged'));
      }).catch(() => { if (alive) { setReady(false); setError(t('errorStorageTarget')); } });
    };
    const changed = (id: number) => { if (id === tabId) check(); };
    check(); chrome.tabs.onUpdated.addListener(changed); chrome.tabs.onRemoved.addListener(changed);
    return () => { alive = false; chrome.tabs.onUpdated.removeListener(changed); chrome.tabs.onRemoved.removeListener(changed); };
  }, []);
  useEffect(() => { if (ready) button.current?.focus(); }, [ready]);
  async function grant() {
    if (!ready || busy) return;
    // Called directly from the button's user gesture in an extension page.
    setBusy(true); setError('');
    try { if (await chrome.permissions.request({ origins: patterns })) window.close(); else setError(t('cookieAccessDenied')); }
    catch { setError(t('cookieAccessError')); }
    finally { setBusy(false); }
  }
  return <main className="zing-app cookie-access" data-theme={getPreferences().theme} onKeyDown={event => { if (event.key === 'Escape') window.close(); }}>
    <Cookie size={28} /><h1>{t('cookieAccessTitle')}</h1>
    <strong className="permission-site">{patterns.map(pattern => pattern.replace('*://', '').replace('/*', '')).join(' · ') || origin}</strong>
    <p>{t('cookieAccessHint')}</p>
    {error ? <p className="permission-error" role="alert">{error}</p> : null}
    <div className="permission-buttons"><button onClick={() => window.close()}>{t('back')}</button><button ref={button} className="permission-allow" disabled={!ready || busy} onClick={() => void grant()}>{t('cookieAccessConfirm')}</button></div>
  </main>;
}
void preferencesReady.then(() => {
  document.documentElement.lang = t('languageTag'); document.body.style.margin = '0';
  document.title = 'zing · Cookies'; createRoot(document.getElementById('root')!).render(<CookieAccess />);
});
