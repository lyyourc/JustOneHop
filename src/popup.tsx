import { preferencesReady } from './preferences';
import { usageReady } from './usageState';
import { t } from './i18n';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';

void Promise.all([preferencesReady, usageReady]).then(() => {
  document.documentElement.lang = t('languageTag');
  document.body.className = 'zing-popup';
  createRoot(document.getElementById('root')!).render(<App mode="popup" onClose={() => window.close()} />);
});
