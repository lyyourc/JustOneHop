export interface PanelRect { left: number; top: number; width: number; height: number }
export interface WindowFrame { left: number; top: number; width: number; height: number }

/** Match .justonehop-app.overlay inside the source tab's content viewport. */
export function panelRect(viewport: PanelRect): PanelRect {
  const narrow = viewport.width <= 520;
  const inset = narrow ? 24 : Math.min(150, Math.max(28, viewport.height * .16));
  const width = Math.max(1, Math.min(750, viewport.width - (narrow ? 20 : 48)));
  return { left: viewport.left + (viewport.width - width) / 2, top: viewport.top + inset,
    width, height: Math.max(1, Math.min(516, viewport.height - inset - 24)) };
}

/** Tabs/windows use screen DIPs; panelRect uses CSS px. Size from the source
 *  viewport, but anchor to the browser window: sidebar origins are not exposed. */
export function nativePanelBounds(owner: Pick<chrome.windows.Window, 'left' | 'top' | 'width' | 'height'>,
  tab: Pick<chrome.tabs.Tab, 'width' | 'height'>, frame: WindowFrame = { left: 0, top: 44, width: 0, height: 44 }, zoom = 1): PanelRect {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const outerWidth = owner.width || 1100, outerHeight = owner.height || 760;
  const width = Math.min(outerWidth, tab.width || outerWidth);
  const height = Math.min(outerHeight, tab.height || Math.max(1, outerHeight - 88));
  const rect = panelRect({ left: 0, top: 0, width: width / scale, height: height / scale });
  const anchor = panelRect({ left: 0, top: 0, width: outerWidth / scale, height: outerHeight / scale });
  return { left: Math.round((owner.left || 0) + (outerWidth - rect.width * scale) / 2 - frame.left),
    top: Math.round((owner.top || 0) + anchor.top * scale - frame.top),
    width: Math.round(rect.width * scale + frame.width), height: Math.round(rect.height * scale + frame.height) };
}

/** Measure native decorations in one coordinate space. window.innerWidth is CSS
 *  px, can still describe the initial document, and changes when zoom is applied. */
export function panelWindowFrame(popup: Pick<chrome.windows.Window, 'width' | 'height'>,
  tab: Pick<chrome.tabs.Tab, 'width' | 'height'>): WindowFrame | undefined {
  if (!popup.width || !popup.height || !tab.width || !tab.height || tab.width > popup.width || tab.height > popup.height) return;
  const width = popup.width - tab.width, height = popup.height - tab.height;
  return { left: width / 2, top: height - width / 2, width, height };
}

/** Correct the initial estimate before rendering, including per-tab page zoom. */
export async function alignPanelWindow(sourceTabId: number, sourceWindowId: number) {
  const [owner, tab, popup, ownTab, zoom] = await Promise.all([chrome.windows.get(sourceWindowId), chrome.tabs.get(sourceTabId),
    chrome.windows.getCurrent(), chrome.tabs.getCurrent(), chrome.tabs.getZoom(sourceTabId)]);
  if (popup.id === undefined || !ownTab?.id || tab.windowId !== sourceWindowId || popup.id === sourceWindowId) return;
  // Per-tab scope keeps this temporary panel from changing other extension pages.
  await chrome.tabs.setZoomSettings(ownTab.id, { mode: 'automatic', scope: 'per-tab' });
  await chrome.tabs.setZoom(ownTab.id, zoom);
  // A newly created popup can report its initial viewport until native layout has
  // caught up. Poll API dimensions briefly, without waiting on background rAF.
  let frame = panelWindowFrame(popup, ownTab);
  for (let attempt = 0; !frame && attempt < 5; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 20));
    const [livePopup, liveTab] = await Promise.all([chrome.windows.get(popup.id), chrome.tabs.get(ownTab.id)]);
    frame = panelWindowFrame(livePopup, liveTab);
  }
  if (!frame) return;
  const expected = nativePanelBounds(owner, tab, frame, zoom);
  await chrome.windows.update(popup.id, expected);
  // The update/zoom promises can resolve before the document's resize arrives.
  // Wait for its CSS viewport, with a bound even when the popup is unfocused.
  for (let attempt = 0; attempt < 5 && (Math.abs(window.innerWidth * zoom - (expected.width - frame.width)) > zoom ||
      Math.abs(window.innerHeight * zoom - (expected.height - frame.height)) > zoom); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
