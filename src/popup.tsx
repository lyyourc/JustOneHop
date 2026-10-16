import { preferencesReady } from './preferences';
import { usageReady } from './usageState';
import { t } from './i18n';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { alignPanelWindow } from './panelGeometry';
import './style.css';

const params = new URLSearchParams(location.hash.slice(1));
const alignment = params.has('window') && params.has('tab') && params.has('owner')
  ? alignPanelWindow(Number(params.get('tab')), Number(params.get('owner'))).catch(() => {}) : Promise.resolve();
void Promise.all([preferencesReady, usageReady, alignment]).then(() => {
  document.documentElement.lang = t('languageTag');
  document.body.className = location.hash.startsWith('#window=') ? 'zing-popup centered-palette' : 'zing-popup';
  createRoot(document.getElementById('root')!).render(<App mode="popup" onClose={() => window.close()} />);
});
