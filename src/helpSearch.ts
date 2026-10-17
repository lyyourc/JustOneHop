import english from '../public/_locales/en/messages.json';
import chinese from '../public/_locales/zh_CN/messages.json';
import type { MessageKey } from './i18n';
import { termMatches } from './searchMatch';

const sections: { title: MessageKey; paragraphs: MessageKey[] }[] = [
  { title: 'helpStartTitle', paragraphs: ['helpStartBody', 'helpSearchBody'] },
  { title: 'helpControlsTitle', paragraphs: ['helpControlsBody', 'helpBackBody'] },
  { title: 'helpTabsTitle', paragraphs: ['helpTabsBody', 'helpTuckBody'] },
  { title: 'helpScriptsTitle', paragraphs: ['helpScriptsBody', 'helpScriptPermissionBody'] },
  { title: 'helpStorageTitle', paragraphs: ['helpStorageBody'] },
  { title: 'helpQuestionsTitle', paragraphs: ['helpShortcutBody', 'helpWindowBody', 'helpPrivacyBody'] },
];
const searchable = sections.map(section => ({
  section,
  text: [section.title, ...section.paragraphs].flatMap(key => [english[key].message, chinese[key].message]).join(' '),
}));

export function matchingHelp(query: string, shortcut = '') {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  return searchable.filter(({ text }) => terms.every(term => termMatches(text.replaceAll('$1', shortcut), term, false).length > 0))
    .map(({ section }) => section);
}
