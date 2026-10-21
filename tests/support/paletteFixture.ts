import { test as base, expect, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, mkdir, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { browserPath } from './browserPath';
import { resolve, join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { acquireResource } from './resourceLock';

export type Environment = {
  locale: 'en-US' | 'zh-CN' | 'zh-TW' | 'fr-FR';
  shadow: 'closed' | 'open';
  pageAccess: boolean;
  cookieDomains: boolean;
  commands: boolean;
  toolbarMenus: boolean;
  headed: boolean;
  verticalTabs: boolean;
  vimium: boolean;
};
export const defaults: Environment = { locale: 'zh-CN', shadow: 'closed', pageAccess: false,
  cookieDomains: false, commands: false, toolbarMenus: false, headed: false, verticalTabs: false, vimium: false };
export const test = base.extend<{ environment: Environment; clipboardResource: void }>({
  environment: [defaults, { option: true }],
  clipboardResource: [async ({}, use, testInfo) => {
    const started = performance.now();
    const release = testInfo.tags.includes('@clipboard')
      ? await acquireResource(join(process.env.JUSTONEHOP_E2E_RUN_DIR!, 'clipboard.lock')) : undefined;
    testInfo.annotations.push({ type: 'resource-wait-ms', description: String(Math.round(performance.now() - started)) });
    try { await use(); }
    finally { await release?.(); }
  }, { auto: true, timeout: 150_000 }],
});

let server: Server;
export let origin: string;
export let context: BrowserContext;
export let ui: Page;
export let worker: Worker;
let profile: string;
export let popupUrl: string;
let testExtension: string | undefined;
let nativeWindowEvents: { event: string; url: string; at: number }[] = [];
let browserStarted = false;
async function closeFixture(timing: Record<string, number> = {}) {
  const closing = performance.now();
  try {
    if (browserStarted) await context.close();
  } finally {
    timing.browserCloseMs = Math.round(performance.now() - closing);
    browserStarted = false;
    const removing = performance.now();
    try {
      await Promise.all([profile, testExtension].filter((path): path is string => Boolean(path))
        .map(path => rm(path, { recursive: true, force: true })));
    } finally { timing.profileRemoveMs = Math.round(performance.now() - removing); }
  }
}

// Playwright runs spec files sequentially in each worker. Register hooks for every
// file explicitly; importing this module alone must not register a cached hook set.
export function registerPaletteFixture() {
  test.beforeAll(async () => {
    const favicon = await readFile(resolve('dist/icon32.png'));
    server = createServer((request, response) => {
      if (request.url === '/fixture-icon.png') { response.setHeader('Content-Type', 'image/png'); response.end(favicon); return; }
      const title = new URL(request.url!, 'http://local').pathname.slice(1).replaceAll('-', ' ') || 'Workspace';
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (title === 'Focus fixture') response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-src 'none'");
      response.end(`<!doctype html><title>${title}</title>${title.startsWith('Favicon') ? '<link rel="icon" href="/fixture-icon.png">' : ''}<h1>${title}</h1><input aria-label="Page input" />`);
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  test.afterAll(() => { server.close(); });
  test.beforeEach(async ({ environment }, testInfo) => {
    const started = performance.now();
    browserStarted = false;
    profile = '';
    testExtension = undefined;
    nativeWindowEvents = [];
    testInfo.annotations.push({ type: 'browser-environment', description: JSON.stringify(environment) });
    test.skip(environment.vimium && !process.env.JUSTONEHOP_VIMIUM_PATH, 'Vimium compatibility requires JUSTONEHOP_VIMIUM_PATH pointing to an unpacked extension.');
    if (environment.vimium && environment.shadow === 'open') throw new Error('Vimium compatibility requires production closed shadow roots.');
    profile = await mkdtemp(join(tmpdir(), 'justonehop-e2e-'));
    const { verticalTabs } = environment;
    if (verticalTabs) {
      await mkdir(join(profile, 'Default'));
      await writeFile(join(profile, 'Default/Preferences'), JSON.stringify({ vertical_tabs: { enabled: true } }));
    }
    let extension = resolve('dist');
    testExtension = undefined;
    if (environment.pageAccess || environment.shadow === 'open' || environment.cookieDomains) {
      testExtension = `${profile}-extension`;
      await cp(extension, testExtension, { recursive: true });
      const manifest = JSON.parse(await readFile(join(testExtension, 'manifest.json'), 'utf8'));
      // Headless Chrome cannot press the toolbar accelerator that grants activeTab.
      // Grant only the loopback fixture in this temporary test copy; production is unchanged.
      manifest.host_permissions = ['*://127.0.0.1/*'];
      if (environment.cookieDomains) manifest.host_permissions.push('*://app.example.test/*', '*://example.test/*');
      await writeFile(join(testExtension, 'manifest.json'), JSON.stringify(manifest));
      if (environment.shadow === 'open') {
        // Open only the test copy's shadow roots so Playwright can inspect the real iframe UI.
        const content = join(testExtension, 'content.js');
        const source = await readFile(content, 'utf8');
        expect(source.match(/mode:"closed"/g), 'Both production shadow roots must be patched in the visual fixture').toHaveLength(2);
        await writeFile(content, source.replaceAll('mode:"closed"', 'mode:"open"'));
      }
      extension = testExtension;
    }
    if (environment.commands) {
      if (!testExtension) {
        testExtension = `${profile}-extension`;
        await cp(extension, testExtension, { recursive: true });
      }
      const background = join(testExtension, 'background.js');
      // Invoke the real registered command callback in headless Chrome. No test RPC
      // or global hook is shipped in the production extension.
      const hook = `globalThis.__recentCommands = []; const addCommand = chrome.commands.onCommand.addListener.bind(chrome.commands.onCommand); chrome.commands.onCommand.addListener = callback => { globalThis.__recentCommands.push(callback); addCommand(callback); };\n`;
      const focusDiagnostics = environment.headed ? `
  const nativeFocusEvents = globalThis.__nativeFocusEvents = [];
  const recordNativeFocus = (event, data) => {
    nativeFocusEvents.push({ event, data, at: Date.now() });
    if (nativeFocusEvents.length > 200) nativeFocusEvents.shift();
  };
  chrome.windows.onFocusChanged.addListener(id => recordNativeFocus('focus-changed', { id }));
  chrome.windows.onRemoved.addListener(id => recordNativeFocus('window-removed', { id }));
  for (const method of ['getLastFocused', 'create', 'update', 'remove']) {
    const original = chrome.windows[method].bind(chrome.windows);
    chrome.windows[method] = async (...args) => {
      recordNativeFocus(method + ':start', args);
      try {
        const result = await original(...args);
        recordNativeFocus(method + ':end', result && { id: result.id, focused: result.focused, type: result.type });
        return result;
      } catch (error) {
        recordNativeFocus(method + ':error', String(error));
        throw error;
      }
    };
  }
  ` : '';
      await writeFile(background, hook + focusDiagnostics + await readFile(background, 'utf8'));
      extension = testExtension;
    }
    if (environment.toolbarMenus) {
      if (!testExtension) {
        testExtension = `${profile}-extension`;
        await cp(extension, testExtension, { recursive: true });
      }
      const background = join(testExtension, 'background.js');
      // Capture registrations after Chrome accepts them and invoke the real click
      // callback. This does not inspect or interact with Chrome's native menu UI.
      const hook = `globalThis.__toolbarClicks = []; globalThis.__toolbarItems = {};
  const addMenuClick = chrome.contextMenus.onClicked.addListener.bind(chrome.contextMenus.onClicked);
  chrome.contextMenus.onClicked.addListener = callback => { globalThis.__toolbarClicks.push(callback); addMenuClick(callback); };
  const createMenu = chrome.contextMenus.create.bind(chrome.contextMenus);
  chrome.contextMenus.create = (properties, callback) => createMenu(properties, () => {
    if (!chrome.runtime.lastError) globalThis.__toolbarItems[properties.id] = properties;
    callback?.();
  });
  const updateMenu = chrome.contextMenus.update.bind(chrome.contextMenus);
  chrome.contextMenus.update = async (id, properties) => {
    await updateMenu(id, properties); globalThis.__toolbarItems[id] = { id, ...properties };
  };\n`;
      await writeFile(background, hook + await readFile(background, 'utf8'));
      extension = testExtension;
    }
    const { locale } = environment;
    let executablePath = await browserPath();
    if (process.platform === 'darwin') {
      // macOS Chrome takes its UI locale from Cocoa, not --lang or navigator.language.
      // Set it only for this child process, without changing the user's preferences.
      const launcher = join(profile, 'chrome-with-locale');
      const quoted = "'" + executablePath.replaceAll("'", "'\\''") + "'";
      await writeFile(launcher, `#!/bin/sh\nexec ${quoted} "$@" -AppleLanguages '(${locale})'\n`, { mode: 0o755 });
      executablePath = launcher;
    }
    // Open shadow roots used by visual storage tests change Vimium's focus detection.
    // The separate closed storage test exercises production isolation with Vimium.
    const vimium = environment.vimium ? resolve(process.env.JUSTONEHOP_VIMIUM_PATH!) : undefined;
    if (vimium) {
      const manifest = JSON.parse(await readFile(join(vimium, 'manifest.json'), 'utf8'));
      expect(JSON.stringify(manifest), 'JUSTONEHOP_VIMIUM_PATH must identify Vimium').toMatch(/vimium/i);
    }
    const prepared = performance.now();
    context = await chromium.launchPersistentContext(profile, {
      // Cocoa needs the separate AppleLanguages value above; headless Chrome also
      // treats it as a target, so adding about:blank fails with multiple targets.
      ignoreDefaultArgs: process.platform === 'darwin' ? ['about:blank'] : [],
      locale, headless: !environment.headed, reducedMotion: 'reduce', executablePath, viewport: environment.headed ? null : { width: 1100, height: 760 },
      args: [...(verticalTabs ? ['--enable-features=VerticalTabs'] : []), `--lang=${locale}`, `--disable-extensions-except=${[extension, vimium].filter(Boolean).join(',')}`, `--load-extension=${[extension, vimium].filter(Boolean).join(',')}`],
    });
    const launched = performance.now();
    browserStarted = true;
    if (environment.headed) context.on('page', page => {
      nativeWindowEvents.push({ event: 'created', url: page.url(), at: Date.now() });
      page.on('framenavigated', frame => {
        if (frame === page.mainFrame()) nativeWindowEvents.push({ event: 'navigated', url: page.url(), at: Date.now() });
      });
      page.on('close', () => nativeWindowEvents.push({ event: 'closed', url: page.url(), at: Date.now() }));
    });
    let justonehopWorker: Worker | undefined;
    let workerEvaluations = 0;
    let completedWorkerEvaluations = 0;
    let lastWorkerError: string | undefined;
    try {
      await expect.poll(async () => {
        for (const candidate of context.serviceWorkers()) {
          workerEvaluations++;
          const isJustOneHop = await candidate.evaluate(() => Boolean(chrome.runtime.getManifest().commands?.['toggle-palette'])).catch(error => {
            lastWorkerError = String(error);
            return false;
          });
          completedWorkerEvaluations++;
          if (isJustOneHop) { justonehopWorker = candidate; return true; }
        }
        return false;
      }).toBe(true);
    } finally {
      // Preserve startup evidence even when readiness fails before the UI is created.
      testInfo.annotations.push({ type: 'worker-readiness', description: JSON.stringify({
        prepareMs: Math.round(prepared - started), launchMs: Math.round(launched - prepared),
        workerMs: Math.round(performance.now() - launched), ready: Boolean(justonehopWorker),
        workerUrls: context.serviceWorkers().map(candidate => candidate.url()),
        workerEvaluations, completedWorkerEvaluations, lastWorkerError,
      }) });
    }
    worker = justonehopWorker!;
    const ready = performance.now();
    ui = await context.newPage();
    const session = await context.newCDPSession(ui);
    const browser = await session.send('Browser.getVersion');
    testInfo.annotations.push({ type: 'browser-version', description: browser.product });
    await session.detach();
    if (vimium) {
      await expect.poll(async () => Promise.all(context.serviceWorkers().map(candidate => candidate.evaluate(() => chrome.runtime.getManifest().name).catch(() => '')))).toContain('Vimium');
      testInfo.annotations.push({ type: 'compatibility', description: 'Vimium service worker loaded' });
    }
    popupUrl = worker.url().replace('background.js', 'popup.html');
    await ui.goto(popupUrl);
    await expect(ui.locator('.result.command')).toHaveCount(9);
    testInfo.annotations.push({ type: 'fixture-timing', description: JSON.stringify({
      prepareMs: Math.round(prepared - started), launchMs: Math.round(launched - prepared),
      workerMs: Math.round(ready - launched), uiMs: Math.round(performance.now() - ready),
    }) });
  });
  test.afterEach(async ({ environment }, testInfo) => {
    const started = performance.now();
    try {
      if (browserStarted && environment.headed && testInfo.status !== testInfo.expectedStatus) {
        const state = await worker.evaluate(async () => ({
          windows: await chrome.windows.getAll({ populate: true }),
          session: await chrome.storage.session.get(['justonehopPaletteWindow']),
          focusEvents: (globalThis as unknown as { __nativeFocusEvents?: unknown[] }).__nativeFocusEvents ?? [],
        })).catch(error => ({ error: String(error) }));
        const path = testInfo.outputPath('native-window-lifecycle.json');
        await writeFile(path, JSON.stringify({ events: nativeWindowEvents, state }, null, 2));
        await testInfo.attach('native-window-lifecycle', { path, contentType: 'application/json' });
      }
    } finally {
      const timing: Record<string, number> = {};
      try { await closeFixture(timing); }
      finally {
        testInfo.annotations.push({ type: 'fixture-cleanup-ms', description: String(Math.round(performance.now() - started)) });
        testInfo.annotations.push({ type: 'fixture-close-timing', description: JSON.stringify(timing) });
      }
    }
  });
}

export function setUI(page: Page) { ui = page; }
export function setWorker(next: Worker) { worker = next; }
