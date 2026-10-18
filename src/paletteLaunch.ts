import { closePaletteWindowForShortcut, isNativePage, togglePaletteWindow } from './paletteWindow';

/** Remove action popups left by older versions, including per-tab overrides. */
export async function clearToolbarPopups() {
  await chrome.action.setPopup({ popup: '' });
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(tab => tab.id === undefined ? undefined
    : chrome.action.setPopup({ tabId: tab.id, popup: '' }).catch(() => {})));
}

const toolbarReady = clearToolbarPopups().catch(error => console.warn('justonehop: unable to clear old toolbar popups.', error));
const opening = new Set<number>();
export async function launchPalette(tab: chrome.tabs.Tab) {
  if (tab.id === undefined || opening.has(tab.id)) return;
  opening.add(tab.id);
  try {
    await toolbarReady;
    if (await closePaletteWindowForShortcut(tab)) return;
    await chrome.action.setPopup({ tabId: tab.id, popup: '' });
    if (isNativePage(tab)) { await togglePaletteWindow(tab); return; }
    try {
      // Other content listeners can accept a message without answering it.
      const ready = await chrome.tabs.sendMessage(tab.id, { source: 'justonehop', type: 'ping' }, { frameId: 0 }).catch(() => false);
      if (ready !== true) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      const shown = await chrome.tabs.sendMessage(tab.id, { source: 'justonehop', type: 'toggle' }, { frameId: 0 });
      if (shown === true) return;
    } catch { /* Pages that cannot host the overlay use a standalone window. */ }
    const source = await chrome.tabs.get(tab.id);
    if (!source.active || source.windowId !== tab.windowId ||
        (source.pendingUrl || source.url) !== (tab.pendingUrl || tab.url)) return;
    await togglePaletteWindow(source);
  } finally { opening.delete(tab.id); }
}
