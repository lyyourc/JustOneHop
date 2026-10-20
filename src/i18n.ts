import english from '../public/_locales/en/messages.json';
import chinese from '../public/_locales/zh_CN/messages.json';
import { getPreferences } from './preferences';

export type MessageKey = keyof typeof english;

export function systemLanguage(): 'zh' | 'en' {
  return /^zh(?:-|$)/i.test(globalThis.chrome?.i18n?.getUILanguage?.() || 'en') ? 'zh' : 'en';
}

/** Resolve an explicit preference first, otherwise follow Chrome's UI locale. */
export function t(key: MessageKey, substitutions?: string | string[]): string {
  const preference = getPreferences().language;
  const language = preference === 'system' ? systemLanguage() : preference;
  const catalog = language === 'zh' ? chinese : english;
  const values = typeof substitutions === 'string' ? [substitutions] : substitutions || [];
  return catalog[key].message.replace(/\$(\d)/g, (_, index) => values[Number(index) - 1] ?? '');
}

export function countMessage(one: MessageKey, many: MessageKey, count: number): string {
  return t(count === 1 ? one : many, String(count));
}

export function errorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : '';
  if (/No tab|Invalid tab ID/i.test(message)) return t('errorClosedTab');
  if (/Extension context invalidated|Receiving end does not exist|message port closed/i.test(message)) return t('errorDisconnected');
  if (/No window|Invalid window/i.test(message)) return t('errorWindow');
  for (const key of Object.keys(english) as MessageKey[]) {
    if (!key.startsWith('error')) continue;
    for (const template of [english[key].message, chinese[key].message]) {
      if (template === message) return t(key);
      if (!/\$\d/.test(template)) continue;
      // Only numeric count substitutions survive the worker's serialized error
      // boundary; arbitrary native error text must still use the generic message.
      const pattern = template.split(/\$\d/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(\\d+)');
      const match = new RegExp(`^${pattern}$`).exec(message);
      if (match) return t(key, match.slice(1));
    }
  }
  return t('errorGeneric');
}
