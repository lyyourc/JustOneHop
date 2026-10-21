import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignPanelWindow, nativePanelBounds, panelRect, panelWindowFrame } from '../src/panelGeometry';

test('panel geometry matches normal, narrow, short and tall overlay viewports', () => {
  const normal = panelRect({ left: 0, top: 0, width: 1100, height: 760 });
  assert.ok(Math.abs(normal.top - 121.6) < .001);
  assert.deepEqual({ ...normal, top: 0 }, { left: 175, top: 0, width: 750, height: 516 });
  assert.deepEqual(panelRect({ left: 0, top: 0, width: 390, height: 440 }), { left: 10, top: 24, width: 370, height: 392 });
  assert.deepEqual(panelRect({ left: 0, top: 0, width: 750, height: 300 }), { left: 24, top: 48, width: 702, height: 228 });
  assert.equal(panelRect({ left: 0, top: 0, width: 1100, height: 1400 }).top, 150);
});

test('native bounds include measured window decorations and preserve negative monitor coordinates', () => {
  const owner = { left: -1400, top: 40, width: 1200, height: 900 };
  const tab = { width: 1200, height: 800 };
  const frame = { left: 1, top: 28, width: 2, height: 29 };
  const bounds = nativePanelBounds(owner, tab, frame);
  assert.deepEqual(bounds, { left: -1176, top: 156, width: 752, height: 545 });
  assert.equal(bounds.left + frame.left + (bounds.width - frame.width) / 2, -800);
  // Browser top + 16% of its 900 DIP height, independent of source chrome.
  assert.equal(bounds.top + frame.top, 184);
  for (const width of [960, 720]) {
    const sidebar = nativePanelBounds(owner, { width, height: 700 }, frame);
    assert.equal(sidebar.left + frame.left + (sidebar.width - frame.width) / 2, -800);
    assert.equal(sidebar.top + frame.top, 184);
  }
});

test('native bounds apply CSS limits and breakpoints before converting page zoom to screen DIPs', () => {
  const owner = { left: 22, top: 55, width: 1200, height: 905 };
  const tab = { width: 1200, height: 818 };
  const frame = { left: 0, top: 32, width: 0, height: 32 };
  assert.deepEqual(nativePanelBounds(owner, tab, frame, 1.25), { left: 153, top: 168, width: 938, height: 677 });
  assert.deepEqual(nativePanelBounds(owner, tab, frame, .8), { left: 322, top: 143, width: 600, height: 445 });
  // 640 screen DIPs at 125% is a narrow 512 CSS-px viewport (20px gutters).
  assert.deepEqual(nativePanelBounds({ left: 0, top: 0, width: 640, height: 700 },
    { width: 640, height: 600 }, frame, 1.25), { left: 13, top: -2, width: 615, height: 572 });
});

test('popup frame uses native tab dimensions rather than initial or zoomed DOM dimensions', () => {
  assert.deepEqual(panelWindowFrame({ width: 938, height: 682 }, { width: 938, height: 650 }),
    { left: 0, top: 32, width: 0, height: 32 });
  assert.deepEqual(panelWindowFrame({ width: 940, height: 683 }, { width: 938, height: 650 }),
    { left: 1, top: 32, width: 2, height: 33 });
  assert.equal(panelWindowFrame({ width: 938, height: 682 }, { width: 0, height: 0 }), undefined);
  assert.equal(panelWindowFrame({ width: 938, height: 682 }, { width: 1100, height: 760 }), undefined);
});

test('alignment isolates popup zoom and measures its frame independently of startup innerWidth', async () => {
  const previousChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const calls: unknown[][] = [];
  const owner = { id: 1, left: 22, top: 55, width: 1200, height: 905 };
  const source = { id: 2, windowId: 1, width: 1200, height: 818 };
  const popup = { id: 3, width: 938, height: 694 };
  const ownTab = { id: 4, windowId: 3, width: 938, height: 662 };
  // Initial about:blank dimensions are deliberately unrelated to the popup.
  const viewport = { innerWidth: 1100, innerHeight: 760 };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: viewport });
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
    windows: { get: async () => owner, getCurrent: async () => popup, update: async (id: number, bounds: { width: number; height: number }) => {
      calls.push(['bounds', id, bounds]); viewport.innerWidth = Math.round(bounds.width / 1.25); viewport.innerHeight = Math.round((bounds.height - 32) / 1.25);
    } },
    tabs: { get: async () => source, getCurrent: async () => ownTab, getZoom: async () => 1.25,
      setZoomSettings: async (...args: unknown[]) => { calls.push(['settings', ...args]); },
      setZoom: async (...args: unknown[]) => { calls.push(['zoom', ...args]); } },
  } });
  try {
    await alignPanelWindow(source.id, owner.id);
    assert.deepEqual(calls, [
      ['settings', ownTab.id, { mode: 'automatic', scope: 'per-tab' }], ['zoom', ownTab.id, 1.25],
      ['bounds', popup.id, { left: 153, top: 168, width: 938, height: 677 }],
    ]);
  } finally {
    if (previousChrome) Object.defineProperty(globalThis, 'chrome', previousChrome); else Reflect.deleteProperty(globalThis, 'chrome');
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});
