/** Filtering preserves the session's MRU order and never searches outside it. */
export function filterRecentTabs(tabs: chrome.tabs.Tab[], query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return tabs.filter(tab => terms.every(term => `${tab.title || ''} ${tab.url || ''}`.toLocaleLowerCase().includes(term)));
}

/** Keep a visible selection while editing; a removed target requires a new choice. */
export function recentSelection(tabs: chrome.tabs.Tab[], selectedId: number | undefined, fallback = 0) {
  const at = tabs.findIndex(tab => tab.id === selectedId);
  return at >= 0 ? at : tabs.length ? fallback : -1;
}

export function recentNavigation(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, index: number, count: number, pageSize: number) {
  const arrow = event.key === 'ArrowDown' || event.key === 'ArrowUp';
  const emacs = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && ['n', 'p'].includes(event.key.toLowerCase());
  const page = ['PageDown', 'PageUp'].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.shiftKey;
  const tab = event.key === 'Tab' && !event.metaKey && !event.altKey;
  if ((!arrow || event.shiftKey) && !emacs && !page && !tab) return undefined;
  if (!count) return -1;
  const down = event.key === 'ArrowDown' || event.key === 'PageDown' || event.key.toLowerCase() === 'n' || (tab && !event.shiftKey);
  if (arrow && (event.metaKey || event.ctrlKey)) return down ? count - 1 : 0;
  if (page || (arrow && event.altKey)) return Math.max(0, Math.min(count - 1, index + (down ? pageSize : -pageSize)));
  if (index < 0) return down ? 0 : count - 1;
  return (index + (down ? 1 : -1) + count) % count;
}
