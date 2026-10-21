import type { BrowserContext, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RecentOverlaySession } from '../../src/RecentOverlay';
import type { Reply } from '../../src/types';
import { test as uiTest, expect } from './ui';
import type { Preferences } from '../../src/preferences';
import type { Execution, HistorySearchResult, Request, Snapshot, TabItem } from '../../src/types';

export const fixtureOrigin = 'https://fixture.test';
export function snapshotTab(id: number, path: string): TabItem {
  return { id, windowId: 1, index: id - 1, title: path.replaceAll('-', ' '), url: `${fixtureOrigin}/${path}`,
    active: false, pinned: false, muted: false, audible: false, groupId: -1 };
}

type StorageRequest = { operation: 'get'; keys: string | string[] | Record<string, unknown> | null }
  | { operation: 'set'; items: Record<string, unknown> };
type BoundaryRequest = Request | { source: 'justonehop-recent'; type: 'accept-overlay' | 'cancel-overlay'; session: string; tabId?: number };
type Options = {
  locale?: 'en-US' | 'zh-CN'; snapshot?: Partial<Snapshot>; history?: 'controlled'; startupFailure?: boolean;
  // Explicit responses only: the fixture does not implement Chrome or learning algorithms.
  reply?: (request: BoundaryRequest) => Reply<unknown> | undefined | Promise<Reply<unknown> | undefined>;
  overlay?: true | RecentOverlaySession;
  clipboard?: 'record-success';
};
type HistoryRequest = { query: string; scope: 'week' | 'all'; release: () => void };

async function createPaletteUI(context: BrowserContext, ui: Page) {
  // Each test owns this backing store; reloading replaces listeners but preserves saved data.
  const store: Record<string, unknown> = {
    preferences: { language: 'system', theme: 'system', autoTuck: false, autoTuckAfterHours: 168 } satisfies Preferences,
    searchUsage: [],
  };
  const unexpected: string[] = [];
  const historyRequests: HistoryRequest[] = [];
  const requests: BoundaryRequest[] = [];
  let failSave = false;
  let saveGate: Promise<void> | undefined;
  let releaseSave: (() => void) | undefined;
  const rejectUnexpected = (detail: string): never => {
    unexpected.push(detail);
    throw new Error(`Unexpected palette UI API: ${detail}`);
  };
  await context.exposeBinding('__paletteStorage', async (_source, request: StorageRequest) => {
    if (request.operation === 'get') {
      if (request.keys === null) return structuredClone(store);
      const defaults = typeof request.keys === 'string' ? { [request.keys]: undefined }
        : Array.isArray(request.keys) ? Object.fromEntries(request.keys.map(key => [key, undefined])) : request.keys;
      for (const key of Object.keys(defaults)) if (!(key in store)) rejectUnexpected(`storage.get ${key}`);
      return structuredClone(Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, key in store ? store[key] : fallback])));
    }
    if (request.operation !== 'set' || Object.keys(request.items).some(key => key !== 'preferences')) {
      return rejectUnexpected(JSON.stringify(request));
    }
    if (failSave) { failSave = false; throw new Error('Test storage unavailable'); }
    const gate = saveGate; saveGate = undefined;
    await gate;
    const changes: Record<string, chrome.storage.StorageChange> = {};
    for (const [key, value] of Object.entries(request.items)) {
      changes[key] = { oldValue: structuredClone(store[key]), newValue: structuredClone(value) };
      store[key] = structuredClone(value);
    }
    return changes;
  });
  return {
    ui, store, unexpected, historyRequests, requests,
    async provideStorage(items: Record<string, unknown>) {
      const changes = Object.fromEntries(Object.entries(items).map(([key, newValue]) => [key, { oldValue: store[key], newValue }]));
      Object.assign(store, structuredClone(items));
      await ui.evaluate(changes => {
        (globalThis as unknown as { __paletteStorageChanged: (changes: Record<string, chrome.storage.StorageChange>) => void }).__paletteStorageChanged(changes);
      }, changes);
    },
    copies: () => ui.evaluate(() => (globalThis as unknown as { __paletteCopies: string[] }).__paletteCopies),
    async dispatch(message: Record<string, unknown>) {
      return ui.evaluate(message => (globalThis as unknown as { __paletteDispatch: (message: unknown) => Promise<unknown> }).__paletteDispatch(message), message);
    },
    failNextSave: () => { failSave = true; },
    holdNextSave: () => { saveGate = new Promise<void>(resolve => { releaseSave = resolve; }); },
    completeSave: () => { if (!releaseSave) throw new Error('No pending preference save'); releaseSave(); releaseSave = undefined; },
    executions: () => ui.evaluate(() => (globalThis as unknown as { __paletteExecutions: Execution[] }).__paletteExecutions),
    async open(options: Options = {}) {
      // The popup's own source tab exists in real snapshots. Address/Google actions
      // require it even though the current tab is absent from home recommendations.
      const source = { ...snapshotTab(1, 'source'), active: true };
      const snapshot: Snapshot = { windowId: 1, currentTabId: 1, bookmarks: [], shortcut: 'Alt+Space',
        ...options.snapshot, tabs: [source, ...(options.snapshot?.tabs ?? [])] };
      await context.exposeBinding('__paletteMessage', async (_source, request: BoundaryRequest) => {
        requests.push(structuredClone(request));
        const provided = await options.reply?.(request);
        if (provided !== undefined) return provided;
        if (request.source !== 'justonehop') return rejectUnexpected(JSON.stringify(request));
        if (options.startupFailure && ['snapshot', 'palette-state', 'cancel-palette-continuation'].includes(request.type)) {
          // A disconnected transport rejects; it does not return an application error reply.
          throw new Error('Receiving end does not exist');
        }
        if (request.type === 'snapshot') return { ok: true, data: snapshot };
        if (request.type === 'search-history') {
          const data = options.history === 'controlled'
            ? await new Promise<HistorySearchResult>(resolve => historyRequests.push({ ...request.payload, release: () => resolve({
              items: [{ id: request.payload.query, url: `${fixtureOrigin}/${encodeURIComponent(request.payload.query)}`,
                title: `${request.payload.query} remote`, lastVisitTime: Date.now() }], limited: false,
            }) })) : { items: [], limited: false };
          return { ok: true, data };
        }
        if (request.type === 'execute' && request.payload.action === 'settings') return { ok: true, data: undefined };
        if (request.type === 'tuck-status') return { ok: true, data: {
          enabled: (store.preferences as Preferences).autoTuck, eligibleCount: 0, blockedCount: 0, checkedAt: Date.now(),
        } };
        return rejectUnexpected(JSON.stringify(request));
      });
      await context.addInitScript(({ locale, overlay, clipboard }) => {
        const state = globalThis as unknown as {
          __paletteStorage: (request: StorageRequest) => Promise<Record<string, unknown>>;
          __paletteMessage: (request: Request) => Promise<unknown>;
          __paletteExecutions: Execution[];
          __paletteCopies: string[];
          __paletteStorageChanged: (changes: Record<string, chrome.storage.StorageChange>) => void;
          __paletteDispatch: (message: unknown) => Promise<unknown>;
        };
        state.__paletteExecutions = []; state.__paletteCopies = [];
        const listeners = new Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>();
        const messages = new Set<(message: unknown, sender: { id: string }, reply: (value: unknown) => void) => unknown>();
        state.__paletteStorageChanged = changes => listeners.forEach(listener => listener(changes, 'local'));
        state.__paletteDispatch = message => new Promise(resolve => {
          for (const listener of messages) listener(message, { id: 'abcdefghijklmnopabcdefghijklmnop' }, resolve);
        });
        if (overlay) {
          // Only expose the actual built content surface to locators; preserve its iframe and styles.
          const attachShadow = Element.prototype.attachShadow;
          Element.prototype.attachShadow = function(init) { return attachShadow.call(this, { ...init, mode: 'open' }); };
          const contentDocument = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentDocument')!;
          Object.defineProperty(HTMLIFrameElement.prototype, 'contentDocument', { ...contentDocument, get() {
            const doc = contentDocument.get!.call(this) as Document | null;
            if (doc) {
              const frame = doc.defaultView as Window & typeof globalThis;
              frame.Element.prototype.attachShadow = Element.prototype.attachShadow;
              if (clipboard) doc.execCommand = document.execCommand.bind(doc);
            }
            return doc;
          } });
        }
        if (clipboard) {
          Document.prototype.execCommand = function(command) {
            if (command !== 'copy') throw new Error(`Unexpected UI edit command: ${command}`);
            let active = this.activeElement;
            while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
            state.__paletteCopies.push((active as HTMLTextAreaElement).value);
            return true;
          };
          Object.defineProperty(navigator.clipboard, 'writeText', { value: async (text: string) => { state.__paletteCopies.push(text); } });
        }
        Object.assign(globalThis, { chrome: {
          i18n: { getUILanguage: () => locale },
          storage: {
            local: {
              get: (keys: string | string[] | Record<string, unknown> | null = null) => state.__paletteStorage({ operation: 'get', keys }),
              set: async (items: Record<string, unknown>) => {
                const changes = await state.__paletteStorage({ operation: 'set', items }) as Record<string, chrome.storage.StorageChange>;
                listeners.forEach(listener => listener(changes, 'local'));
              },
            },
            onChanged: {
              addListener: (listener: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) => { listeners.add(listener); },
              removeListener: (listener: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) => { listeners.delete(listener); },
            },
          },
          runtime: {
            id: 'abcdefghijklmnopabcdefghijklmnop',
            getURL: (path: string) => new URL(path, 'https://justonehop.test/').href,
            onMessage: {
              addListener: (listener: (message: unknown, sender: { id: string }, reply: (value: unknown) => void) => unknown) => { messages.add(listener); },
              removeListener: (listener: (message: unknown, sender: { id: string }, reply: (value: unknown) => void) => unknown) => { messages.delete(listener); },
            },
            connect: (options: { name: string }) => {
              if (options.name !== 'justonehop') throw new Error(`Unexpected UI port: ${options.name}`);
              return { onMessage: { addListener: () => {} }, onDisconnect: { addListener: () => {} }, disconnect: () => {} };
            },
            sendMessage: (request: Request) => {
              if (request.type === 'execute') state.__paletteExecutions.push(structuredClone(request.payload));
              return state.__paletteMessage(request);
            },
          },
        } });
      }, { locale: options.locale ?? 'zh-CN', overlay: !!options.overlay, clipboard: !!options.clipboard });
      if (options.overlay) {
        await ui.route(`${fixtureOrigin}/source`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>UI fixture source</title><body></body>' }));
        await ui.goto(`${fixtureOrigin}/source`);
        await ui.addScriptTag({ content: await readFile(resolve('dist/content.js'), 'utf8') });
        const message = options.overlay === true ? { source: 'justonehop', type: 'toggle' }
          : { source: 'justonehop-recent', type: 'open-overlay', ...options.overlay };
        expect(await ui.evaluate(message => (globalThis as unknown as { __paletteDispatch: (message: unknown) => Promise<unknown> }).__paletteDispatch(message), message)).toBe(true);
      } else await ui.goto('https://justonehop.test/popup.html');
      if (!options.startupFailure && !options.overlay) await expect(ui.locator('.result.command').first()).toBeVisible();
    },
  };
}

export const test = uiTest.extend<{ palette: Awaited<ReturnType<typeof createPaletteUI>> }>({
  palette: async ({ context, page }, use) => {
    const palette = await createPaletteUI(context, page);
    await use(palette);
    // Even if production catches an unexpected request, the test must fail explicitly.
    expect(palette.unexpected).toEqual([]);
  },
});
export { expect } from './ui';
