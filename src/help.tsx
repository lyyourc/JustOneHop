import { useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { HelpView } from './HelpView';
import { BackLayer, NavigationRoot } from './Navigation';
import { getPreferences, preferencesReady, subscribePreferences } from './preferences';
import { t } from './i18n';
import './style.css';
import './help.css';

function HelpPage() {
  const preferences = useSyncExternalStore(subscribePreferences, getPreferences);
  const [shortcut, setShortcut] = useState('');
  useEffect(() => {
    const refresh = () => {
      void chrome.commands.getAll().then(commands => {
        setShortcut(commands.find(command => command.name === 'toggle-palette')?.shortcut || '');
      }).catch(error => { console.warn('justonehop: unable to read shortcut.', error); });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  useEffect(() => {
    document.documentElement.lang = t('languageTag');
    document.title = `${t('help')} · ${t('extensionName')}`;
    document.documentElement.style.colorScheme = preferences.theme === 'system' ? 'light dark' : preferences.theme;
  }, [preferences]);
  const close = () => window.close();
  return <NavigationRoot><BackLayer onBack={close}>
    <main className="justonehop-app help-page settled" data-theme={preferences.theme} lang={t('languageTag')}>
      <HelpView standalone shortcut={shortcut} onBack={close} />
    </main>
  </BackLayer></NavigationRoot>;
}

void preferencesReady.then(() => {
  document.body.className = 'justonehop-help';
  createRoot(document.getElementById('root')!).render(<HelpPage />);
});
