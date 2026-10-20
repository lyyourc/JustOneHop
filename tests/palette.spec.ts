import { test as base, expect, chromium, type BrowserContext, type Locator, type Page, type Worker } from '@playwright/test';
import { focusClosedButton, pressNativeEnter } from './support/nativeInput';
import { mkdtemp, mkdir, rm, readdir, access, cp, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { UsageRecord } from '../src/usage';

type Environment = {
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
const defaults: Environment = { locale: 'zh-CN', shadow: 'closed', pageAccess: false,
  cookieDomains: false, commands: false, toolbarMenus: false, headed: false, verticalTabs: false, vimium: false };
const test = base.extend<{ environment: Environment }>({ environment: [defaults, { option: true }] });

let server: Server;
let origin: string;
let context: BrowserContext;
let ui: Page;
let worker: Worker;
let profile: string;
let popupUrl: string;
let testExtension: string | undefined;
let nativeWindowEvents: { event: string; url: string; at: number }[] = [];
let browserStarted = false;

async function browserPath() {
  if (process.env.JUSTONEHOP_CHROMIUM_PATH) return process.env.JUSTONEHOP_CHROMIUM_PATH;
  try { await access(chromium.executablePath()); return chromium.executablePath(); } catch {}
  if (process.platform === 'darwin') {
    const cache = join(homedir(), 'Library/Caches/ms-playwright');
    for (const dir of (await readdir(cache)).filter(name => /^chromium-\d+$/.test(name)).sort().reverse()) {
      const path = join(cache, dir, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
      try { await access(path); return path; } catch {}
    }
  }
  return chromium.executablePath();
}

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
test.afterAll(async () => { server.close(); });
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
    await writeFile(background, hook + await readFile(background, 'utf8'));
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
  await expect.poll(async () => {
    for (const candidate of context.serviceWorkers()) {
      const isJustOneHop = await candidate.evaluate(() => Boolean(chrome.runtime.getManifest().commands?.['toggle-palette'])).catch(() => false);
      if (isJustOneHop) { justonehopWorker = candidate; return true; }
    }
    return false;
  }).toBe(true);
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
      })).catch(error => ({ error: String(error) }));
      const path = testInfo.outputPath('native-window-lifecycle.json');
      await writeFile(path, JSON.stringify({ events: nativeWindowEvents, state }, null, 2));
      await testInfo.attach('native-window-lifecycle', { path, contentType: 'application/json' });
    }
  } finally {
    try { if (browserStarted) await context.close(); }
    finally {
      await Promise.all([profile, testExtension].filter((path): path is string => Boolean(path))
        .map(path => rm(path, { recursive: true, force: true })));
      testInfo.annotations.push({ type: 'fixture-cleanup-ms', description: String(Math.round(performance.now() - started)) });
    }
  }
});

async function dragResultText(page: Page, row: Locator) {
  const title = row.locator('.entry-title');
  await title.scrollIntoViewIfNeeded();
  const box = await title.boundingBox();
  expect(box!.width).toBeGreaterThan(35);
  // Send trusted pointer events directly: Playwright's drag interception can stall inside the overlay iframe.
  const pointer = await page.context().newCDPSession(page);
  const x = box!.x + 3, end = box!.x + Math.min(box!.width - 3, 85), y = box!.y + box!.height / 2;
  try {
    await pointer.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await pointer.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 12; step++) await pointer.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: x + (end - x) * step / 12, y, button: 'left', buttons: 1,
    });
    await pointer.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end, y, button: 'left', buttons: 0, clickCount: 1 });
  } finally { await pointer.detach(); }
  // A gesture alone is insufficient: prove Chrome actually selected row text.
  expect(await title.evaluate(node => {
    const root = node.getRootNode() as Node & { getSelection?: () => Selection | null };
    const selection = root.getSelection?.() ?? node.ownerDocument.getSelection();
    return selection && !selection.isCollapsed && selection.containsNode(node, true) ? selection.toString() : '';
  })).not.toBe('');
}

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test('URL actions: English exact copies preserve context and retry without navigation or learning', async () => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const urls = {
      tab: `${origin}/Urlcopy-tab?mode=tab&value=a%2Bb#tab-fragment`,
      bookmark: `${origin}/Urlcopy-bookmark?mode=bookmark&value=a%2Bb#bookmark-fragment`,
      history: `${origin}/Urlcopy-history?mode=history&value=a%2Bb#history-fragment`,
    };
    const baseline: UsageRecord[] = [{ query: 'unrelated', target: 'command:newTab', weight: 2, lastUsed: Date.now() }];
    const tabId = await worker.evaluate(async ({ urls, baseline }) => {
      await chrome.storage.local.set({ searchUsage: baseline });
      const tab = await chrome.tabs.create({ url: urls.tab, active: false });
      await chrome.bookmarks.create({ title: 'Urlcopy bookmark', url: urls.bookmark });
      await chrome.history.addUrl({ url: urls.history });
      return tab.id!;
    }, { urls, baseline });
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).status, tabId)).toBe('complete');
    await ui.bringToFront(); await ui.reload();
    const tabs = () => worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url, active: tab.active })));
    const beforeTabs = await tabs();
    const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    const actions = ui.getByRole('combobox', { name: 'Search actions' });
    const copy = ui.locator('.action-row').filter({ hasText: 'Copy URL' });
    async function copySelected(input: Locator, row: Locator, url: string, mouse: boolean, fail = false) {
      const query = await input.inputValue();
      await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
      if (mouse) await row.click({ button: 'right' });
      else { await expect(row).toHaveAttribute('aria-selected', 'true'); await input.press('Meta+k'); }
      await expect(actions).toBeFocused();
      await actions.fill('复制 URL');
      await expect(copy).toHaveCount(1);
      if (fail) {
        await ui.evaluate(() => {
          const exec = document.execCommand.bind(document), write = navigator.clipboard.writeText.bind(navigator.clipboard);
          document.execCommand = () => false;
          navigator.clipboard.writeText = async () => {
            document.execCommand = exec; navigator.clipboard.writeText = write;
            throw new Error('Clipboard fixture unavailable');
          };
        });
        await copy.click();
        await expect(ui.getByRole('alert')).toBeVisible();
        await expect(copy).toBeVisible();
        expect(await tabs()).toEqual(beforeTabs);
        expect(await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual(baseline);
      }
      if (mouse && !fail) await copy.click();
      else await actions.press('Enter');
      await expect(ui.locator('.action-menu')).toHaveCount(0);
      await expect(ui.getByText('URL copied', { exact: true })).toBeVisible();
      expect(await ui.evaluate(() => navigator.clipboard.readText())).toBe(url);
      await expect(input).toBeFocused(); await expect(input).toHaveValue(query);
      expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
      await expect(row).toHaveAttribute('aria-selected', 'true');
      await expect(ui.getByRole('alert')).toHaveCount(0);
      expect(await tabs()).toEqual(beforeTabs);
      expect(await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual(baseline);
    }
    for (const kind of ['tab', 'bookmark', 'history'] as const) {
      await search.fill(`Urlcopy ${kind}`);
      const row = ui.locator(`#justonehop-results .result.${kind}`);
      await expect(row).toHaveCount(1);
      if (kind === 'bookmark') {
        await dragResultText(ui, row);
        expect(await tabs()).toEqual(beforeTabs);
        await search.focus();
      }
      await copySelected(search, row, urls[kind], kind === 'bookmark', kind === 'bookmark');
    }
    await ui.locator('#justonehop-search-all-history').click();
    const fullSearch = ui.getByRole('combobox', { name: 'Search browsing history', exact: true });
    const history = ui.locator('.history-view .result.history');
    await expect(history).toHaveCount(1);
    await copySelected(fullSearch, history, urls.history, false, true);
    await fullSearch.press('Escape');
    // Use a real source page: an ordinary bookmark click navigates that tab.
    const source = await context.newPage(); await source.goto(`${origin}/Urlcopy-source`);
    const sourceId = await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0].id!, source.url());
    const surface = await openStorageOverlay(source);
    const sourceSearch = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await sourceSearch.fill('Urlcopy bookmark');
    await expect(surface.locator('.result.bookmark')).toHaveCount(1);
    await expect(surface.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
    const beforeNavigation = await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => tab.id));
    // The input's old selection must not suppress an ordinary row click.
    await sourceSearch.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
    await surface.locator('.result.bookmark .entry-title').click();
    await expect(source).toHaveURL(urls.bookmark);
    expect((await worker.evaluate(id => chrome.tabs.get(id), sourceId)).url).toBe(urls.bookmark);
    expect(await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => tab.id))).toEqual(beforeNavigation);
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual(expect.arrayContaining([
      ...baseline, expect.objectContaining({ query: 'urlcopy bookmark', weight: 1 }),
    ]));
  });

  test('History intent: bilingual commands enter an empty all-time search and restore root context', async () => {
    const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    for (const query of ['history', '历史', 'search all history']) {
      await input.fill(query);
      await expect(ui.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
      await expect(ui.locator('#justonehop-results .result').first()).toHaveAttribute('id', 'justonehop-search-all-history');
      await expect(ui.locator('#justonehop-search-all-history')).toHaveAttribute('aria-selected', 'true');
      if (query === '历史') await ui.locator('#justonehop-search-all-history').click();
      else await input.press('Enter');
      const history = ui.getByRole('combobox', { name: 'Search browsing history', exact: true });
      await expect(history).toBeFocused(); await expect(history).toHaveValue('');
      await expect(ui.getByText('Enter a title or URL to search history', { exact: true })).toBeVisible();
      if (query === '历史') await history.press('Escape');
      else await ui.locator('.history-view .footer-back').click();
      await expect(input).toBeFocused(); await expect(input).toHaveValue(query);
      await expect(ui.locator('#justonehop-search-all-history')).toHaveAttribute('aria-selected', 'true');
    }
    await input.fill('react history');
    await expect(ui.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
    await ui.locator('#justonehop-search-all-history').click();
    await expect(ui.getByRole('combobox', { name: 'Search browsing history', exact: true })).toHaveValue('react history');
  });

  test('History search: seventh entry follows six results and real visits support mouse opening and keyboard return', async () => {
    const query = 'JustOneHopHistoryNative';
    const urls = ['mouse', 'keyboard', 'third', 'fourth', 'fifth', 'sixth', 'seventh'].map(suffix => `${origin}/${query}-${suffix}`);
    const baseline: UsageRecord[] = [{ query: 'unrelated', target: 'command:newTab', weight: 1, lastUsed: Date.now() }];
    await worker.evaluate(async ({ urls, baseline }) => {
      await chrome.storage.local.set({ searchUsage: baseline });
      for (const url of urls) await chrome.history.addUrl({ url });
    }, { urls, baseline });
    // Independently confirm the fixture reached Chrome's actual history database.
    const visits = await worker.evaluate(text => chrome.history.search({ text, startTime: 0 }), query);
    expect(visits.map(visit => visit.url).sort()).toEqual([...urls].sort());
    expect(visits.every(visit => typeof visit.lastVisitTime === 'number')).toBe(true);
    const owner = await ui.evaluate(async () => (await chrome.tabs.getCurrent())!.windowId);
    const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    const allHistory = ui.locator('#justonehop-search-all-history');
    await search.fill(query);
    await expect(ui.locator('.result.history')).toHaveCount(urls.length);
    const mainTimes = await ui.locator('.result.history time').evaluateAll(nodes => nodes.map(node => ({ id: node.closest('.result')!.id, text: node.textContent, dateTime: node.getAttribute('datetime'), title: node.getAttribute('title') })));
    expect(mainTimes).toHaveLength(urls.length);
    expect(mainTimes.every(time => time.text === 'just now' && time.title?.startsWith('Last visited: '))).toBe(true);
    expect(mainTimes.map(time => Date.parse(time.dateTime!)).sort()).toEqual(visits.map(visit => Math.trunc(visit.lastVisitTime!)).sort());

    await expect(allHistory.locator('.entry-title')).toHaveText('Search All History');
    await expect(ui.locator('#justonehop-results .result').nth(6)).toHaveAttribute('id', 'justonehop-search-all-history');
    await ui.locator('.palette').screenshot({ path: test.info().outputPath('history-main-regular.png') });
    await search.press('Home'); await search.press('Shift+ArrowRight');
    for (let step = 0; step < 6; step++) await search.press('ArrowDown');
    await expect(allHistory).toHaveAttribute('aria-selected', 'true');
    await search.press('Enter');
    const historySearch = ui.getByRole('combobox', { name: 'Search browsing history', exact: true });
    await expect(historySearch).toBeFocused(); await expect(historySearch).toHaveValue(query);
    await expect(ui.locator('.history-view .result.history')).toHaveCount(urls.length);
    expect(await ui.locator('.history-view .result.history time').evaluateAll(nodes => nodes.map(node => ({ id: node.closest('.result')!.id, text: node.textContent, dateTime: node.getAttribute('datetime'), title: node.getAttribute('title') })))).toEqual(mainTimes);
    await expect(ui.locator('.history-view .history-kind')).toHaveCount(0);

    await ui.setViewportSize({ width: 390, height: 600 });
    await expect(historySearch).toBeVisible();
    await expect(ui.locator('.history-view .footer-back')).toBeVisible();
    expect(await ui.locator('.history-view').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await ui.locator('.history-view').screenshot({ path: test.info().outputPath('history-full-narrow.png') });
    await ui.setViewportSize({ width: 1100, height: 760 });
    await historySearch.press('Escape');
    await expect(search).toBeFocused(); await expect(search).toHaveValue(query);
    await expect(allHistory).toHaveAttribute('aria-selected', 'true');
    expect(await search.evaluate(el => [(el as HTMLInputElement).selectionStart, (el as HTMLInputElement).selectionEnd])).toEqual([0, 1]);
    // Mouse entry and footer return preserve the same root context.
    await allHistory.click(); await expect(historySearch).toBeFocused();
    await ui.locator('.history-view .footer-back').click();
    await expect(search).toBeFocused(); await expect(search).toHaveValue(query);
    const mouseOpened = context.waitForEvent('page');
    await ui.locator('.result.history').filter({ hasText: `${query}-mouse` }).click();
    const mousePage = await mouseOpened;
    await expect(mousePage).toHaveURL(urls[0]);
    await expect(mousePage.getByRole('heading')).toHaveText(`${query} mouse`);
    await expect.poll(() => ui.isClosed()).toBe(true);
    expect(await worker.evaluate(async url => (await chrome.tabs.query({})).filter(tab => tab.url === url).map(tab => tab.windowId), urls[0])).toEqual([owner]);
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual(expect.arrayContaining([
      ...baseline, expect.objectContaining({ query: query.toLowerCase(), target: `tab:${urls[0]}`, weight: 1 }),
    ]));

    ui = await context.newPage(); await ui.goto(popupUrl);
    const root = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await root.fill(`${query}-keyboard`);
    await expect(ui.locator('.result.history')).toHaveCount(1);
    await expect(ui.locator('#justonehop-results .result')).toHaveCount(2);
    await expect(ui.locator('#justonehop-results .result').last()).toHaveAttribute('id', 'justonehop-search-all-history');
    await root.press('ArrowUp');
    await expect(ui.locator('#justonehop-search-all-history')).toHaveAttribute('aria-selected', 'true');
    await root.press('Enter');
    const fullSearch = ui.getByRole('combobox', { name: 'Search browsing history', exact: true });
    await expect(fullSearch).toBeFocused();
    await expect(ui.locator('.history-view .result.history')).toHaveCount(1);
    const keyboardOpened = context.waitForEvent('page');
    await fullSearch.press('Enter');
    const keyboardPage = await keyboardOpened;
    await expect(keyboardPage).toHaveURL(urls[1]);
    await expect(keyboardPage.getByRole('heading')).toHaveText(`${query} keyboard`);
    await expect.poll(() => ui.isClosed()).toBe(true);
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual(expect.arrayContaining([
      ...baseline, expect.objectContaining({ query: `${query.toLowerCase()}-keyboard`, target: `tab:${urls[1]}`, weight: 1 }),
    ]));
  });

  test('History learning: c2c-web selection survives history-to-tab transition and forgets across views', async () => {
    const targetUrl = `${origin}/gitlab/c2c-web`;
    const otherUrl = `${origin}/other/c2c-web`;
    for (const url of [targetUrl, otherUrl]) {
      const visit = await context.newPage(); await visit.goto(url); await visit.close();
    }
    await ui.bringToFront();
    const input = () => ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await input().fill('c2c-web');
    await expect(ui.locator('.result.history')).toHaveCount(2);
    const target = ui.locator('.result.history').filter({ hasText: 'gitlab/c2c-web' });
    const opened = context.waitForEvent('page');
    await target.click();
    const openedPage = await opened;
    await expect(openedPage).toHaveURL(targetUrl);
    await expect.poll(() => ui.isClosed()).toBe(true);
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage?.[0])).toMatchObject({ query: 'c2c-web', target: `tab:${targetUrl}`, weight: 1 });
    ui = await context.newPage(); await ui.goto(popupUrl);
    await input().fill('c2c-web');
    const tab = ui.locator('.result.tab').filter({ hasText: 'gitlab/c2c-web' });
    await expect(tab.locator('button.ranking-forget')).toBeVisible();
    await expect(tab.locator('button.ranking-forget')).toHaveAccessibleName('Forget Preference for This Query');
    await expect(ui.locator('.ranking-badge')).toHaveCount(0);
    await expect(ui.locator('.result.history').filter({ hasText: 'gitlab/c2c-web' })).toHaveCount(0);
    await openedPage.close();
    await worker.evaluate(async url => chrome.history.addUrl({ url }), otherUrl);
    await input().fill(''); await input().fill('c2c-web');
    await expect(ui.locator('.result.history').filter({ hasText: 'gitlab/c2c-web' })).toHaveCount(1);
    await expect(ui.locator('.result.history').first()).toContainText('gitlab/c2c-web');
    await expect(ui.locator('.result.history').first().locator('button.ranking-forget')).toHaveAttribute('data-promoted', 'true');
    await ui.locator('#justonehop-search-all-history').click();
    const fullSearch = ui.getByRole('combobox', { name: 'Search browsing history', exact: true });
    await expect(fullSearch).toHaveValue('c2c-web');
    const fullTarget = ui.locator('.history-view .result.history').filter({ hasText: 'gitlab/c2c-web' });
    const forget = fullTarget.locator('button.ranking-forget');
    await expect(forget).toHaveAttribute('data-promoted', 'true');
    await expect(forget).toHaveAccessibleName('Forget Preference for This Query');
    await expect(forget).toHaveAttribute('tabindex', '0');
    await expect(ui.getByRole('tooltip')).toHaveCount(0);
    await fullSearch.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
    const beforeTabs = await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url })));
    // Actions no longer duplicates the inline explanation or forget action.
    await fullSearch.press('Meta+k');
    await expect(ui.getByRole('dialog')).toBeVisible();
    await expect(ui.locator('.action-description')).toHaveCount(0);
    await expect(ui.getByRole('dialog').getByRole('option', { name: 'Forget Preference for This Query', exact: false })).toHaveCount(0);
    await ui.getByRole('combobox', { name: 'Search actions' }).press('Shift+Backspace');
    await ui.keyboard.press('Escape');
    await expect(forget).toBeVisible();
    // Tab reaches the selected row's icon; Space forgets without opening history.
    for (let step = 0; step < 8 && !await forget.evaluate(node => node.matches(':focus')); step++) await ui.keyboard.press('Tab');
    await expect(forget).toBeFocused();
    const tooltip = ui.getByRole('tooltip');
    await expect(tooltip).toHaveClass(/ranking-tooltip/);
    await expect(tooltip).toHaveText('Forget Preference for This QueryShift+BackspaceMoved up by your preferences.');
    await ui.locator('.history-view').screenshot({ path: test.info().outputPath('history-learned-tooltip.png') });
    const historyRows = ui.locator('.history-view .result.history');
    const learnedOrder = await historyRows.evaluateAll(nodes => nodes.map(node => node.id));
    const historyScroll = await ui.locator('#justonehop-history-results').evaluate(node => node.scrollTop);
    await expect(fullTarget).toHaveAttribute('aria-selected', 'true');
    await ui.keyboard.press('Space');
    await expect(ui.getByRole('dialog')).toHaveCount(0);
    await expect(fullSearch).toBeFocused();
    await expect(fullSearch).toHaveValue('c2c-web');
    expect(await fullSearch.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
    await expect(fullTarget).toHaveAttribute('aria-selected', 'true');
    expect(await historyRows.evaluateAll(nodes => nodes.map(node => node.id))).toEqual(learnedOrder);
    expect(await ui.locator('#justonehop-history-results').evaluate(node => node.scrollTop)).toBe(historyScroll);
    await expect(ui.locator('button.ranking-forget')).toHaveCount(0);
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual([]);
    await fullSearch.fill('other/c2c-web');
    await expect(historyRows).toHaveCount(1);
    await fullSearch.fill('c2c-web');
    await expect(historyRows.first()).toContainText('other/c2c-web');
    // The full-history list also owns Shift+Backspace, with the same IME/repeat guards.
    await worker.evaluate(async url => chrome.storage.local.set({ searchUsage: [{ query: 'c2c-web', target: `tab:${url}`, weight: 1, lastUsed: Date.now() }] }), targetUrl);
    await expect(forget).toBeVisible();
    await expect(historyRows.first()).toContainText('gitlab/c2c-web');
    await fullSearch.press('Meta+ArrowUp');
    await expect(fullTarget).toHaveAttribute('aria-selected', 'true');
    await fullSearch.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
    const shortcutOrder = await historyRows.evaluateAll(nodes => nodes.map(node => node.id));
    const shortcutScroll = await ui.locator('#justonehop-history-results').evaluate(node => node.scrollTop);
    for (const guard of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { metaKey: true }]) {
      await fullSearch.dispatchEvent('keydown', { key: 'Backspace', shiftKey: true, ...guard });
    }
    expect(await worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage: UsageRecord[] }>('searchUsage')).searchUsage)).toEqual([
      expect.objectContaining({ query: 'c2c-web', target: `tab:${targetUrl}` }),
    ]);
    await fullSearch.press('Shift+Backspace');
    await expect(forget).toHaveCount(0);
    await expect(fullSearch).toBeFocused();
    await expect(fullSearch).toHaveValue('c2c-web');
    expect(await fullSearch.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
    await expect(fullTarget).toHaveAttribute('aria-selected', 'true');
    expect(await historyRows.evaluateAll(nodes => nodes.map(node => node.id))).toEqual(shortcutOrder);
    expect(await ui.locator('#justonehop-history-results').evaluate(node => node.scrollTop)).toBe(shortcutScroll);
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual([]);
    await fullSearch.press('Escape');
    await expect(input()).toBeFocused();
    // The root view did not perform the forget and receives the storage update normally.
    await expect(ui.locator('.result.history').first()).toContainText('other/c2c-web');
    await worker.evaluate(async url => chrome.storage.local.set({ searchUsage: [{ query: 'c2c-web', target: `tab:${url}`, weight: 1, lastUsed: Date.now() }] }), targetUrl);
    await expect(ui.locator('.result.history').first()).toContainText('gitlab/c2c-web');
    await input().press('Meta+ArrowUp');
    await expect(ui.locator('.result.history').first()).toHaveAttribute('aria-selected', 'true');
    await input().evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
    const rootOrder = await ui.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id));
    const rootScroll = await ui.locator('#justonehop-results').evaluate(node => node.scrollTop);
    await input().press('Shift+Backspace');
    await expect(ui.locator('button.ranking-forget')).toHaveCount(0);
    expect(await ui.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(rootOrder);
    await expect(ui.locator('.result.history').first()).toHaveAttribute('aria-selected', 'true');
    expect(await ui.locator('#justonehop-results').evaluate(node => node.scrollTop)).toBe(rootScroll);
    await expect(input()).toBeFocused();
    await expect(input()).toHaveValue('c2c-web');
    expect(await input().evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual([]);
    expect(await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url })))).toEqual(beforeTabs);
    expect(ui.isClosed()).toBe(false);
    await ui.close();
    ui = await context.newPage(); await ui.goto(popupUrl);
    await input().fill('c2c-web');
    await expect(ui.locator('.result.history').first()).toContainText('other/c2c-web');
    await expect(ui.locator('button.ranking-forget')).toHaveCount(0);
  });

  test('History search: 100ms deadline freezes pending rows and rejects late or superseded replies', async () => {
    const query = 'JustOneHopHistoryRace';
    await worker.evaluate(async ({ query, origin }) => {
      await chrome.bookmarks.create({ title: `${query} local`, url: `${origin}/${query}-local` });
      const state = globalThis as unknown as { __historyRequests: { text: string; release: () => void }[] };
      state.__historyRequests = [];
      chrome.history.search = ((options: chrome.history.HistoryQuery) => new Promise<chrome.history.HistoryItem[]>(resolve => {
        state.__historyRequests.push({ text: options.text, release: () => resolve([{
          id: options.text, url: `${origin}/${encodeURIComponent(options.text)}`, title: `${options.text} remote`, lastVisitTime: Date.now(),
        }]) });
      })) as typeof chrome.history.search;
    }, { query, origin });
    await ui.reload();
    await expect(ui.locator('.result.command')).toHaveCount(9);
    await ui.clock.install(); await ui.clock.pauseAt(new Date());
    // Observe delivery separately from rendering, so absence checks follow the late reply.
    await ui.evaluate(() => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      const state = globalThis as unknown as { __historyReplies: string[] };
      state.__historyReplies = [];
      chrome.runtime.sendMessage = (async (request: { type?: string; payload?: { query: string } }) => {
        const reply = await original(request);
        if (request.type === 'search-history') state.__historyReplies.push(request.payload!.query);
        return reply;
      }) as typeof chrome.runtime.sendMessage;
    });
    const requests = () => worker.evaluate(() => (globalThis as unknown as { __historyRequests: { text: string }[] }).__historyRequests.map(request => request.text));
    const release = (text: string) => worker.evaluate(text => {
      const state = globalThis as unknown as { __historyRequests: { text: string; release: () => void }[] };
      state.__historyRequests.find(request => request.text === text)!.release();
    }, text);
    const delivered = (text: string) => expect.poll(() => ui.evaluate(() => (globalThis as unknown as { __historyReplies: string[] }).__historyReplies)).toContain(text);
    const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    const rows = ui.locator('#justonehop-results');
    const homeRows = await rows.locator('.result').evaluateAll(nodes => nodes.map(node => node.id));
    const beforeTabs = await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => tab.id).sort());
    await search.fill(query);
    await expect.poll(requests).toContain(query);
    await expect(rows).toHaveAttribute('aria-busy', 'true');
    expect(await rows.locator('.result').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(homeRows);
    await expect(ui.locator('.primary-action')).toBeDisabled();
    await search.press('Enter');
    expect(await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => tab.id).sort())).toEqual(beforeTabs);
    await ui.clock.runFor(99);
    await expect(rows).toHaveAttribute('aria-busy', 'true');
    await ui.clock.runFor(1);
    await expect(rows).toHaveAttribute('aria-busy', 'false');
    await expect(rows.locator('.result.bookmark')).toHaveCount(1);
    await expect(ui.locator('#justonehop-search-all-history')).toContainText('History search unfinished');
    await expect(rows.locator('.result.history')).toHaveCount(0);
    const timedOutRows = await rows.locator('.result').evaluateAll(nodes => nodes.map(node => node.id));
    await release(query); await delivered(query); await ui.clock.runFor(1);
    expect(await rows.locator('.result').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(timedOutRows);
    await expect(ui.locator('#justonehop-search-all-history')).toContainText('History search unfinished');

    const stale = `${query} stale`, fresh = `${query} fresh`;
    await search.fill(stale); await expect.poll(requests).toContain(stale);
    await search.fill(fresh); await expect.poll(requests).toContain(fresh);
    await release(stale); await delivered(stale); await ui.clock.runFor(1);
    await expect(rows).toHaveAttribute('aria-busy', 'true');
    expect(await rows.locator('.result').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(timedOutRows);
    await release(fresh); await delivered(fresh); await ui.clock.runFor(1);
    await expect(rows).toHaveAttribute('aria-busy', 'false');
    await expect(rows.locator('.result.history')).toHaveCount(1);
    await expect(rows.locator('.result.history .entry-title')).toHaveText(`${fresh} remote`);
    await expect(search).toBeFocused(); await expect(search).toHaveValue(fresh);
    await ui.clock.runFor(100);
    await expect(rows.locator('.result.history .entry-title')).toHaveText(`${fresh} remote`);
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'zh-CN' } });
  test('History search: Chinese all-time navigation finds an older visit outside the weekly scope', async () => {
    const query = 'JustOneHopHistoryArchive';
    const url = `${origin}/${query}-older`;
    await worker.evaluate(({ query, url }) => {
      // Chrome addUrl cannot backdate visits; model an older visit at the Chrome
      // API boundary while exercising the real request, scope and UI pipeline.
      const older = { id: 'older-visit', url, title: `${query} older`, lastVisitTime: Date.now() - 30 * 24 * 60 * 60 * 1000 };
      const state = globalThis as unknown as { __historyScopes: { text: string; startTime?: number }[] };
      state.__historyScopes = [];
      chrome.history.search = (async (options: chrome.history.HistoryQuery) => {
        state.__historyScopes.push({ text: options.text, startTime: options.startTime });
        return options.text === query && (options.startTime ?? 0) <= older.lastVisitTime ? [older] : [];
      }) as typeof chrome.history.search;
    }, { query, url });
    const search = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
    await search.fill(query);
    const allHistory = ui.locator('#justonehop-search-all-history');
    await expect(allHistory.locator('.entry-title')).toHaveText('搜索全部历史');
    await expect(allHistory).toContainText('最近一周无匹配');
    await expect(ui.locator('.result.history')).toHaveCount(0);
    await expect(allHistory).toHaveAttribute('aria-selected', 'true');
    await search.press('Enter');
    const fullSearch = ui.getByRole('combobox', { name: '搜索浏览历史', exact: true });
    await expect(fullSearch).toBeFocused(); await expect(fullSearch).toHaveValue(query);
    await expect(ui.locator('.history-view .result.history')).toHaveCount(1);
    await expect(ui.locator('.history-view .entry-title')).toHaveText(`${query} older`);
    const scopes = await worker.evaluate(() => (globalThis as unknown as { __historyScopes: { text: string; startTime?: number }[] }).__historyScopes);
    expect(scopes.map(scope => scope.text)).toEqual([query, query]);
    expect(scopes[0].startTime).toBeGreaterThan(Date.now() - 8 * 24 * 60 * 60 * 1000);
    expect(scopes[1].startTime).toBe(0);
    const opened = context.waitForEvent('page');
    await ui.locator('.history-view .result.history').click();
    const page = await opened;
    await expect(page).toHaveURL(url);
    await expect(page.getByRole('heading')).toHaveText(`${query} older`);
    await expect.poll(() => ui.isClosed()).toBe(true);
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual([
      expect.objectContaining({ query: query.toLowerCase(), target: `tab:${url}`, weight: 1 }),
    ]);
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test('History overlay: source permissions, action menu and narrow viewport retain navigation', async () => {
    const query = 'JustOneHopOverlayHistory';
    const url = `${origin}/${query}-saved`;
    await worker.evaluate(url => chrome.history.addUrl({ url }), url);
    const page = await context.newPage();
    await page.setViewportSize({ width: 390, height: 600 });
    await page.goto(`${origin}/history-source`);
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, page.url());
    await worker.evaluate(async tabId => {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tabId, { source: 'justonehop', type: 'toggle' });
    }, tabId);
    const surface = page.frameLocator('.justonehop-frame');
    const input = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await input.fill(query);
    await expect(surface.locator('.result.history')).toHaveCount(1);
    await surface.locator('#justonehop-search-all-history').click();
    await expect(surface.locator('.history-view .result.history')).toHaveCount(1);
    await expect(surface.locator('.history-view time')).toHaveText('just now');
    const timestamp = await surface.locator('.history-view time').boundingBox();
    const title = await surface.locator('.history-view .entry-title').boundingBox();
    expect(title!.width).toBeGreaterThan(40);
    expect(title!.x + title!.width).toBeLessThanOrEqual(timestamp!.x);
    const box = await surface.locator('.history-view').boundingBox();
    expect(box!.width).toBeLessThanOrEqual(390);
    await surface.locator('.history-view').screenshot({ path: test.info().outputPath('history-overlay-narrow.png') });
    await surface.locator('.history-view .result.history').click({ button: 'right' });
    await expect(surface.getByRole('combobox', { name: 'Search actions' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(surface.getByRole('combobox', { name: 'Search browsing history' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(input).toBeFocused(); await expect(input).toHaveValue(query);
    await surface.locator('.result.history').click({ button: 'right' });
    await expect(surface.getByRole('combobox', { name: 'Search actions' })).toBeFocused();
    const opened = context.waitForEvent('page');
    await page.keyboard.press('Enter');
    await expect(await opened).toHaveURL(url);
    await expect(page.locator('.justonehop-frame')).toHaveCount(0);
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'zh-CN', pageAccess: true, shadow: 'open' } });
  test('URL actions: Chinese narrow overlay keeps Current plain and text drags separate from clicks', async () => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await context.newPage();
    const sourceUrl = `${origin}/Urlcopy-source?mode=current#source-fragment`;
    const historyUrl = `${origin}/Urlcopy-archive?mode=history&value=a%2Bb#history-fragment`;
    await page.goto(sourceUrl);
    await worker.evaluate(url => chrome.history.addUrl({ url }), historyUrl);
    const surface = await openStorageOverlay(page);
    const root = surface.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
    const actions = surface.getByRole('combobox', { name: '搜索操作' });
    const tabs = () => worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url, active: tab.active })));
    const beforeTabs = await tabs();
    const usage = await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage);
    await root.fill('Urlcopy');
    const current = surface.locator('.result.tab').filter({ has: surface.locator('.current-badge') });
    await expect(current).toHaveCount(1);
    await expect(surface.locator('#justonehop-results .result.history time')).toHaveCount(1);
    const badge = current.locator('.current-badge');
    await expect(badge).toHaveText('当前');
    for (const width of [750, 390]) {
      await page.setViewportSize({ width, height: 600 });
      const typography = await badge.evaluate(node => {
        const style = getComputedStyle(node);
        const kind = node.parentElement!.querySelector('.kind-label:not(.current-badge)')!;
        const time = node.closest('.palette')!.querySelector('.result.history time')!;
        return { size: style.fontSize, weight: style.fontWeight, color: style.color,
          timeSize: getComputedStyle(time).fontSize, timeWeight: getComputedStyle(time).fontWeight, timeColor: getComputedStyle(time).color,
          background: style.backgroundColor, border: style.borderTopWidth, radius: style.borderRadius,
          padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
          afterKind: node.getBoundingClientRect().left >= kind.getBoundingClientRect().right };
      });
      expect(typography).toMatchObject({ size: width > 520 ? '11px' : '10px', weight: '400',
        background: 'rgba(0, 0, 0, 0)', border: '0px', radius: '0px', padding: ['0px', '0px', '0px', '0px'], afterKind: true });
      expect(typography.size).toBe(typography.timeSize);
      expect(typography.weight).toBe(typography.timeWeight);
      expect(typography.color).toBe(typography.timeColor);
    }
    async function copyMouse(input: Locator, row: Locator, url: string) {
      const query = await input.inputValue();
      await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
      await row.click({ button: 'right' });
      await expect(actions).toBeFocused(); await actions.fill('copy URL');
      const copy = surface.locator('.action-row').filter({ hasText: '复制 URL' });
      await expect(copy).toHaveCount(1); await copy.click();
      await expect(surface.locator('.action-menu')).toHaveCount(0);
      await expect(surface.getByText('已复制 URL', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
      await expect(input).toBeFocused(); await expect(input).toHaveValue(query);
      expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
      await expect(row).toHaveAttribute('aria-selected', 'true');
      expect(await tabs()).toEqual(beforeTabs);
      expect(await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual(usage);
    }
    await copyMouse(root, current, sourceUrl);
    const mainHistory = surface.locator('#justonehop-results .result.history');
    await expect(mainHistory).toHaveCount(1);
    await dragResultText(page, mainHistory);
    expect(await tabs()).toEqual(beforeTabs);
    await root.focus();
    await surface.locator('#justonehop-search-all-history').click();
    const fullSearch = surface.getByRole('combobox', { name: '搜索浏览历史', exact: true });
    const history = surface.locator('.history-view .result.history').filter({ hasText: 'Urlcopy-archive' });
    await expect(history).toHaveCount(1);
    await dragResultText(page, history);
    expect(await tabs()).toEqual(beforeTabs);
    await fullSearch.focus();
    await copyMouse(fullSearch, history, historyUrl);
    expect(await surface.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await expect(surface.locator('.palette-footer .primary-action')).toBeInViewport();
    await surface.locator('.palette').screenshot({ path: test.info().outputPath('url-copy-history-chinese-narrow.png') });
    // A selection left in the search input is unrelated to a fresh click on text.
    await fullSearch.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
    await history.locator('.entry-title').click();
    await expect(page).toHaveURL(historyUrl);
    await expect(page.locator('.justonehop-frame')).toHaveCount(0);
  });
});

// Keep these expectations independent of the production Chrome Pages registry.
const chromePageCases = [
  { action: 'openExtensions', en: 'Extensions', zh: '扩展管理', url: 'chrome://extensions/', root: 'extensions-manager', aliases: ['extension', 'extensions', '扩展', '插件'], input: 'keyboard' },
  { action: 'openPasswords', en: 'Password Manager', zh: '密码管理器', url: 'chrome://password-manager/passwords', root: 'password-manager-app', aliases: ['password', 'passwords', '密码'], input: 'keyboard' },
  { action: 'openDownloads', en: 'Downloads', zh: '下载内容', url: 'chrome://downloads/', root: 'downloads-manager', aliases: ['download', 'downloads', '下载'], input: 'mouse' },
  { action: 'openHistory', en: 'History', zh: '历史记录', url: 'chrome://history/', root: 'history-app', aliases: ['history', '历史'], input: 'mouse' },
  { action: 'openBookmarks', en: 'Bookmark Manager', zh: '书签管理器', url: 'chrome://bookmarks/', root: 'bookmarks-app', aliases: ['bookmark manager', '书签管理'], input: 'footer' },
  { action: 'openChromeSettings', en: 'Chrome Settings', zh: 'Chrome 设置', url: 'chrome://settings/', root: 'settings-ui', aliases: ['chrome settings', '浏览器设置'], input: 'footer' },
  { action: 'openExtensionShortcuts', en: 'Extension Shortcuts', zh: '扩展快捷键', url: 'chrome://extensions/shortcuts', root: 'extensions-keyboard-shortcuts', aliases: ['extension shortcuts', '扩展快捷键'], input: 'menu' },
] as const;

async function expectChromePageLoaded(page: Page, target: { url: string; root: string }) {
  await expect(page).toHaveURL(target.url);
  // A committed URL alone also passes for a failed/blank navigation. Inspect
  // Chrome's actual WebUI, including the shortcuts subview inside Extensions.
  await expect(page.locator(target.root)).toBeVisible();
  await expect.poll(() => page.title()).not.toBe('');
  await expect(page.locator('#main-frame-error')).toHaveCount(0);
}

for (const target of chromePageCases) test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test(`Chrome Pages: ${target.en} loads the native page and reuses its exact tab via ${target.input}`, async () => {
    const owner = await ui.evaluate(async () => (await chrome.tabs.getCurrent())!.windowId);
    const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await expect(search).toBeFocused();
    await ui.keyboard.type(target.aliases[0]);
    const row = ui.locator(`[id="justonehop-command:${target.action}"]`);
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await expect(row.locator('.entry-title')).toHaveText(`Chrome Pages: ${target.en}`);
    const created = context.waitForEvent('page');
    if (target.input === 'mouse') await row.click();
    else if (target.input === 'footer') await ui.locator('.palette-footer .primary-action').click();
    else {
      if (target.input === 'menu') {
        await ui.keyboard.press('Meta+k');
        await expect(ui.getByRole('combobox', { name: 'Search actions' })).toBeFocused();
        await expect(ui.locator('.action-row')).toHaveCount(1);
      }
      await ui.keyboard.press('Enter').catch(error => { if (!ui.isClosed()) throw error; });
    }
    const destination = await created;
    await expectChromePageLoaded(destination, target);
    await expect.poll(() => ui.isClosed()).toBe(true);
    const first = await worker.evaluate(async ({ windowId, url }) => (await chrome.tabs.query({ windowId })).filter(tab => tab.url === url), { windowId: owner, url: target.url });
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ active: true, windowId: owner });
    const beforeReuse = await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId })).map(tab => tab.id!).sort((a, b) => a - b), owner);

    const reopened = context.waitForEvent('page');
    await worker.evaluate(({ windowId, url }) => chrome.tabs.create({ windowId, url, active: true }), { windowId: owner, url: popupUrl });
    ui = await reopened;
    await expect(ui.getByRole('combobox')).toBeFocused();
    await ui.getByRole('combobox').fill(target.aliases[0]);
    await expect(ui.locator('#justonehop-results [role="option"]').first()).toHaveAttribute('id', `justonehop-command:${target.action}`);
    await ui.locator('.palette-footer .primary-action').click();
    await expect.poll(() => ui.isClosed()).toBe(true);
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).active, first[0].id!)).toBe(true);
    expect(await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId })).map(tab => tab.id!).sort((a, b) => a - b), owner)).toEqual(beforeReuse);
    await expectChromePageLoaded(destination, target);
  });
});

for (const language of ['English', 'Chinese']) test.describe(() => {
  test.use({ environment: { ...defaults, locale: language === 'English' ? 'en-US' : 'zh-CN' } });
  test(`Chrome Pages: ${language} labels aliases and mixed right-click Escape footer flow preserve justonehop settings`, async () => {
    const en = language === 'English';
    const prefix = en ? 'Chrome Pages' : 'Chrome 内置页面';
    const search = ui.getByRole('combobox', { name: en ? 'Search commands, tabs, bookmarks, and history' : '搜索命令、标签页、书签和历史' });
    const first = ui.locator('#justonehop-results [role="option"]').first();
    for (const target of chromePageCases) await expect(ui.locator(`[id="justonehop-command:${target.action}"]`)).toHaveCount(0);
    for (const category of ['Chrome Pages', 'Chrome 内置页面']) {
      await search.fill(category);
      for (const target of chromePageCases) {
        const row = ui.locator(`[id="justonehop-command:${target.action}"]`);
        await expect(row.locator('.entry-title')).toHaveText(`${prefix}: ${en ? target.en : target.zh}`);
        await expect(row.locator('.entry-shortcut')).toHaveCount(0);
      }
    }
    for (const target of chromePageCases) for (const alias of target.aliases) {
      await search.fill(alias);
      await expect(first).toHaveAttribute('id', `justonehop-command:${target.action}`);
      await expect(first.locator('.entry-title')).toHaveText(`${prefix}: ${en ? target.en : target.zh}`);
    }
    for (const query of ['Chrome Pages: downloads', 'Chrome 内置页面：下载']) {
      await search.fill(query);
      await expect(first).toHaveAttribute('id', 'justonehop-command:openDownloads');
      await expect(first.locator('mark')).not.toHaveCount(0);
    }

    const tabIds = await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => tab.id!).sort((a, b) => a - b));
    for (const query of ['settings', '设置', 'shortcut', '快捷键']) {
      await search.fill(query);
      await expect(first).toHaveAttribute('id', query === 'settings' || query === '设置' ? 'justonehop-command:settings' : 'justonehop-command:settings:keyboard');
      await search.press('Enter');
      await expect(ui.getByRole('region', { name: en ? 'Settings' : '设置', exact: true })).toBeVisible();
      await ui.keyboard.press('Escape');
      await expect(search).toBeFocused();
      await expect(search).toHaveValue(query);
    }
    expect(await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => tab.id!).sort((a, b) => a - b))).toEqual(tabIds);

    await search.fill(prefix);
    await search.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
    const bookmarks = ui.locator('[id="justonehop-command:openBookmarks"]');
    await expect(bookmarks).toHaveAttribute('aria-selected', 'false');
    await bookmarks.click({ button: 'right' });
    const actions = ui.getByRole('combobox', { name: en ? 'Search actions' : '搜索操作' });
    await expect(actions).toBeFocused();
    await expect(ui.locator('.action-heading')).toContainText(en ? 'Bookmark Manager' : '书签管理器');
    await actions.fill(en ? '书签管理' : 'bookmark manager');
    await expect(ui.locator('.action-row')).toHaveCount(1);
    await expect(ui.locator('.palette-footer .primary-action')).toContainText(en ? 'Bookmark Manager' : '书签管理器');
    await ui.keyboard.press('Escape');
    await expect(search).toBeFocused();
    await expect(search).toHaveValue(prefix);
    expect(await search.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
    await expect(bookmarks).toHaveAttribute('aria-selected', 'true');
    await search.press('Control+n');
    await expect(bookmarks).toHaveAttribute('aria-selected', 'false');
    await search.press('Control+p');
    await expect(bookmarks).toHaveAttribute('aria-selected', 'true');
    await ui.getByRole('button', { name: en ? 'Open action menu' : '打开操作菜单' }).click();
    await expect(actions).toBeFocused();
    await expect(ui.locator('.action-row')).toHaveCount(1);
    const created = context.waitForEvent('page');
    await ui.locator('.palette-footer .primary-action').click();
    await expectChromePageLoaded(await created, { url: 'chrome://bookmarks/', root: 'bookmarks-app' });
    await expect.poll(() => ui.isClosed()).toBe(true);
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('Chrome Pages: Settings Change in Chrome reuses the existing extension shortcuts tab', async () => {
    const owner = await ui.evaluate(async () => (await chrome.tabs.getCurrent())!.windowId);
    const created = context.waitForEvent('page');
    const shortcuts = await worker.evaluate(windowId => chrome.tabs.create({ windowId, url: 'chrome://extensions/shortcuts', active: false }), owner);
    const destination = await created;
    await expectChromePageLoaded(destination, { url: 'chrome://extensions/shortcuts', root: 'extensions-keyboard-shortcuts' });
    const selfId = await ui.evaluate(async () => (await chrome.tabs.getCurrent())!.id!);
    const before = await worker.evaluate(async ({ windowId, selfId }) => (await chrome.tabs.query({ windowId })).map(tab => tab.id!).filter(id => id !== selfId).sort((a, b) => a - b), { windowId: owner, selfId });
    await ui.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(ui.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
    await ui.getByRole('button', { name: 'Change in Chrome', exact: true }).click();
    await expect.poll(() => ui.isClosed()).toBe(true);
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).active, shortcuts.id!)).toBe(true);
    expect(await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId })).map(tab => tab.id!).sort((a, b) => a - b), owner)).toEqual(before);
    await expectChromePageLoaded(destination, { url: 'chrome://extensions/shortcuts', root: 'extensions-keyboard-shortcuts' });
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, commands: true } });
  test('Address navigation: closed-shadow overlay accepts native new-tab shortcut', async () => {
    const page = await context.newPage(); await page.goto(`${origin}/Address-closed-source`);
    await page.getByRole('textbox', { name: 'Page input' }).click();
    const source = await worker.evaluate(async url => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
      return { id: tab.id!, windowId: tab.windowId };
    }, page.url());
    await expect(page.locator('#justonehop-command-palette')).toBeAttached();
    expect(await page.locator('#justonehop-command-palette').evaluate(node => node.shadowRoot)).toBeNull();
    const session = await context.newCDPSession(page);
    const ax = async () => {
      const { frameTree } = await session.send('Page.getFrameTree');
      const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
      return (await session.send('Accessibility.getFullAXTree', { frameId })).nodes;
    };
    await expect.poll(async () => (await ax()).some(node => node.role?.value === 'combobox' && node.properties?.some(property => property.name === 'focused' && property.value.value === true))).toBe(true);
    const target = `${origin}/Address-closed-target?Q=A%2Bb#Part`;
    await page.keyboard.type(target);
    await expect.poll(async () => (await ax()).some(node => node.role?.value === 'option' && node.name?.value.includes('Go to URL') && node.properties?.some(property => property.name === 'selected' && property.value.value === true))).toBe(true);
    const shortcut = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta+Enter' : 'Alt+Enter');
    await page.keyboard.press(shortcut);
    await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
    await expect.poll(async () => worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0]?.url, source.windowId)).toBe(target);
    expect(await worker.evaluate(async id => (await chrome.tabs.get(id)).url, source.id)).toBe(`${origin}/Address-closed-source`);
    await session.detach();
  });

  test('Chrome Pages: closed-shadow overlay Enter opens native Downloads and dismisses the palette', async () => {
    const page = await context.newPage();
    await page.goto(`${origin}/Chrome-Pages-overlay`);
    await page.getByRole('textbox', { name: 'Page input' }).click();
    const source = await worker.evaluate(async url => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
      return { tabId: tab.id!, windowId: tab.windowId };
    }, page.url());
    await worker.evaluate(async () => {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    });
    const session = await context.newCDPSession(page);
    const ax = async () => {
      const { frameTree } = await session.send('Page.getFrameTree');
      const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
      return (await session.send('Accessibility.getFullAXTree', { frameId })).nodes;
    };
    await expect(page.locator('#justonehop-command-palette')).toBeAttached();
    expect(await page.locator('#justonehop-command-palette').evaluate(node => node.shadowRoot)).toBeNull();
    await expect.poll(async () => (await ax()).some(node => node.role?.value === 'combobox' && node.properties?.some(property => property.name === 'focused' && property.value.value === true))).toBe(true);
    await page.keyboard.type('downloads');
    await expect.poll(async () => (await ax()).some(node => node.role?.value === 'option' && node.name?.value.includes('Chrome Pages: Downloads'))).toBe(true);
    const created = context.waitForEvent('page');
    await page.keyboard.press('Enter');
    await expectChromePageLoaded(await created, { url: 'chrome://downloads/', root: 'downloads-manager' });
    await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
    const tabs = await worker.evaluate(async windowId => chrome.tabs.query({ windowId }), source.windowId);
    expect(tabs.filter(tab => tab.url === 'chrome://downloads/')).toHaveLength(1);
    expect(tabs.find(tab => tab.url === 'chrome://downloads/')).toMatchObject({ active: true, windowId: source.windowId });
    expect(tabs.find(tab => tab.id === source.tabId)).toMatchObject({ url: `${origin}/Chrome-Pages-overlay` });
    await session.detach();
  });
});

test('unified bilingual search, action menu, Esc and empty results', async () => {
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
  await input.fill('close right');
  await expect(ui.getByRole('option').first()).toContainText('关闭右侧');
  await input.fill('刷新');
  await expect(ui.getByRole('option').first()).toContainText('刷新');
  await input.press('Meta+k');
  await expect(ui.getByRole('combobox', { name: '搜索操作' })).toBeFocused();
  await ui.keyboard.press('Escape');
  await expect(input).toHaveValue('刷新');
  await expect(input).toBeFocused();
  await input.fill('');
  await input.press('ArrowUp');
  await expect(ui.locator('.result').last()).toHaveAttribute('aria-selected', 'true');
  await input.press('ArrowDown');
  await expect(ui.locator('.result').first()).toHaveAttribute('aria-selected', 'true');
  await input.press('Backspace');
  await expect(input).toHaveValue('');
  await expect(ui.getByText('快捷访问', { exact: true })).toHaveCount(0);
  await expect(ui.locator('.navigation-hint .navigation-key').first().locator('kbd')).toHaveText(['Ctrl+P']);
  await expect(ui.locator('.mode-button')).toHaveCount(0);
  await input.fill('zzzz-no-such-result');
  await expect(ui.getByText('没有找到匹配结果')).toBeVisible();
  await expect(ui.getByRole('button', { name: '打开操作菜单' })).toBeDisabled();
});

test('search isolates windows, merges bookmarks, and target actions mute the selected tab', async () => {
  const target = await ui.evaluate(async base => {
    const current = await chrome.tabs.getCurrent();
    const tab = await chrome.tabs.create({ windowId: current!.windowId, url: `${base}/Design-Notes`, active: false });
    await chrome.bookmarks.create({ title: 'Design Reference', url: `${base}/Reference` });
    await chrome.windows.create({ url: `${base}/OtherWindowUnique`, focused: false });
    return tab.id!;
  }, origin);
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
  await input.fill('OtherWindowUnique');
  await expect(ui.getByRole('option')).toHaveCount(0);
  await input.fill('Design');
  await expect(ui.getByRole('option')).toHaveCount(2);
  await input.fill('Design Notes');
  await expect(ui.getByRole('option')).toHaveCount(1);
  await input.press('Meta+k');
  const action = ui.getByRole('combobox', { name: '搜索操作' });
  await action.fill('mute');
  await expect(ui.locator('#justonehop-actions [aria-selected="true"]')).toContainText('静音');
  await action.press('Enter');
  await expect.poll(() => worker.evaluate(id => chrome.tabs.get(id).then(t => t.mutedInfo?.muted), target)).toBe(true);
  await expect(ui.getByRole('dialog')).toHaveCount(0);
  await expect(input).toHaveValue('Design Notes');
  await expect(input).toBeFocused();
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true } });
  test('bookmark tab closed-shadow keyboard preserves source URL and search caret', async () => {
    const page = await context.newPage();
    const url = `${origin}/Bookmark-keyboard-source?mode=full&value=a%2Bb#saved-fragment`;
    await page.goto(url);
    const source = await worker.evaluate(async url => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
      await chrome.bookmarks.create({ title: tab.title!, url });
      return tab;
    }, url);
    await page.bringToFront();
    await worker.evaluate(async tabId => {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tabId, { source: 'justonehop', type: 'toggle' });
    }, source.id!);
    await expect(page.locator('#justonehop-command-palette')).toBeAttached();
    expect(await page.locator('#justonehop-command-palette').evaluate(node => node.shadowRoot)).toBeNull();
    const cdp = await context.newCDPSession(page);
    const ax = async () => {
      const { frameTree } = await cdp.send('Page.getFrameTree');
      const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
      return (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes;
    };
    const combo = async () => (await ax()).find(node => node.role?.value === 'combobox' && node.name?.value === 'Search commands, tabs, bookmarks, and history');
    const focused = async () => (await combo())?.properties?.some(property => property.name === 'focused' && property.value.value === true);
    const bookmarks = () => worker.evaluate(url => chrome.bookmarks.search({ url }), url);
    // Read the real closed-root input through AX; every user interaction remains keyboard input.
    const caret = async () => {
      const node = await combo();
      const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: node!.backendDOMNodeId });
      try {
        const { result } = await cdp.send('Runtime.callFunctionOn', {
          objectId: object.objectId, returnByValue: true,
          functionDeclaration: 'function() { return [this.selectionStart, this.selectionEnd]; }',
        });
        return result.value;
      } finally { if (object.objectId) await cdp.send('Runtime.releaseObject', { objectId: object.objectId }); }
    };
    await expect.poll(focused).toBe(true);
    for (const [query, adding] of [['book', false], ['book', true], ['book', false], ['收藏标签页', true], ['收藏标签页', false]] as const) {
      await page.keyboard.press('Meta+a');
      await page.keyboard.insertText(query);
      const title = adding ? 'Bookmark Tab' : 'Unbookmark Tab';
      await expect.poll(async () => (await ax()).some(node => node.role?.value === 'option' && node.name?.value?.includes(title)
        && node.properties?.some(property => property.name === 'selected' && property.value.value === true))).toBe(true);
      await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Shift+ArrowLeft');
      const selection = [query.length - 3, query.length - 2];
      expect(await caret()).toEqual(selection);
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await bookmarks()).length).toBe(adding ? 1 : 0);
      if (adding) {
        const [saved] = await bookmarks();
        expect(saved).toMatchObject({ title: source.title, url });
        const [folder] = await worker.evaluate(id => chrome.bookmarks.get(id), saved.parentId!);
        expect(folder.title).toMatch(/^Other bookmarks$/i);
      }
      await expect.poll(async () => (await ax()).some(node => node.name?.value === (adding ? 'Tab bookmarked' : 'Bookmark removed'))).toBe(true);
      await expect.poll(async () => (await ax()).some(node => node.role?.value === 'alertdialog')).toBe(false);
      await expect.poll(focused).toBe(true);
      expect((await combo())?.value?.value).toBe(query);
      expect(await caret()).toEqual(selection);
      expect((await ax()).some(node => node.role?.value === 'option' && node.name?.value?.includes(`Tab: ${title}`))).toBe(false);
      if (adding) {
        const removal = async () => (await ax()).find(node => node.role?.value === 'option' && node.name?.value?.includes('Unbookmark Tab'));
        await expect.poll(async () => !!(await removal())).toBe(true);
        expect((await removal())?.properties?.some(property => property.name === 'selected' && property.value.value === true)).toBe(false);
        // Keeping the bookmark query reveals the reverse action without inheriting its selection.
        await page.keyboard.press('Enter');
        await expect.poll(focused).toBe(true);
        expect(await bookmarks()).toHaveLength(1);
        expect((await combo())?.value?.value).toBe(query);
        await page.keyboard.press('ArrowDown');
        await expect.poll(async () => (await removal())?.properties?.some(property => property.name === 'selected' && property.value.value === true)).toBe(true);
      }
      await expect(page.locator('#justonehop-command-palette')).toBeAttached();
      expect(await worker.evaluate(id => chrome.tabs.get(id), source.id!)).toMatchObject({ active: true, url });
      await page.keyboard.insertText('X');
      await expect.poll(async () => (await combo())?.value?.value).toBe(`${query.slice(0, selection[0])}X${query.slice(selection[1])}`);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
    await cdp.detach();
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test('bookmark tab menus confirm exact duplicate sets and retry changed scope', async () => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 500, height: 760 });
    await page.goto(`${origin}/Bookmark-menu-source`);
    const url = `${origin}/Bookmark-menu-target?mode=full&value=a%2Bb#saved-fragment`;
    const seed = await worker.evaluate(async ({ sourceUrl, url }) => {
      const source = (await chrome.tabs.query({})).find(tab => tab.url === sourceUrl)!;
      const target = await chrome.tabs.create({ windowId: source.windowId, url, active: false });
      const groupId = await chrome.tabs.group({ tabIds: [target.id!] });
      await chrome.tabGroups.update(groupId, { title: 'Bookmark collection', color: 'blue' });
      const folder = await chrome.bookmarks.create({ parentId: '2', title: 'Duplicate folder' });
      const otherUrl = await chrome.bookmarks.create({ parentId: folder.id, title: 'Different fragment', url: url.replace('#saved-fragment', '#keep-fragment') });
      return { source: source.id!, target: target.id!, folder: folder.id, otherUrl: otherUrl.id };
    }, { sourceUrl: page.url(), url });
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).status, seed.target)).toBe('complete');
    const surface = await openStorageOverlay(page);
    const root = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    const actions = surface.getByRole('combobox', { name: 'Search actions' });
    const bookmarks = () => worker.evaluate(url => chrome.bookmarks.search({ url }), url);
    const ids = async () => (await bookmarks()).map(bookmark => bookmark.id).sort();
    await root.fill('Bookmark menu');
    await root.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
    const target = surface.locator(`[id="justonehop-tab:${seed.target}"]`);
    await target.click({ button: 'right' });
    await expect(surface.locator('.action-heading')).toContainText('Bookmark menu target');
    await actions.fill('bookmark tab');
    await surface.locator('.action-row').filter({ hasText: 'Bookmark Tab' }).click();
    await expect.poll(async () => (await bookmarks()).length).toBe(1);
    expect((await bookmarks())[0]).toMatchObject({ title: 'Bookmark menu target', url, parentId: '2' });
    expect(await worker.evaluate(url => chrome.bookmarks.search({ url }), page.url())).toEqual([]);
    await expect(surface.locator('.palette-footer')).toContainText('Bookmark added');
    await expect(root).toBeFocused(); await expect(root).toHaveValue('Bookmark menu');
    expect(await root.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
    await expect(target).toHaveAttribute('aria-selected', 'true');
    await worker.evaluate(({ parentId, url }) => chrome.bookmarks.create({ parentId, title: 'Second copy', url }), { parentId: seed.folder, url });
    const originalIds = await ids();
    expect(originalIds).toHaveLength(2);
    await root.fill('Bookmark collection');
    await surface.getByRole('option').filter({ hasText: 'Tab Group: Bookmark collection' }).click();
    const group = surface.getByRole('combobox', { name: 'Search tabs in this group…' });
    await group.fill('target');
    await group.press('ArrowLeft'); await group.press('Shift+ArrowLeft');
    const groupCaret = [4, 5];
    const member = surface.locator(`[id="group-tab:${seed.target}"]`);
    const confirmation = surface.getByRole('alertdialog', { name: 'Remove bookmarks?' });
    const cancel = confirmation.getByRole('button', { name: 'Cancel', exact: true });
    async function confirmMenu(count: number, mouse = false) {
      if (mouse) await member.click({ button: 'right' });
      else await group.press('Meta+k');
      await actions.fill('unbookmark tab');
      await actions.press('Enter');
      await expect(confirmation).toBeVisible();
      await expect(confirmation).toContainText(`Remove all ${count} bookmarks for this URL from the folders below?`);
      await expect(confirmation).toContainText(/Other bookmarks/i);
      await expect(confirmation).toContainText('Duplicate folder');
      await expect(confirmation.getByRole('button', { name: `Remove ${count} bookmarks`, exact: true })).toBeInViewport();
      await expect(cancel).toBeFocused();
    }
    async function returnToGroup() {
      await expect(confirmation).toHaveCount(0);
      await expect(actions).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(group).toBeFocused(); await expect(group).toHaveValue('target');
      expect(await group.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual(groupCaret);
      await expect(member).toHaveAttribute('aria-selected', 'true');
    }
    await confirmMenu(2, true);
    await cancel.click();
    expect(await ids()).toEqual(originalIds);
    await returnToGroup();
    await confirmMenu(2);
    await page.keyboard.press('Escape');
    expect(await ids()).toEqual(originalIds);
    await returnToGroup();
    await confirmMenu(2, true);
    const added = await worker.evaluate(({ parentId, url }) => chrome.bookmarks.create({ parentId, title: 'Added after confirmation', url }), { parentId: seed.folder, url });
    const changedIds = [...originalIds, added.id].sort();
    await confirmation.getByRole('button', { name: 'Remove 2 bookmarks', exact: true }).click();
    await expect(surface.getByRole('alert')).toContainText('The page or its bookmarks changed. Check the updated list and try again.');
    expect(await ids()).toEqual(changedIds);
    await expect(confirmation).toHaveCount(0);
    await expect(actions).toBeFocused();
    await returnToGroup();
    await confirmMenu(3);
    // Cancel is the default; Tab explicitly chooses the destructive confirmation.
    await page.keyboard.press('Tab');
    await expect(confirmation.getByRole('button', { name: 'Remove 3 bookmarks', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(ids).toEqual([]);
    await expect(confirmation).toHaveCount(0);
    await expect(surface.locator('.action-menu')).toHaveCount(0);
    await expect(surface.locator('.palette-footer')).toContainText('Bookmarks removed: 3');
    await expect(group).toBeFocused(); await expect(group).toHaveValue('target');
    expect(await group.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual(groupCaret);
    await expect(member).toHaveAttribute('aria-selected', 'true');
    expect(await worker.evaluate(async id => (await chrome.bookmarks.get(id))[0].url, seed.otherUrl)).toBe(url.replace('#saved-fragment', '#keep-fragment'));
    expect(await worker.evaluate(id => chrome.tabs.get(id), seed.source)).toMatchObject({ active: true, url: page.url() });
    await page.keyboard.insertText('X');
    await expect(group).toHaveValue('targXt');
    await page.keyboard.press('Escape');
    await expect(root).toHaveValue('Bookmark collection');
    await expect(root).toBeFocused();
  });
});

for (const locale of ['en-US', 'zh-CN'] as const) test.describe(() => {
  test.use({ environment: { ...defaults, locale } });
  test(`bookmark result item ${locale} removes only the selected ID through mouse and keyboard menus`, async () => {
    const english = locale === 'en-US';
    const url = `${origin}/Bookmark-item-unopened?value=a%2Bb#saved-fragment`;
    const seed = await worker.evaluate(async ({ origin, url }) => {
      const first = await chrome.bookmarks.create({ title: 'Bookmark item Alpha', url });
      const second = await chrome.bookmarks.create({ title: 'Bookmark item Beta', url });
      const neighbor = await chrome.bookmarks.create({ title: 'Bookmark item Neighbor', url: `${origin}/Bookmark-item-neighbor` });
      return { first, second, neighbor };
    }, { origin, url });
    const input = ui.getByRole('combobox', { name: english ? 'Search commands, tabs, bookmarks, and history' : '搜索命令、标签页、书签和历史' });
    const actions = ui.getByRole('combobox', { name: english ? 'Search actions' : '搜索操作' });
    const rows = ui.locator('#justonehop-results .result.bookmark');
    const tabs = () => worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url })));
    const beforeTabs = await tabs();
    expect(beforeTabs.some(tab => tab.url === url)).toBe(false);
    await input.fill('Bookmark item');
    await expect(rows).toHaveCount(3);
    await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 7));
    const label = english ? 'Unbookmark' : '取消收藏';
    for (const [index, bookmark] of [seed.first, seed.second].entries()) {
      const row = ui.locator(`[id="justonehop-bookmark:${bookmark.id}"]`);
      const remove = ui.locator(`[id="justonehop-actions-bookmark:${bookmark.id}:removeBookmark"]`);
      const order = await rows.evaluateAll(nodes => nodes.map(node => node.id));
      const at = order.indexOf(`justonehop-bookmark:${bookmark.id}`);
      const next = order[at + 1] ?? order[at - 1];
      if (index === 0) {
        // Right-click and footer Actions must expose the same item-specific action.
        await row.click({ button: 'right' });
        await expect(remove.locator(':scope > span')).toHaveText(label);
        await ui.getByRole('button', { name: english ? 'Back' : '返回', exact: true }).click();
        await expect(input).toBeFocused();
        await expect(row).toHaveAttribute('aria-selected', 'true');
        await ui.getByRole('button', { name: english ? 'Open action menu' : '打开操作菜单' }).click();
        await expect(remove.locator(':scope > span')).toHaveText(label);
        await expect(ui.locator('[id="justonehop-actions-action:unbookmarkTab"]')).toHaveCount(0);
        await remove.click();
      } else {
        // Select the remaining duplicate using only the keyboard, then Cmd+K/Enter.
        await input.press('Meta+ArrowUp');
        const remaining = await rows.evaluateAll(nodes => nodes.map(node => node.id));
        for (let step = 0; step < remaining.indexOf(`justonehop-bookmark:${bookmark.id}`); step++) await input.press('ArrowDown');
        await expect(row).toHaveAttribute('aria-selected', 'true');
        await input.press('Meta+k');
        await expect(actions).toBeFocused();
        await ui.keyboard.type(english ? '取消收藏' : 'unbookmark');
        await expect(remove.locator(':scope > span')).toContainText(label);
        await expect(remove).toHaveAttribute('aria-selected', 'true');
        await ui.keyboard.press('Enter');
      }
      await expect.poll(() => worker.evaluate(async url => (await chrome.bookmarks.search({ url })).map(item => item.id), url))
        .toEqual(index === 0 ? [seed.second.id] : []);
      await expect(ui.getByRole('alertdialog')).toHaveCount(0);
      await expect(ui.locator('.action-menu')).toHaveCount(0);
      await expect(ui.locator('.palette-footer')).toContainText(english ? 'Bookmarks removed: 1' : '已移除 1 个书签');
      await expect(row).toHaveCount(0);
      await expect(rows).toHaveCount(2 - index);
      await expect(ui.locator('#justonehop-results [aria-selected="true"]')).toHaveAttribute('id', next);
      await expect(input).toHaveValue('Bookmark item'); await expect(input).toBeFocused();
      expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 7]);
      expect(await tabs()).toEqual(beforeTabs);
      expect(await worker.evaluate(async id => (await chrome.bookmarks.get(id))[0], seed.neighbor.id)).toMatchObject({ id: seed.neighbor.id, title: seed.neighbor.title, url: seed.neighbor.url });
    }
    await ui.keyboard.type('X');
    await expect(input).toHaveValue('BoXk item');
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true, headed: true } });
  test('bookmark Enter navigates the source tab from a native panel', async () => {
    await worker.evaluate(async base => { await chrome.bookmarks.create({ title: 'BookmarkAcceptance', url: `${base}/Bookmarked` }); }, origin);
    const { source, palette } = await openNativePalette();
    const input = palette.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await input.fill('BookmarkAcceptance');
    await expect(palette.locator('#justonehop-results [aria-selected="true"]')).toHaveClass(/bookmark/);
    await input.press('Enter').catch(error => { if (!palette.isClosed()) throw error; });
    await expect.poll(() => worker.evaluate(id => chrome.tabs.get(id).then(tab => tab.url), source.tabId)).toBe(`${origin}/Bookmarked`);
    await expect.poll(() => palette.isClosed()).toBe(true);
  });
});

test('close others preserves pinned tabs and another window; restore is functional', async () => {
  const seed = await ui.evaluate(async base => {
    const self = (await chrome.tabs.getCurrent())!;
    const pinned = await chrome.tabs.create({ url: `${base}/Pinned`, pinned: true, active: false });
    const disposable = await chrome.tabs.create({ url: `${base}/Disposable`, active: false });
    const other = await chrome.windows.create({ url: `${base}/Other-window`, focused: false });
    return { self: self.id!, pinned: pinned.id!, disposable: disposable.id!, other: other!.tabs![0].id! };
  }, origin);
  await expect.poll(() => worker.evaluate(id => chrome.tabs.get(id).then(tab => tab.status), seed.disposable)).toBe('complete');
  await ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' }).fill('close other');
  await expect(ui.locator('#justonehop-results [aria-selected="true"]')).toContainText('关闭其他');
  await ui.keyboard.press('Enter');
  await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(t => t.id === id), seed.disposable)).toBe(false);
  const survivors = await worker.evaluate(async () => (await chrome.tabs.query({})).map(t => t.id));
  expect(survivors).toContain(seed.pinned); expect(survivors).toContain(seed.other);
  await expect(ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' })).toHaveValue('close other');
  await expect(ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' })).toBeFocused();
  await expect(ui.getByRole('dialog')).toHaveCount(0);
  const restorable = await ui.evaluate(async base => (await chrome.tabs.create({ url: `${base}/Restore-Target`, active: false })).id!, origin);
  await expect.poll(() => worker.evaluate(id => chrome.tabs.get(id).then(tab => tab.status), restorable)).toBe('complete');
  await ui.evaluate(id => chrome.tabs.remove(id), restorable);
  await ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' }).fill('restore');
  await expect(ui.locator('#justonehop-results [aria-selected="true"]')).toContainText('恢复');
  await ui.keyboard.press('Enter');
  await expect.poll(() => worker.evaluate(async base => (await chrome.tabs.query({})).some(t => t.url === `${base}/Restore-Target`), origin)).toBe(true);
});

test('IME Enter does not execute and the popup has no horizontal overflow', async () => {
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
  const count = await ui.evaluate(() => chrome.tabs.query({}).then(tabs => tabs.length));
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true, bubbles: true });
  expect(await ui.evaluate(() => chrome.tabs.query({}).then(tabs => tabs.length))).toBe(count);
  expect(await ui.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(750);
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('palette.png') });
});

test.describe(() => {
  test.use({ environment: { ...defaults, pageAccess: true } });
  test('overlay isolates page styles and restores real typing focus after Escape', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/Focus-fixture`);
  await page.addStyleTag({ content: 'dialog { display:none!important } button {color:red!important}' });
  await page.getByRole('textbox', { name: 'Page input' }).fill('before');
  const tabId = await ui.evaluate(async base => (await chrome.tabs.query({})).find(tab => tab.url === `${base}/Focus-fixture`)!.id!, origin);
  await worker.evaluate(async id => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(id, { source: 'justonehop', type: 'toggle' });
  }, tabId);
  await expect(page.locator('#justonehop-command-palette')).toBeAttached();
  const cdp = await context.newCDPSession(page);
  const comboValue = async () => {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
    const { nodes } = await cdp.send('Accessibility.getFullAXTree', { frameId });
    const combo = nodes.find(node => node.role?.value === 'combobox');
    return combo ? combo.value?.value ?? '' : undefined;
  };
  await expect.poll(comboValue).toBe('');
  await page.screenshot({ path: test.info().outputPath('overlay-refined.png'), animations: 'disabled' });
  await page.keyboard.type('example');
  await expect.poll(comboValue).toBe('example');
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('close right');
  await expect.poll(comboValue).toBe('close right');
  await page.screenshot({ path: test.info().outputPath('overlay.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 400 });
  await page.keyboard.press('Meta+k');
  await expect.poll(comboValue).toBe('');
  await page.screenshot({ path: test.info().outputPath('overlay-narrow-actions.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect.poll(comboValue).toBe('close right');
  await page.keyboard.press('Escape');
  await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
  await expect(page.getByRole('textbox', { name: 'Page input' })).toBeFocused();
  await page.keyboard.type('-after');
  await expect(page.getByRole('textbox', { name: 'Page input' })).toHaveValue('before-after');
  const tabCount = await worker.evaluate(() => chrome.tabs.query({}).then(tabs => tabs.length));
  await worker.evaluate(id => chrome.tabs.sendMessage(id, { source: 'justonehop', type: 'toggle' }), tabId);
  await expect.poll(comboValue).toBe('');
  await page.keyboard.type('new');
  await expect.poll(comboValue).toBe('new');
  await page.keyboard.press('Enter');
  await expect.poll(() => worker.evaluate(() => chrome.tabs.query({}).then(tabs => tabs.length))).toBe(tabCount + 1);
  await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
});
});

test('Raycast navigation pages, jumps to home endpoints and restores caret when actions close', async () => {
  await ui.evaluate(async base => {
    for (let i = 0; i < 12; i++) await chrome.tabs.create({ url: `${base}/Navigation-${i}`, active: false });
    await chrome.bookmarks.create({ title: 'Navigation Bookmark', url: `${base}/Navigation-Bookmark` });
  }, origin);
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
  await input.fill('');
  await expect(ui.locator('.section-start')).toHaveCount(0);
  await expect(ui.locator('.suggested-label')).toHaveCount(0);
  await input.press('Meta+ArrowUp');
  await expect(ui.locator('.result').first()).toHaveAttribute('aria-selected', 'true');
  await input.press('Meta+ArrowDown');
  await expect(ui.locator('.result').last()).toHaveAttribute('aria-selected', 'true');
  await input.press('Meta+ArrowUp');
  await expect(ui.locator('#justonehop-results [aria-selected="true"]')).toHaveAttribute('id', await ui.locator('.result').first().getAttribute('id') as string);
  await input.press('PageDown');
  const selectedIndex = await ui.locator('.result').evaluateAll(rows => rows.findIndex(row => row.getAttribute('aria-selected') === 'true'));
  expect(selectedIndex).toBeGreaterThan(1);
  await input.press('PageUp');
  await expect(ui.locator('.result').first()).toHaveAttribute('aria-selected', 'true');
  await input.fill('reload');
  await input.evaluate((element: HTMLInputElement) => element.setSelectionRange(2, 5));
  await input.press('Meta+k');
  const actionInput = ui.getByRole('combobox', { name: '搜索操作' });
  await expect(actionInput).toBeFocused();
  await actionInput.press('Tab');
  await expect(actionInput).toBeFocused();
  await actionInput.press('Meta+k');
  await expect(input).toBeFocused();
  expect(await input.evaluate((element: HTMLInputElement) => [element.selectionStart, element.selectionEnd])).toEqual([2, 5]);
  await expect(input).toHaveValue('reload');
});

test('stationary pointer does not steal keyboard selection; modified Enter does not execute', async () => {
  const rows = ui.locator('.result');
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
  await rows.nth(1).dispatchEvent('mousemove', { screenX: 100, screenY: 100 });
  await rows.nth(1).dispatchEvent('mousemove', { screenX: 101, screenY: 101 });
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
  await input.press('ArrowDown');
  await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'true');
  await rows.nth(1).dispatchEvent('mousemove', { screenX: 101, screenY: 101 });
  await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'true');
  await input.fill('new');
  const count = await ui.evaluate(() => chrome.tabs.query({}).then(tabs => tabs.length));
  await input.press('Meta+Enter');
  expect(await ui.evaluate(() => chrome.tabs.query({}).then(tabs => tabs.length))).toBe(count);
});

test('light and dark surfaces, compact rows and bottom action search fit without clipping', async () => {
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
  await ui.evaluate(async base => {
    await chrome.tabs.create({ url: `${base}/Design-System`, active: false });
    await chrome.bookmarks.create({ title: 'Raycast Manual', url: 'https://manual.raycast.com' });
  }, origin);
  await ui.setViewportSize({ width: 750, height: 516 });
  for (const theme of ['light', 'dark'] as const) {
    await ui.emulateMedia({ colorScheme: theme });
    await input.fill('');
    expect((await ui.locator('.result').first().boundingBox())!.height).toBe(40);
    await expect(ui.locator('.section-start')).toHaveCount(0);
    await expect(ui.locator('.suggested-label')).toHaveCount(0);
    await ui.locator('.palette').screenshot({ path: test.info().outputPath(`palette-${theme}.png`) });
    await input.fill('Design System');
    await expect(ui.locator('.result')).toHaveCount(1);
    await input.press('Meta+k');
    const searchBox = await ui.locator('.action-search').boundingBox();
    const actionList = await ui.locator('.action-list').boundingBox();
    expect(searchBox!.y).toBeGreaterThanOrEqual(actionList!.y + actionList!.height - 1);
    await ui.locator('.palette').screenshot({ path: test.info().outputPath(`actions-${theme}.png`) });
    await ui.keyboard.press('Escape');
  }
});

for (const variant of ['English', 'fallback', 'Taiwan']) {
  test.describe(() => {
    test.use({ environment: { ...defaults, locale: variant === 'English' ? 'en-US' : variant === 'fallback' ? 'fr-FR' : 'zh-TW' } });
    test(`${variant} locale resolves manifest, commands, actions, counts and errors`, async () => {
    const chinese = variant === 'Taiwan';
    const input = ui.getByRole('combobox', { name: chinese ? '搜索命令、标签页、书签和历史' : 'Search commands, tabs, bookmarks, and history' });
    await expect(input).toBeFocused();
    expect(await ui.evaluate(() => chrome.runtime.getManifest().name)).toBe(chinese ? '小范围瞬移' : 'JustOneHop');
    await expect(ui.locator('.navigation-label')).toHaveText(chinese ? ['上一个', '下一个'] : ['Previous', 'Next']);
    if (!chinese) expect(await ui.locator('.justonehop-app').innerText()).not.toMatch(/[\p{Script=Han}]/u);
    await input.fill('刷新');
    await expect(ui.locator('.result')).toHaveCount(1);
    await expect(ui.locator('.result')).toContainText(chinese ? '刷新当前标签页' : 'Reload Current Tab');
    await expect(ui.locator('.result-status')).toContainText(chinese ? '1 个结果' : '1 result');
    await input.press('Meta+k');
    const actions = ui.getByRole('combobox', { name: chinese ? '搜索操作' : 'Search actions' });
    await expect(actions).toBeFocused();
    await actions.fill('not-a-real-action');
    await expect(ui.locator('.action-empty')).toHaveText(chinese ? '没有匹配的操作' : 'No matching actions');
    await actions.press('Escape');
    await input.fill('restore');
    await input.press('Enter');
    await expect(ui.getByRole('alert')).toContainText(chinese ? '没有可以恢复的标签页。' : 'No recently closed tabs to restore.');
    await input.fill('close right');
    await expect(ui.locator('.footer-status')).toHaveText(chinese ? '将关闭 0 个标签页' : 'Will close 0 tabs');
    await ui.setViewportSize({ width: 390, height: 400 });
    // Use the same responsive palette surface as an overlay for layout assertions.
    await ui.locator('.justonehop-app').evaluate(node => { node.classList.replace('popup', 'overlay'); document.body.style.width = '390px'; });
    const footer = await ui.locator('.footer').boundingBox();
    const button = await ui.getByRole('button', { name: chinese ? '打开操作菜单' : 'Open action menu' }).boundingBox();
    expect(button!.x + button!.width).toBeLessThanOrEqual(footer!.x + footer!.width);
    await ui.locator('.palette').screenshot({ path: test.info().outputPath(`i18n-${variant.toLowerCase()}.png`) });
  });
  });
}

test('settings language and theme persist, synchronize, and preserve search focus', async () => {
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
  await input.fill('reload');
  await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 5));
  await input.press('Meta+,');
  await expect(ui.getByRole('region', { name: '设置', exact: true })).toBeVisible();
  await expect(ui.getByRole('textbox', { name: '搜索设置', exact: true })).toBeFocused();
  const language = ui.getByRole('combobox', { name: '语言', exact: true });
  await language.click();
  await ui.keyboard.press('Escape');
  await expect(language).toHaveAttribute('aria-expanded', 'false');
  await expect(ui.getByRole('region', { name: '设置', exact: true })).toBeVisible();
  await language.press('Enter');
  await language.press('End');
  await language.press('Enter');
  await expect(ui.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  await expect(ui.getByRole('combobox', { name: 'Language', exact: true })).toBeFocused();
  await expect(ui.locator('.operation-feedback')).toHaveText('Language set to English');
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ preferences: { language: string } }>('preferences')).preferences.language)).toBe('en');
  await ui.emulateMedia({ colorScheme: 'light' });
  const theme = ui.getByRole('combobox', { name: 'Theme', exact: true });
  await theme.click();
  await ui.getByRole('option', { name: 'Dark', exact: true }).click();
  await expect(ui.locator('.justonehop-app')).toHaveAttribute('data-theme', 'dark');
  await expect(ui.locator('.palette')).toHaveCSS('background-color', 'rgb(41, 42, 45)');
  await expect(ui.locator('.operation-feedback')).toHaveText('Theme set to Dark');
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('settings-dark.png') });
  await theme.press('Escape');
  await expect(ui.locator('.operation-feedback')).toHaveText('Theme set to Dark');
  const englishInput = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await expect(englishInput).toHaveValue('reload');
  await expect(englishInput).toBeFocused();
  expect(await englishInput.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 5]);
  await expect(ui.locator('.result[aria-selected="true"]')).toContainText('Reload Current Tab');
  // A fresh UI reads stored preferences before its first paint.
  const second = await context.newPage(); await second.goto(popupUrl);
  await expect(second.locator('.justonehop-app')).toHaveAttribute('lang', 'en');
  await expect(second.locator('.justonehop-app')).toHaveAttribute('data-theme', 'dark');
  await second.keyboard.press('Meta+,');
  await second.getByRole('combobox', { name: 'Language', exact: true }).click();
  await second.getByRole('option', { name: '简体中文', exact: true }).click();
  await expect(ui.locator('.result[aria-selected="true"]')).toContainText('刷新当前标签页');
  await expect(second.getByRole('region', { name: '设置', exact: true })).toBeVisible();
  await second.getByRole('combobox', { name: '主题', exact: true }).click();
  await second.getByRole('option', { name: '浅色', exact: true }).click();
  await ui.emulateMedia({ colorScheme: 'dark' });
  await expect(ui.locator('.palette')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await second.getByRole('combobox', { name: '主题', exact: true }).click();
  await second.getByRole('option', { name: '跟随系统', exact: true }).click();
  await expect(ui.locator('.palette')).toHaveCSS('background-color', 'rgb(41, 42, 45)');
  await second.getByRole('combobox', { name: '语言', exact: true }).click();
  await second.getByRole('option', { name: '跟随系统', exact: true }).click();
  await expect(second.getByText('系统语言：简体中文（Chrome 界面语言）')).toBeVisible();
  await expect(second.locator('.operation-feedback')).toHaveText('语言已切换为跟随系统');
  await second.reload();
  await expect(second.locator('.justonehop-app')).toHaveAttribute('lang', 'zh-CN');
  await expect(second.locator('.justonehop-app')).toHaveAttribute('data-theme', 'system');
  await second.close();
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', toolbarMenus: true } });
  test('Toolbar menu opens shortcuts and searchable standalone Help', async () => {
    const items = () => worker.evaluate(() => (globalThis as any).__toolbarItems as Record<string, { title: string; contexts: string[] }>);
    const shortcut = await worker.evaluate(async () => (await chrome.commands.getAll()).find(command => command.name === 'toggle-palette')!.shortcut!);
    await expect.poll(async () => Object.keys(await items()).length).toBe(2);
    expect(await items()).toEqual({
      'justonehop-toolbar-shortcut': { id: 'justonehop-toolbar-shortcut', title: `Open JustOneHop: ${shortcut} · Change shortcut`, contexts: ['action'] },
      'justonehop-toolbar-help': { id: 'justonehop-toolbar-help', title: 'Help', contexts: ['action'] },
    });
    await expect(ui.locator('.launch-hint')).toHaveCount(0);
    await ui.goto('chrome://settings/');
    const source = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'chrome://settings/' }))[0]);
    async function clickMenu(id: string) {
      await worker.evaluate(({ id, source }) => {
        for (const callback of (globalThis as any).__toolbarClicks) callback({ menuItemId: id }, source);
      }, { id, source });
    }
    async function openHelp() {
      const created = context.waitForEvent('page');
      await clickMenu('justonehop-toolbar-help');
      const page = await created;
      await expect(page).toHaveURL(popupUrl.replace('popup.html', 'help.html'));
      return page;
    }
    const page = await openHelp();
    const search = page.getByRole('textbox', { name: 'Search help', exact: true });
    const article = page.getByRole('article');
    await expect(search).toBeFocused();
    await expect(article).toContainText(shortcut);
    const githubPromise = context.waitForEvent('page');
    await page.locator('.help-github-card').click();
    const githubPage = await githubPromise;
    expect(githubPage.url()).toContain('github.com/lyyourc/JustOneHop');
    await githubPage.close();
    expect(await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0].windowId, page.url())).toBe(source.windowId);
    await expect(ui).toHaveURL('chrome://settings/');
    await search.fill('cookies');
    await expect(article.getByRole('heading')).toHaveText('View website storage');
    await search.press('Backspace'); await expect(search).toHaveValue('cookie');
    await page.locator('.search-clear').click();
    await search.press('Tab'); await page.keyboard.press('Tab'); await expect(article).toBeFocused();
    await article.press('PageDown'); await expect.poll(() => article.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await article.press('Tab'); await expect(page.locator('.primary-action')).toBeFocused();
    await page.setViewportSize({ width: 390, height: 400 });
    for (const theme of ['light', 'dark']) {
      await worker.evaluate(async theme => chrome.storage.local.set({ preferences: { language: 'zh', theme } }), theme);
      await expect(page.locator('.justonehop-app')).toHaveAttribute('data-theme', theme);
      await expect(page).toHaveTitle('使用帮助 · 小范围瞬移');
      await expect(page.locator('.primary-action')).toHaveText('关闭帮助esc');
      expect(await article.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      const footer = await page.locator('.palette-footer').boundingBox();
      expect(footer!.y + footer!.height).toBeLessThanOrEqual(400);
      await page.screenshot({ path: test.info().outputPath(`toolbar-help-${theme}.png`) });
    }
    await expect.poll(async () => (await items())['justonehop-toolbar-shortcut'].title).toBe(`打开小范围瞬移：${shortcut} · 修改快捷键`);
    await expect.poll(async () => (await items())['justonehop-toolbar-help'].title).toBe('使用帮助');
    await page.getByRole('button', { name: '关闭帮助', exact: true }).last().click();
    await expect.poll(() => page.isClosed()).toBe(true);
    async function closeWithKey(key: string) {
      const help = await openHelp();
      await expect(help.getByRole('textbox')).toBeFocused();
      await help.getByRole('textbox').press(key).catch(error => {
        // The handler closes its own tab before Playwright's key-up completes.
        if (!help.isClosed() || !String(error).includes('Target page, context or browser has been closed')) throw error;
      });
      await expect.poll(() => help.isClosed()).toBe(true);
      await expect(ui).toHaveURL('chrome://settings/');
    }
    await closeWithKey('Escape');
    await closeWithKey('Backspace');
    const shortcutsCreated = context.waitForEvent('page');
    await clickMenu('justonehop-toolbar-shortcut');
    const shortcuts = await shortcutsCreated;
    await expect(shortcuts).toHaveURL('chrome://extensions/shortcuts');
    await clickMenu('justonehop-toolbar-shortcut');
    await expect.poll(async () => worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, url: 'chrome://extensions/shortcuts' })).length, source.windowId)).toBe(1);
    await expect(ui).toHaveURL('chrome://settings/');
  });
});

for (const locale of ['en-US', 'zh-CN'] as const) test.describe(() => {
  test.use({ environment: { ...defaults, locale } });
  test(`Help document entry and return context ${locale}`, async () => {
    const english = locale === 'en-US';
    const helpName = english ? 'Help' : '使用帮助';
    const readName = english ? 'Read Help' : '查看帮助';
    const input = ui.getByRole('combobox', { name: english ? 'Search commands, tabs, bookmarks, and history' : '搜索命令、标签页、书签和历史' });
    const article = ui.getByRole('article', { name: helpName });
    const helpSearch = ui.getByRole('textbox', { name: english ? 'Search help' : '搜索帮助', exact: true });
    const originalFooter = await ui.locator('.palette-footer').boundingBox();
    const shortcut = await worker.evaluate(async () => (await chrome.commands.getAll()).find(command => command.name === 'toggle-palette')!.shortcut!);
    await expect(ui.locator('.launch-hint')).toHaveCount(0);
    await input.fill('help');
    await expect(ui.locator('.launch-hint')).toHaveCount(0);
    await input.press('Home'); await input.press('Shift+ArrowRight');
    await input.press('Enter');
    await expect(helpSearch).toBeFocused();
    await expect(article.getByRole('heading')).toHaveCount(5);
    await expect(article).toContainText(shortcut);
    const githubPromise = context.waitForEvent('page');
    await ui.locator('.help-github-card').click();
    const githubPage = await githubPromise;
    expect(githubPage.url()).toContain('github.com/lyyourc/JustOneHop');
    await githubPage.close();
    await helpSearch.fill('cookies');
    await expect(article.getByRole('heading')).toHaveText(english ? 'View website storage' : '查看网站存储');
    await expect(article.locator('mark').first()).toContainText(/cookies/i);
    const headingBox = await article.getByRole('heading').boundingBox();
    const searchBox = await ui.locator('.help-search').boundingBox();
    expect(headingBox!.y - (searchBox!.y + searchBox!.height)).toBeLessThanOrEqual(12);
    await ui.locator('.palette').screenshot({ path: test.info().outputPath(`help-${locale}-filtered.png`) });
    await helpSearch.fill(english ? '查看网站存储' : 'view website storage');
    await expect(article.getByRole('heading')).toHaveCount(1);
    await helpSearch.fill('135');
    await expect(article.getByRole('heading')).toHaveCount(0);
    await helpSearch.fill('zzzz-no-help');
    await expect(article.getByRole('heading')).toHaveCount(0);
    await expect(article.getByText(english ? 'No results found' : '没有找到匹配结果')).toBeVisible();
    await helpSearch.press('Backspace'); await expect(helpSearch).toHaveValue('zzzz-no-hel');
    await article.getByRole('button', { name: english ? 'Clear search' : '清空搜索' }).click();
    await expect(helpSearch).toBeFocused(); await expect(helpSearch).toHaveValue('');
    await helpSearch.press('Tab'); await expect(ui.locator('.help-search .search-dismiss')).toBeFocused();
    await ui.keyboard.press('Tab'); await expect(article).toBeFocused();
    await article.press('PageDown');
    await expect.poll(() => article.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await article.press('Home'); expect(await article.evaluate(el => el.scrollTop)).toBe(0);
    await article.press('ArrowDown'); await expect.poll(() => article.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await article.press('Home');
    await article.press('Tab'); await expect(ui.locator('.footer-back')).toBeFocused();
    await ui.keyboard.press('Shift+Tab'); await expect(article).toBeFocused();
    await article.press('Escape');
    await expect(input).toBeFocused(); await expect(input).toHaveValue('help');
    expect(await input.evaluate(el => [(el as HTMLInputElement).selectionStart, (el as HTMLInputElement).selectionEnd])).toEqual([0, 1]);
    await expect(ui.locator('.result[aria-selected="true"]')).toContainText(helpName);

    // Mouse entry and footer return use the same document as keyboard search.
    await ui.locator('.settings-button').click();
    await expect(ui.locator('.settings-preferences > div').last()).toHaveAttribute('data-setting', 'help');
    const settingsSearch = ui.getByRole('textbox', { name: english ? 'Search settings' : '搜索设置', exact: true });
    await settingsSearch.fill(english ? '帮助' : 'help');
    await expect(ui.locator('[data-setting]')).toHaveCount(1);
    await ui.getByRole('button', { name: readName }).click();
    await expect(helpSearch).toBeFocused();
    await expect(article).toContainText(shortcut);
    expect((await ui.locator('.palette-footer').boundingBox())!.y).toBe(originalFooter!.y);
    await ui.locator('.footer-back').click();
    await expect(settingsSearch).toHaveValue(english ? '帮助' : 'help');
    await expect(ui.getByRole('button', { name: readName })).toBeFocused();
    await ui.keyboard.press('Enter'); await expect(helpSearch).toBeFocused();
    await ui.keyboard.press('Backspace');
    await expect(ui.getByRole('button', { name: readName })).toBeFocused();
    await ui.keyboard.press('Escape'); await expect(input).toBeFocused();

    await input.fill('使用说明');
    await ui.locator('.result').first().click();
    await expect(helpSearch).toBeFocused();
    await ui.setViewportSize({ width: 390, height: 400 });
    await ui.locator('.justonehop-app').evaluate(node => { node.classList.replace('popup', 'overlay'); document.body.style.width = '390px'; });
    for (const theme of ['light', 'dark']) {
      await ui.evaluate(async theme => { await chrome.storage.local.set({ preferences: { language: 'system', theme } }); }, theme);
      await expect(ui.locator('.justonehop-app')).toHaveAttribute('data-theme', theme);
      expect(await article.evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight > el.clientHeight)).toBe(true);
      const footer = await ui.locator('.palette-footer').boundingBox();
      expect(footer!.height).toBe(44); expect(footer!.y + footer!.height).toBeLessThanOrEqual(400);
      await ui.locator('.palette').screenshot({ path: test.info().outputPath(`help-${locale}-${theme}-narrow.png`) });
    }
    await ui.locator('.footer-back').click();
    await expect(input).toBeFocused(); await expect(input).toHaveValue('使用说明');
    await ui.keyboard.press('Meta+k');
    await ui.locator('.action-row').first().click();
    await expect(helpSearch).toBeFocused();
    await helpSearch.fill('cookie');
    await ui.locator('.help-search .search-clear').click();
    await expect(helpSearch).toBeFocused(); await expect(helpSearch).toHaveValue('');
    await helpSearch.fill('cookie');
    await ui.locator('.help-search .search-dismiss').click();
    await expect(helpSearch).toHaveValue(''); await expect(helpSearch).toBeFocused();
    await ui.locator('.help-search .search-dismiss').click(); await expect(input).toBeFocused();
    await expect(ui.locator('.action-menu')).toHaveCount(0);
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('Palette startup renders a recoverable error when background messages fail', async () => {
    const errors: string[] = [];
    ui.on('pageerror', error => errors.push(error.message));
    ui.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await ui.addInitScript(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = ((message: { type?: string }) =>
        ['palette-state', 'snapshot', 'cancel-palette-continuation'].includes(message?.type || '')
          ? Promise.reject(new Error('Receiving end does not exist')) : send(message)) as typeof chrome.runtime.sendMessage;
    });
    await ui.reload();
    await expect(ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' })).toBeVisible();
    await expect(ui.getByRole('alert')).toContainText('The extension disconnected');
    await ui.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(ui.getByRole('alert')).toContainText('The extension disconnected');
    expect(errors).toEqual([]);
  });

  test('English settings entries, narrow layout and Chrome hotkey settings', async () => {
  const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  const mainFooter = await ui.locator('.palette-footer').boundingBox();
  const mainHeader = await ui.locator('.search-bar').boundingBox();
  await expect(ui.locator('.result.command .entry-title').nth(0)).toHaveText('JustOneHop Settings');
  await expect(ui.locator('.result.command .entry-title').nth(1)).toHaveText('JustOneHop: Help');
  await ui.locator('[id="justonehop-command:help"]').click();
  await expect(ui.locator('.help-view')).toBeVisible();
  await ui.keyboard.press('Escape');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
  await expect(ui.locator('[id="justonehop-command:help"]')).toHaveAttribute('aria-selected', 'true');
  await input.press('Enter');
  await expect(ui.locator('.help-view')).toBeVisible();
  await ui.locator('.help-view .footer-back').click();
  await expect(input).toBeFocused();
  await input.fill('设置');
  await expect(ui.locator('.result').first()).toContainText('Settings');
  await expect(ui.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
  await input.press('Enter');
  await expect(ui.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  await expect(ui.locator('[data-setting="keyboard"] .hotkey-value')).toHaveText(await worker.evaluate(async () => (await chrome.commands.getAll()).find(c => c.name === 'toggle-palette')!.shortcut!));
  await expect(ui.locator('[data-setting="binding"] .hotkey-value')).toHaveText(await worker.evaluate(async () => (await chrome.commands.getAll()).find(c => c.name === 'switch-recent')?.shortcut || 'Not assigned'));
  await expect(ui.locator('[data-setting="binding"] label')).toHaveText('Tab Switcher');
  await expect(ui.locator('[data-setting="binding"] p')).toHaveText('Switch tabs like in VS Code using the shortcut shown. Prefer Ctrl+Tab? Set it up once.');
  await expect(ui.locator('[data-setting="keyboard"] .hotkey-value')).toHaveAttribute('title', /(?:Shift \+ Command|Command \+ Shift) \+ P — Open \/ Close JustOneHop/);
  await expect(ui.locator('[data-setting="binding"] .hotkey-value')).toHaveAttribute('title', / — Switch tabs like in VS Code using the shortcut shown\./);
  await expect(ui.locator('[data-setting="binding"] .hotkey-value')).toHaveAttribute('aria-label', await ui.locator('[data-setting="binding"] .hotkey-value').getAttribute('title') as string);
  await ui.locator('[data-setting="language"] label').hover();
  for (const label of await ui.locator('.setting-copy label:not([for])').all()) {
    await expect(label).toHaveCSS('cursor', 'default');
  }
  await expect(ui.locator('.setting-copy label[for]')).toHaveCSS('cursor', 'pointer');
  await expect(ui.locator('.settings-body h2')).toHaveText(['General', 'Keyboard', 'Experimental Features']);
  const header = ui.locator('.settings-search');
  const headerBox = await header.boundingBox();
  expect(headerBox!.height).toBe(mainHeader!.height);
  expect(headerBox!.y).toBe(mainHeader!.y);
  const settingsSearch = ui.getByRole('textbox', { name: 'Search settings', exact: true });
  await expect(settingsSearch).toBeFocused();
  await expect(ui.locator('.settings-view .palette-footer-title')).toHaveText('Settings');
  const settingsFooter = await ui.locator('.settings-view .palette-footer').boundingBox();
  expect(settingsFooter!.y).toBe(mainFooter!.y);
  expect(settingsFooter!.height).toBe(44);
  await expect(settingsSearch).toBeFocused();
  await ui.locator('.settings-view .footer-back').click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('设置');
  await input.press('Enter');
  const preferences = ui.locator('.settings-preferences');
  const language = preferences.getByRole('combobox', { name: 'Language', exact: true });
  const theme = preferences.getByRole('combobox', { name: 'Theme', exact: true });
  const languageBox = await language.boundingBox(), themeBox = await theme.boundingBox();
  expect(themeBox!.y).toBeGreaterThan(languageBox!.y + languageBox!.height);
  expect(themeBox!.x).toBe(languageBox!.x);
  expect(themeBox!.width).toBe(languageBox!.width);
  const experiments = ui.locator('.settings-experiments');
  await expect(ui.locator('[data-setting="tabs"] > .setting-row p')).toContainText('Pages stay open.');
  await expect(ui.locator('.tuck-settings')).toHaveCount(0);
  await expect(experiments.getByRole('switch')).toHaveCount(1);
  await expect(experiments.getByRole('button')).toHaveText(['How it works', 'Reset Ranking']);
  const changeButton = ui.getByRole('button', { name: 'Change in Chrome' });
  await expect(changeButton).toHaveCSS('height', '32px');
  await expect(changeButton).toHaveCSS('border-radius', '100px');
  await expect(changeButton).toHaveCSS('font-weight', '500');
  await expect(language).toHaveCSS('height', '32px');
  await expect(language).toHaveCSS('border-radius', '8px');
  await expect(language).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(ui.locator('.settings-page .footer-divider')).toHaveCount(0);
  const navigation = ui.locator('.settings-navigation');
  await expect(navigation.locator('.navigation-key')).toHaveText(['TabNext', 'Shift+TabPrevious']);
  await expect(navigation.locator('kbd')).toHaveText(['Tab', 'Shift+Tab']);
  await expect(navigation).toHaveAttribute('title', 'Tab moves to the next control; Shift+Tab moves to the previous control.');
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('settings-light.png') });
  // Tab follows visible controls and wraps through the footer back to search.
  const controls = [header.locator('.search-dismiss'), language, theme, ui.getByRole('button', { name: 'Read Help' }), ui.getByRole('button', { name: 'Change in Chrome' }),
    ui.getByRole('button', { name: 'Set Up', exact: true }), experiments.getByRole('button', { name: 'How it works' }), experiments.getByRole('switch'),
    experiments.getByRole('button', { name: 'Reset Ranking' }),
    ui.locator('.footer-back'), header.locator('.search-focus'), settingsSearch];
  for (const control of controls) { await ui.keyboard.press('Tab'); await expect(control).toBeFocused(); }
  await ui.keyboard.press('Shift+Tab');
  await expect(header.locator('.search-focus')).toBeFocused();
  await ui.keyboard.press('Shift+Tab');
  await expect(ui.locator('.footer-back')).toBeFocused();
  await ui.keyboard.press('Tab');
  await ui.keyboard.press('Tab');
  await settingsSearch.fill('lang');
  await expect(ui.locator('.settings-body h2')).toHaveText(['General']);
  await expect(ui.locator('[data-setting]')).toHaveCount(1);
  await expect(ui.locator('[data-setting="language"] label mark')).toHaveText('Lang');
  await settingsSearch.fill('主题');
  await expect(theme).toBeVisible();
  await expect(language).toHaveCount(0);
  await settingsSearch.press('Tab');
  await expect(header.getByRole('button', { name: 'Clear search' })).toBeFocused();
  await ui.keyboard.press('Tab');
  await expect(header.locator('.search-dismiss')).toBeFocused();
  await ui.keyboard.press('Tab');
  await expect(theme).toBeFocused();
  await settingsSearch.fill('7 days');
  await expect(ui.locator('[data-setting]')).toHaveCount(1);
  await expect(ui.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await settingsSearch.press('Enter');
  await expect(ui.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await settingsSearch.fill('ranking');
  await settingsSearch.press('Enter');
  await expect(ui.getByText('Learned ranking cleared. Default ordering restored.')).toHaveCount(0);
  await settingsSearch.fill('zzzz-no-setting');
  await expect(ui.getByRole('status')).toHaveText('No results found');
  await expect(ui.locator('.settings-body h2')).toHaveCount(0);
  await ui.locator('.settings-body').getByRole('button', { name: 'Clear search' }).click();
  await expect(settingsSearch).toBeFocused();
  await expect(settingsSearch).toHaveValue('');
  await settingsSearch.fill('ctrl tab');
  await ui.getByRole('button', { name: 'Set Up', exact: true }).click();
  await expect(ui.locator('.binding-view')).toBeVisible();
  await ui.keyboard.press('Escape');
  await expect(settingsSearch).toHaveValue('ctrl tab');
  await expect(ui.getByRole('button', { name: 'Set Up', exact: true })).toBeFocused();
  await header.getByRole('button', { name: 'Clear search' }).click();
  await ui.keyboard.press('Escape');
  for (const [query, role, name] of [
    ['language', 'combobox', 'Language'], ['theme', 'combobox', 'Theme'],
    ['hotkey', 'button', 'Change in Chrome'], ['search ranking', 'button', 'Reset Ranking'],
    ['auto tuck', 'switch', 'Auto Tuck Tabs'],
  ] as const) {
    await input.fill(query);
    await expect(ui.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
    await input.press('Enter');
    await expect(ui.getByRole(role, { name, exact: true })).toBeFocused();
    await ui.keyboard.press('Escape');
    await expect(input).toHaveValue(query);
  }
  await ui.locator('.settings-button').click();
  await ui.setViewportSize({ width: 390, height: 400 });
  await ui.locator('.justonehop-app').evaluate(node => { node.classList.replace('popup', 'overlay'); document.body.style.width = '390px'; });
  expect(await ui.locator('.settings-body').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const palette = await ui.locator('.palette').boundingBox();
  expect(palette!.y + palette!.height).toBeLessThanOrEqual(400);
  await expect(navigation).toBeVisible();
  const footer = await ui.locator('.settings-view .palette-footer').boundingBox();
  expect(footer!.height).toBe(44);
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(palette!.y + palette!.height);
  const narrowLanguage = await language.boundingBox(), narrowTheme = await theme.boundingBox();
  expect(narrowTheme!.y).toBeGreaterThan(narrowLanguage!.y + narrowLanguage!.height);
  await ui.getByRole('combobox', { name: 'Language', exact: true }).click();
  await expect(ui.locator('.choice-option').first()).toHaveCSS('min-height', '32px');
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('settings-select-narrow.png') });
  const menu = await ui.locator('.choice-menu').boundingBox();
  const body = await ui.locator('.settings-body').boundingBox();
  expect(menu!.y).toBeGreaterThanOrEqual(body!.y);
  expect(menu!.y + menu!.height).toBeLessThanOrEqual(body!.y + body!.height);
  await ui.getByRole('option', { name: '简体中文', exact: true }).click();
  await expect(ui.getByRole('region', { name: '设置', exact: true })).toBeVisible();
  await expect(ui.locator('.settings-body h2')).toHaveText(['通用', '键盘', '实验性功能']);
  await expect(navigation.locator('.navigation-key')).toHaveText(['Tab下一个', 'Shift+Tab上一个']);
  await expect(navigation.locator('kbd')).toHaveText(['Tab', 'Shift+Tab']);
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('settings-narrow.png') });
  const nextPage = context.waitForEvent('page');
  await ui.getByRole('button', { name: '前往修改' }).click();
  const shortcuts = await nextPage;
  await expect(shortcuts).toHaveURL('chrome://extensions/shortcuts');
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English override localizes errors and reverting language follows Chrome', async () => {
  // Override the browser's English locale without changing the browser itself.
  await ui.getByRole('button', { name: 'Settings', exact: true }).click();
  await ui.getByRole('combobox', { name: 'Language', exact: true }).click();
  await ui.getByRole('option', { name: '简体中文', exact: true }).click();
  await ui.keyboard.press('Escape');
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
  await input.fill('restore'); await input.press('Enter');
  await expect(ui.getByRole('alert')).toContainText('没有可以恢复的标签页。');
  await input.press('Meta+,');
  await ui.getByRole('combobox', { name: '语言', exact: true }).click();
  await ui.getByRole('option', { name: '跟随系统', exact: true }).click();
  await expect(ui.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  await expect(ui.getByText('System language: English (Chrome interface)')).toBeVisible();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, pageAccess: true } });
  test('overlay settings keyboard navigation and preferences work in the isolated frame', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Settings-fixture`);
  await page.getByRole('textbox', { name: 'Page input' }).fill('before');
  const tabId = await worker.evaluate(async base => (await chrome.tabs.query({})).find(tab => tab.url === `${base}/Settings-fixture`)!.id!, origin);
  await worker.evaluate(async id => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(id, { source: 'justonehop', type: 'toggle' });
  }, tabId);
  const cdp = await context.newCDPSession(page);
  const ax = async () => {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
    return (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes;
  };
  await expect.poll(async () => (await ax()).some(n => n.role?.value === 'combobox')).toBe(true);
  await page.keyboard.type('reload');
  await page.keyboard.press('Meta+,');
  await expect.poll(async () => (await ax()).some(n => n.role?.value === 'region' && n.name?.value === '设置')).toBe(true);
  await expect.poll(async () => (await ax()).some(n => n.role?.value === 'textbox' && n.name?.value === '搜索设置' && n.properties?.some(p => p.name === 'focused' && p.value.value === true))).toBe(true);
  await page.keyboard.type('theme');
  await expect.poll(async () => (await ax()).filter(n => n.role?.value === 'combobox').map(n => n.name?.value)).toEqual(['主题']);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Backspace');
  await expect.poll(async () => (await ax()).find(n => n.role?.value === 'textbox')?.value?.value).toBe('them');
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Shift+Tab'); // Search focus logo
  await page.keyboard.press('Shift+Tab'); // Footer back
  await expect.poll(async () => (await ax()).some(n => n.role?.value === 'button' && n.name?.value === '返回' && n.properties?.some(p => p.name === 'focused' && p.value.value === true))).toBe(true);
  await page.keyboard.press('Tab'); // Search focus logo
  await page.keyboard.press('Tab'); // Search
  await page.keyboard.press('Tab'); // Search Escape button
  await page.keyboard.press('Tab'); // Language
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await ax()).some(n => n.role?.value === 'region' && n.name?.value === 'Settings')).toBe(true);
  await page.keyboard.press('Tab'); // Theme
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('preferences')).preferences)).toEqual({ language: 'en', theme: 'dark', autoTuck: false, autoTuckAfterHours: 168 });
  await expect.poll(async () => (await ax()).some(n => n.role?.value === 'StaticText' && n.name?.value === 'Theme set to Dark')).toBe(true);
  await page.screenshot({ path: test.info().outputPath('settings-overlay.png') });
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await ax()).some(n => n.role?.value === 'StaticText' && n.name?.value === 'Theme set to Dark')).toBe(true);
  await expect.poll(async () => (await ax()).find(n => n.role?.value === 'combobox')?.value?.value).toBe('reload');
  await page.keyboard.press('Escape');
  await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
  await expect(page.getByRole('textbox', { name: 'Page input' })).toBeFocused();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English settings report failed saves and allow retry without losing current preferences', async () => {
  await ui.locator('.settings-button').click();
  await ui.evaluate(() => {
    const original = chrome.storage.local.set.bind(chrome.storage.local);
    let fail = true;
    chrome.storage.local.set = ((...args: Parameters<typeof chrome.storage.local.set>) => {
      if (fail) { fail = false; return Promise.reject(new Error('Test storage unavailable')); }
      return original(...args);
    }) as typeof chrome.storage.local.set;
  });
  const language = ui.getByRole('combobox', { name: 'Language', exact: true });
  await language.click();
  await ui.getByRole('option', { name: '简体中文', exact: true }).click();
  await expect(ui.getByRole('alert')).toContainText('Could not save settings. Please try again.');
  await expect(language).toContainText('Follow System');
  const settingsSearch = ui.getByRole('textbox', { name: 'Search settings', exact: true });
  await settingsSearch.fill('language');
  await expect(ui.locator('.operation-feedback')).toContainText('Could not save settings. Please try again.');
  await settingsSearch.fill('');
  await language.click();
  await ui.getByRole('option', { name: '简体中文', exact: true }).click();
  await expect(ui.getByRole('region', { name: '设置', exact: true })).toBeVisible();
  await expect(ui.getByRole('alert')).toHaveCount(0);
  await expect(ui.locator('.operation-feedback')).toHaveText('语言已切换为简体中文');
  await ui.evaluate(() => {
    const original = chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set = ((...args: Parameters<typeof chrome.storage.local.set>) => new Promise<void>((resolve, reject) => {
      (window as any).__completePreferenceSave = async () => {
        chrome.storage.local.set = original;
        try { await original(...args); resolve(); } catch (reason) { reject(reason); }
      };
    })) as typeof chrome.storage.local.set;
  });
  await ui.getByRole('combobox', { name: '主题', exact: true }).click();
  await ui.getByRole('option', { name: '深色', exact: true }).click();
  await expect(ui.locator('.operation-feedback')).toHaveText('正在执行…');
  await expect(ui.locator('.justonehop-app')).toHaveAttribute('data-theme', 'system');
  await ui.evaluate(() => (window as any).__completePreferenceSave());
  await expect(ui.locator('.operation-feedback')).toHaveText('主题已切换为深色');
  await expect(ui.getByRole('combobox', { name: '主题', exact: true })).toBeFocused();
});
});

test('unified results mix tabs bookmarks and commands; searched tabs switch with Enter', async () => {
  const seed = await ui.evaluate(async base => {
    const self = (await chrome.tabs.getCurrent())!;
    const older = await chrome.tabs.create({ url: `${base}/New-Tab-Guide`, active: false });
    const newer = await chrome.tabs.create({ url: `${base}/New-Tab-Notes`, active: false });
    await chrome.bookmarks.create({ title: 'New Tab Handbook', url: `${base}/Handbook` });
    return { self: self.id!, older: older.id!, newer: newer.id! };
  }, origin);
  await expect.poll(() => worker.evaluate(id => chrome.tabs.get(id).then(tab => tab.status), seed.newer)).toBe('complete');
  await worker.evaluate(async ids => {
    await chrome.tabs.update(ids.older, { active: true });
    await chrome.tabs.update(ids.newer, { active: true });
    await chrome.tabs.update(ids.self, { active: true });
  }, seed);
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
  await expect(input).toHaveValue('');
  await expect(ui.locator('.result.tab')).toHaveCount(0);
  await expect(ui.locator('.result.command')).toHaveCount(9);
  await expect(ui.locator('.result.danger')).toHaveCount(0);
  await input.fill('new tab');
  await expect(ui.locator('.result.tab')).toHaveCount(2);
  await expect(ui.locator('.result.bookmark')).toHaveCount(1);
  await expect(ui.locator('.result.command')).toContainText('新建标签页');
  await expect(ui.locator('.result').first()).toHaveAttribute('id', 'justonehop-command:newTab');
  await expect(ui.locator('.result').first()).toHaveAttribute('aria-selected', 'true');
  await expect(ui.locator('.kind-label').filter({ hasText: '书签' })).toBeVisible();
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('unified-search.png') });
  await input.fill('New Tab Notes');
  await expect(ui.locator('.result')).toHaveCount(1);
  await input.press('Meta+k');
  await ui.getByRole('combobox', { name: '搜索操作' }).fill('close');
  await expect(ui.locator('.action-row')).toHaveCount(3);
  await ui.keyboard.press('Escape');
  await expect(input).toHaveValue('New Tab Notes');
  await expect(ui.locator(`[id="justonehop-tab:${seed.newer}"]`)).toHaveAttribute('aria-selected', 'true');
  const count = await worker.evaluate(() => chrome.tabs.query({}).then(tabs => tabs.length));
  await input.press('Enter');
  await expect.poll(() => worker.evaluate(id => chrome.tabs.get(id).then(tab => tab.active), seed.newer)).toBe(true);
  expect(await worker.evaluate(() => chrome.tabs.query({}).then(tabs => tabs.length))).toBe(count - 1); // The standalone test popup closes after execution.
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English exact command intent wins over identical page titles and Enter runs the command', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/New-Tab`);
  await ui.evaluate(async base => { await chrome.bookmarks.create({ title: 'New Tab', url: base }); }, origin);
  await ui.bringToFront();
  const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await input.fill('new tab');
  await expect(ui.locator('.result.tab')).toHaveCount(1);
  await expect(ui.locator('.result.bookmark')).toHaveCount(1);
  await expect(ui.locator('.result').first()).toHaveAttribute('id', 'justonehop-command:newTab');
  await expect(ui.locator('.result').first()).toHaveAttribute('aria-selected', 'true');
  const created = context.waitForEvent('page');
  await input.press('Enter');
  const newTab = await created;
  await expect(newTab).toHaveURL(/^chrome:\/\/(?:newtab|new-tab-page)\/$/);
  await expect.poll(() => worker.evaluate(() => chrome.tabs.query({ active: true }).then(tabs => tabs.some(tab => tab.url === 'chrome://newtab/')))).toBe(true);
});
});

test('search highlights Chinese titles, translated command aliases, URLs and action menu matches in both themes', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/New-Tab-Notes`);
  await ui.bringToFront();
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
  await input.fill('new tab');
  const command = ui.locator('.result.command').first();
  await expect(command.locator('.entry-title')).toHaveText('标签页: 新建标签页');
  await expect(command.locator('.entry-subtitle mark')).toHaveText(['new', 'tab']);
  await expect(ui.locator('.result.tab .entry-title mark')).toHaveText(['New', 'Tab']);
  await expect(ui.locator('.result').first()).toHaveAttribute('aria-selected', 'true');
  for (const theme of ['light', 'dark']) {
    await ui.evaluate(async theme => { await chrome.storage.local.set({ preferences: { language: 'zh', theme } }); }, theme);
    await expect(ui.locator('.justonehop-app')).toHaveAttribute('data-theme', theme);
    await ui.locator('.palette').screenshot({ path: test.info().outputPath(`highlight-${theme}.png`) });
  }
  await input.fill('127.0.0.1');
  await expect(ui.locator('.result.tab .entry-subtitle mark')).toHaveText('127.0.0.1');
  await input.fill('刷新');
  await expect(ui.locator('.result.command .entry-title mark')).toHaveText('刷新');
  await input.fill('New Tab Notes');
  await input.press('Meta+k');
  const action = ui.getByRole('combobox', { name: '搜索操作' });
  await action.fill('关闭');
  await expect(ui.locator('.action-row.danger mark')).toHaveText(['关闭', '关闭', '关闭']);
  await expect(ui.locator('[id="justonehop-actions-action:mute"] .action-alias')).toHaveText('关闭声音');
  await expect(ui.locator('[id="justonehop-actions-action:mute"] mark')).toHaveText('关闭');
  await action.fill('close right');
  await expect(ui.locator('.action-row').first().locator('.action-alias mark')).toHaveText(['close', 'right']);
  await ui.keyboard.press('Escape');
  await expect(input).toHaveValue('New Tab Notes');
  await input.fill('');
  await expect(ui.locator('.result mark')).toHaveCount(0);
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English title highlighting preserves text and fuzzy matches remain visible', async () => {
  const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await input.fill('new tab');
  await expect(ui.locator('.result.command .entry-title')).toHaveText('Tab: New Tab');
  await expect(ui.locator('.result.command .entry-title mark')).toHaveText(['Tab', 'New', 'Tab']);
  await expect(ui.locator('.result.command .entry-subtitle')).toHaveText('');
  await input.fill('reloda');
  await expect(ui.locator('.result.command').first()).toContainText('Reload Current Tab');
  await expect(ui.locator('.result.command').first().locator('mark').first()).toBeVisible();
});
});

for (const language of ['Chinese', 'English']) test.describe(() => {
  test.use({ environment: { ...defaults, locale: language === 'English' ? 'en-US' : 'zh-CN' } });
  test(`${language} short queries reject noise while command typos and exact aliases still work`, async () => {
  const chinese = language === 'Chinese';
  const page = await context.newPage();
  await page.goto(`${origin}/EchoTech-IAM`);
  const noise = await context.newPage();
  await noise.goto(`${origin}/Example-Domain`);
  await ui.evaluate(async base => {
    await chrome.bookmarks.create({ title: 'WebSequenceDiagrams', url: `${base}/Programming` });
    await chrome.bookmarks.create({ title: 'IAM Handbook', url: `${base}/Handbook` });
  }, origin);
  await ui.bringToFront();
  const input = ui.getByRole('combobox', { name: chinese ? '搜索命令、标签页、书签和历史' : 'Search commands, tabs, bookmarks, and history' });
  await input.fill('iam');
  await expect(ui.locator('.result')).toHaveCount(2);
  await expect(ui.locator('.result.tab .entry-title')).toHaveText('EchoTech IAM');
  await expect(ui.locator('.result.bookmark .entry-title')).toHaveText('IAM Handbook');
  await expect(ui.locator('.result.command')).toHaveCount(0);
  await expect(ui.locator('.result .entry-title mark')).toHaveText(['IAM', 'IAM']);
  await ui.locator('.palette').screenshot({ path: test.info().outputPath(`strict-search-${language.toLowerCase()}.png`) });
  await input.fill('iam nonexistent');
  await expect(ui.locator('.result')).toHaveCount(0);
  await input.fill('xinjiam');
  await expect(ui.locator('.result.command')).toHaveCount(0);
  await input.fill('xinjian');
  await expect(ui.locator('.result').first()).toHaveAttribute('id', 'justonehop-command:newTab');
  await input.fill('reloda');
  await expect(ui.locator('.result').first()).toHaveAttribute('id', 'justonehop-command:reload');
  if (chinese) {
    await expect(ui.locator('.result').first().locator('.entry-subtitle')).toHaveText('reload');
    await expect(ui.locator('.result').first().locator('.entry-subtitle mark').first()).toBeVisible();
  }
  await input.fill('cl');
  await expect(ui.locator('.result.danger')).toHaveCount(0);
  await input.pressSequentially('o');
  await expect(ui.locator('.result').first()).toHaveAttribute('id', 'justonehop-command:close');
  await expect(ui.locator('.result.danger')).toHaveCount(3);
  await expect(ui.locator('.result').first().locator('mark').first()).toHaveText(chinese ? 'clo' : 'Clo');
  for (const [query, action] of [['tab clo', 'close'], ['clo oth', 'closeOthers'], ['tab clo ri', 'closeRight'], ['guan', 'close'], ['关闭', 'close'], ['reload ext', 'reloadExtension']]) {
    await input.fill(query);
    await expect(ui.locator('.result').first()).toHaveAttribute('id', `justonehop-command:${action}`);
  }
  await input.fill('EchoTech IAM');
  await expect(ui.locator('.result[aria-selected="true"] .entry-title')).toHaveText('EchoTech IAM');
  await input.press('Meta+k');
  const action = ui.getByRole('combobox', { name: chinese ? '搜索操作' : 'Search actions' });
  await action.fill('iam');
  await expect(ui.locator('.action-row')).toHaveCount(1);
  await expect(ui.locator('.action-row').first()).toContainText(chinese ? '切换' : 'Switch');
  await expect(ui.locator('.action-row.danger')).toHaveCount(0);
  await action.fill('reloda');
  await expect(ui.locator('.action-row').first()).toContainText(chinese ? '刷新' : 'Reload');
  if (chinese) await expect(ui.locator('.action-row').first().locator('.action-alias mark').first()).toBeVisible();
  await action.fill('tab clo');
  await expect(ui.locator('.action-row').first()).toContainText(chinese ? '关闭标签页' : 'Close Tab');
  if (chinese) await expect(ui.locator('.action-row').first().locator('.action-alias mark')).toHaveText(['clo', 'tab']);
  await action.press('Escape');
  await expect(input).toHaveValue('EchoTech IAM');
  await expect(input).toBeFocused();
  await ui.locator('.result.tab').click({ button: 'right' });
  await expect(action).toBeFocused();
  await action.fill('clo');
  await action.press('Control+n');
  await expect(ui.locator('.action-row[aria-selected="true"]')).toContainText(chinese ? '关闭其他' : 'Close Other');
  await action.press('Control+p');
  if (chinese) await ui.locator('.action-row[aria-selected="true"]').click();
  else await action.press('Enter');
  await expect.poll(() => page.isClosed()).toBe(true);
  await expect(input).toHaveValue('EchoTech IAM');
  await expect(input).toBeFocused();
  await expect(ui.locator('.result')).toHaveCount(0);
  expect(noise.isClosed()).toBe(false);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English learned ranking follows successful selections, survives reopening tabs, and resets across palettes', async () => {
  const target = await context.newPage();
  await target.goto(`${origin}/EchoTech-IAM`);
  await ui.evaluate(async base => {
    const bookmark = await chrome.bookmarks.create({ title: 'Team IAM Handbook', url: `${base}/Handbook` });
    await chrome.storage.local.set({ searchUsage: [{ query: 'iam', target: `bookmark:${bookmark.id}`, weight: 0.5, lastUsed: Date.now() }] });
  }, origin);
  const reopen = async () => {
    ui = await context.newPage(); await ui.goto(popupUrl);
    const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await expect(input).toBeFocused();
    await input.fill('iam');
    return input;
  };
  const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await ui.bringToFront(); await input.fill('iam');
  await expect(ui.locator('.result').first()).toContainText('IAM Handbook');
  await input.press('ArrowDown');
  await expect(ui.locator('.result[aria-selected="true"]')).toContainText('EchoTech IAM');
  await input.press('Enter');
  await expect.poll(() => ui.isClosed()).toBe(true);
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage?.[0]?.query)).toBe('iam');
  const again = await reopen();
  await expect(ui.locator('.result').first()).toContainText('EchoTech IAM');
  await again.press('Enter');
  await expect.poll(() => ui.isClosed()).toBe(true);
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage?.[0]?.weight)).toBeGreaterThan(1.99);
  // A recreated tab receives a different browser ID. Preference follows its URL.
  await target.close();
  const restored = await context.newPage(); await restored.goto(`${origin}/EchoTech-IAM`);
  await reopen();
  await expect(ui.locator('.result').first()).toContainText('EchoTech IAM');
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('learned-ranking.png') });
  await ui.reload();
  await ui.getByRole('combobox').fill(' IAM ');
  await expect(ui.locator('.result').first()).toContainText('EchoTech IAM');
  const observer = await context.newPage(); await observer.goto(popupUrl);
  await observer.getByRole('combobox').fill('iam');
  await expect(observer.locator('.result').first()).toContainText('EchoTech IAM');
  await ui.getByRole('button', { name: 'Settings', exact: true }).click();
  await ui.getByRole('button', { name: 'Reset Ranking', exact: true }).click();
  await expect(ui.getByRole('status')).toContainText('Default ordering restored');
  await expect(observer.locator('.result').first()).toContainText('EchoTech IAM');
  expect(await worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage)).toBeUndefined();
  await ui.getByRole('button', { name: 'Reset Ranking', exact: true }).scrollIntoViewIfNeeded();
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('ranking-settings.png') });
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English canceled and failed selections do not train, while opening settings does', async () => {
  const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await input.fill('new tab');
  await input.press('ArrowDown'); // Highlighting alone is not a selection.
  // window.close() can destroy the target between Escape keydown and keyup.
  await ui.keyboard.press('Escape').catch(error => { if (!ui.isClosed()) throw error; });
  await expect.poll(() => ui.isClosed()).toBe(true);
  expect(await worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage)).toBeUndefined();
  ui = await context.newPage(); await ui.goto(popupUrl);
  const response = await ui.evaluate(async () => {
    const self = (await chrome.tabs.getCurrent())!;
    return chrome.runtime.sendMessage({ source: 'justonehop', type: 'execute', payload: { action: 'switch', windowId: self.windowId, tabId: 999999, query: 'iam' } });
  });
  expect(response.ok).toBe(false);
  expect(await worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage)).toBeUndefined();
  await ui.getByRole('combobox').fill('language');
  await ui.getByRole('combobox').press('Enter');
  await expect(ui.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage?.[0]?.target)).toBe('command:settings:language');
  expect(await worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage?.[0]?.query)).toBe('language');
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, pageAccess: true } });
  test('overlay learning survives reloading the page that owns the palette', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Usage-fixture`);
  await page.bringToFront();
  const tabId = await worker.evaluate(async base => (await chrome.tabs.query({})).find(tab => tab.url === `${base}/Usage-fixture`)!.id!, origin);
  await worker.evaluate(async id => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(id, { source: 'justonehop', type: 'toggle' });
  }, tabId);
  const cdp = await context.newCDPSession(page);
  const ax = async () => {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
    return (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes;
  };
  await expect.poll(async () => (await ax()).some(node => node.role?.value === 'combobox')).toBe(true);
  await page.keyboard.type('reload');
  await expect.poll(async () => (await ax()).find(node => node.role?.value === 'combobox')?.value?.value).toBe('reload');
  await Promise.all([page.waitForEvent('load'), page.keyboard.press('Enter')]);
  await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage?.[0]?.target)).toBe('command:reload');
  expect(await worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage?.[0]?.query)).toBe('reload');
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, commands: true } });
  test('English keep-open closed-shadow overlay keyboard closes two explicit targets and restores real typing', async () => {
    const page = await context.newPage(); await page.goto(`${origin}/Closed-keyboard-host`);
    const seeded = await worker.evaluate(async origin => {
      const host = (await chrome.tabs.query({})).find(tab => tab.url === `${origin}/Closed-keyboard-host`)!;
      const first = await chrome.tabs.create({ windowId: host.windowId, url: `${origin}/Closed-target-Alpha`, active: false });
      const second = await chrome.tabs.create({ windowId: host.windowId, url: `${origin}/Closed-target-Beta`, active: false });
      return { host: host.id!, first: first.id!, second: second.id! };
    }, origin);
    for (const id of [seeded.first, seeded.second]) {
      await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).status, id)).toBe('complete');
    }
    await page.bringToFront();
    await worker.evaluate(async () => {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    });
    await expect(page.locator('#justonehop-command-palette')).toBeAttached();
    expect(await page.locator('#justonehop-command-palette').evaluate(node => node.shadowRoot)).toBeNull();
    const cdp = await context.newCDPSession(page);
    const ax = async () => {
      const { frameTree } = await cdp.send('Page.getFrameTree');
      const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
      return (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes;
    };
    const combo = async (name: string) => (await ax()).find(node => node.role?.value === 'combobox' && node.name?.value === name);
    const rootName = 'Search commands, tabs, bookmarks, and history';
    await expect.poll(async () => (await combo(rootName))?.properties?.find(property => property.name === 'focused')?.value.value).toBe(true);
    await page.keyboard.type('Closed target Alpha');
    for (const [query, target] of [['Closed target Alpha', seeded.first], ['Closed target Beta', seeded.second]] as const) {
      await expect.poll(async () => (await combo(rootName))?.value?.value).toBe(query);
      await page.keyboard.press('Meta+k');
      await expect.poll(async () => (await combo('Search actions'))?.properties?.find(property => property.name === 'focused')?.value.value).toBe(true);
      await page.keyboard.type('close tab');
      await expect.poll(async () => (await combo('Search actions'))?.value?.value).toBe('close tab');
      await page.keyboard.press('Enter');
      await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(tab => tab.id === id), target)).toBe(false);
      await expect.poll(async () => (await ax()).some(node => node.role?.value === 'dialog' && node.name?.value === 'Actions')).toBe(false);
      await expect.poll(async () => (await combo(rootName))?.value?.value).toBe(query);
      await expect.poll(async () => (await combo(rootName))?.properties?.find(property => property.name === 'focused')?.value.value).toBe(true);
      await expect(page.locator('#justonehop-command-palette')).toBeAttached();
      expect(await worker.evaluate(id => chrome.tabs.get(id), seeded.host)).toMatchObject({ active: true, url: `${origin}/Closed-keyboard-host` });
      await page.keyboard.press('Meta+a');
      await page.keyboard.type(target === seeded.first ? 'Closed target Beta' : 'settings');
    }
    await expect.poll(async () => (await combo(rootName))?.value?.value).toBe('settings');
    expect(page.isClosed()).toBe(false);
    await cdp.detach();
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', shadow: 'open', pageAccess: true } });
  test('Ranking tab learning shows a saved preference after a zed overlay tab switch', async () => {
    const source = await context.newPage(); await source.goto(`${origin}/zed-source`);
    const targetPage = await context.newPage(); await targetPage.goto(`${origin}/zed`);
    const ids = await worker.evaluate(async ({ sourceUrl, targetUrl }) => {
      const tabs = await chrome.tabs.query({});
      return { source: tabs.find(tab => tab.url === sourceUrl)!.id!, target: tabs.find(tab => tab.url === targetUrl)!.id! };
    }, { sourceUrl: source.url(), targetUrl: targetPage.url() });
    // Load the destination's content script before learning, then reuse it after the switch.
    await worker.evaluate(async tabId => {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tabId, { source: 'justonehop', type: 'toggle' });
    }, ids.target);
    const reopened = targetPage.frameLocator('.justonehop-frame');
    await reopened.getByRole('combobox').fill('zed');
    await expect(reopened.locator('.result.tab')).toHaveCount(2);
    await expect(reopened.locator('button.ranking-forget')).toHaveCount(0);
    await reopened.getByRole('combobox').press('Escape');
    await expect(targetPage.locator('#justonehop-command-palette')).not.toBeAttached();
    await source.bringToFront();
    await worker.evaluate(async tabId => {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tabId, { source: 'justonehop', type: 'toggle' });
    }, ids.source);
    const sourceSurface = source.frameLocator('.justonehop-frame');
    await sourceSurface.getByRole('combobox').fill('zed');
    const targetId = `justonehop-tab:${ids.target}`;
    const target = sourceSurface.locator(`[id="${targetId}"]`);
    // Exact-title match is already first, so saving must show an icon without claiming promotion.
    await expect(sourceSurface.locator('.result.tab').first()).toHaveAttribute('id', targetId);
    await expect(target.locator('button.ranking-forget')).toHaveCount(0);
    await target.click();
    await expect(source.locator('#justonehop-command-palette')).not.toBeAttached();
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).active, ids.target)).toBe(true);
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage)).toEqual([
      expect.objectContaining({ query: 'zed', target: `tab:${targetPage.url()}`, weight: 1 }),
    ]);
    await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { source: 'justonehop', type: 'toggle' }), ids.target);
    await reopened.getByRole('combobox').fill('zed');
    await expect(reopened.locator('.result.tab').first()).toHaveAttribute('id', targetId);
    const icon = reopened.locator(`[id="${targetId}"] button.ranking-forget`);
    await expect(icon).toBeVisible();
    await expect(icon).toHaveAccessibleName('Forget Preference for This Query');
    await expect(icon).toHaveAttribute('data-promoted', 'false');
    await icon.hover();
    await expect(reopened.getByRole('tooltip')).toHaveText('Forget Preference for This QueryShift+BackspacePreference saved; position unchanged.');
  });
});

for (const language of ['Chinese', 'English']) test.describe(() => {
  test.use({ environment: { ...defaults, locale: language === 'English' ? 'en-US' : 'zh-CN', shadow: 'open', pageAccess: true } });
  test(`${language} ranking visibility and forget preserve query scope across palettes`, async () => {
    const chinese = language === 'Chinese';
    const fixture = await worker.evaluate(async base => {
      const a = await chrome.bookmarks.create({ title: 'Rankfixture Alpha', url: `${base}/rank-a` });
      const b = await chrome.bookmarks.create({ title: 'Rankfixture Beta', url: `${base}/rank-b` });
      return { a: a.id, b: b.id };
    }, origin);
    await ui.getByRole('combobox').fill('rankfixture');
    await expect(ui.locator('.result.bookmark')).toHaveCount(2);
    await expect(ui.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
    const baseline = await ui.locator('.result.bookmark').evaluateAll(nodes => nodes.map(node => node.id));
    expect(baseline).toHaveLength(2);
    const chosenId = baseline[1];
    const bookmarkId = chosenId.replace('justonehop-bookmark:', '');
    const target = `bookmark:${bookmarkId}`;
    const otherTarget = `bookmark:${bookmarkId === fixture.a ? fixture.b : fixture.a}`;
    const preserved = [
      { query: 'another query', target, weight: 2, lastUsed: Date.now() },
      { query: 'unrelated', target: otherTarget, weight: 3, lastUsed: Date.now() },
    ];
    await worker.evaluate(async records => chrome.storage.local.set({ searchUsage: records }), preserved);
    const opened = context.waitForEvent('page');
    await ui.locator(`[id="${chosenId}"]`).click();
    await opened;
    await expect.poll(() => ui.isClosed()).toBe(true);
    await expect.poll(() => worker.evaluate(async target => ((await chrome.storage.local.get('searchUsage')).searchUsage as UsageRecord[])
      .some(record => record.target === target && record.query === 'rankfixture'), target)).toBe(true);

    ui = await context.newPage(); await ui.goto(popupUrl);
    await ui.getByRole('combobox').fill('rankfixture');
    await expect(ui.locator('.result.bookmark').first()).toHaveAttribute('id', chosenId);
    await expect(ui.locator(`[id="${chosenId}"] button.ranking-forget`)).toHaveAttribute('data-promoted', 'true');
    await expect(ui.locator('.ranking-badge')).toHaveCount(0);
    const page = await context.newPage(); await page.goto(`${origin}/Ranking-source`);
    await page.setViewportSize({ width: 390, height: 620 });
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, page.url());
    await worker.evaluate(async tabId => {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tabId, { source: 'justonehop', type: 'toggle' });
    }, tabId);
    const surface = page.frameLocator('.justonehop-frame');
    const searchInput = surface.locator('.search-bar input');
    await searchInput.fill('rankfixture');
    await expect(surface.locator('.result.bookmark').first()).toHaveAttribute('id', chosenId);
    const chosen = surface.locator(`[id="${chosenId}"]`);
    const forget = chosen.locator('button.ranking-forget');
    const forgetLabel = chinese ? '忘记此搜索词的偏好' : 'Forget Preference for This Query';
    const promotedHint = chinese ? '按使用习惯前移。' : 'Moved up by your preferences.';
    const recordedHint = chinese ? '已记住偏好，位置未变。' : 'Preference saved; position unchanged.';
    await expect(forget).toHaveAccessibleName(forgetLabel);
    await expect(forget).toHaveAttribute('data-promoted', 'true');
    await expect(forget).toHaveAttribute('tabindex', '0');
    await expect(surface.getByRole('tooltip')).toHaveCount(0);
    await searchInput.press('ArrowDown');
    await expect(forget).toHaveAttribute('tabindex', '-1');
    await expect(surface.locator('button.ranking-forget[tabindex="0"]')).toHaveCount(0);
    await searchInput.press('ArrowUp');
    await expect(forget).toHaveAttribute('tabindex', '0');
    await searchInput.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 5));
    const beforeTabs = await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url })));
    const learned = await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage);
    // Neither shortcut guards nor a deeper Actions layer may forget or execute the row.
    for (const guard of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      await searchInput.dispatchEvent('keydown', { key: 'Backspace', code: 'Backspace', shiftKey: true, ...guard });
    }
    expect(await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual(learned);
    await expect(searchInput).toHaveValue('rankfixture');
    if (chinese) await chosen.click({ button: 'right' });
    else await searchInput.press('Meta+k');
    await expect(surface.getByRole('dialog')).toBeVisible();
    await expect(surface.locator('.action-description')).toHaveCount(0);
    await expect(surface.getByRole('dialog').getByRole('option', { name: forgetLabel, exact: false })).toHaveCount(0);
    await surface.getByRole('combobox', { name: chinese ? '搜索操作' : 'Search actions' }).press('Shift+Backspace');
    await page.keyboard.press('Escape');
    await expect(searchInput).toBeFocused();
    expect(await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual(learned);
    if (chinese) await forget.hover();
    else {
      for (let step = 0; step < 8 && !await forget.evaluate(node => node.matches(':focus')); step++) await page.keyboard.press('Tab');
      await expect(forget).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(searchInput).toBeFocused();
      await expect(surface.locator(`[id="${baseline[0]}"]`)).toHaveAttribute('aria-selected', 'true');
      await expect(forget).toHaveAttribute('tabindex', '-1');
      expect(await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual(learned);
      await searchInput.press('ArrowUp');
      await expect(chosen).toHaveAttribute('aria-selected', 'true');
      for (let step = 0; step < 8 && !await forget.evaluate(node => node.matches(':focus')); step++) await page.keyboard.press('Tab');
      await expect(forget).toBeFocused();
      for (const guard of [{ key: 'Enter', isComposing: true }, { key: ' ', keyCode: 229 }, { key: 'Enter', repeat: true }, { key: ' ', altKey: true }]) {
        await forget.dispatchEvent('keydown', guard);
      }
      expect(await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual(learned);
      await expect(forget).toBeFocused();
    }
    const tooltip = surface.getByRole('tooltip');
    await expect(tooltip).toHaveClass(/ranking-tooltip/);
    await expect(tooltip).toHaveText(`${forgetLabel}Shift+Backspace${promotedHint}`);
    await expect(forget).toHaveAttribute('aria-describedby', await tooltip.getAttribute('id') as string);
    const bounds = await tooltip.boundingBox();
    expect(bounds!.width).toBeLessThan(390);
    const frameBounds = await page.locator('.justonehop-frame').boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(frameBounds!.x);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(frameBounds!.x + frameBounds!.width);
    await surface.locator('.palette').screenshot({ path: test.info().outputPath(`ranking-${language}-tooltip.png`) });
    const currentOrder = await surface.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id));
    const currentScroll = await surface.locator('#justonehop-results').evaluate(node => node.scrollTop);
    await expect(chosen).toHaveAttribute('aria-selected', 'true');
    if (chinese) await forget.click();
    else await page.keyboard.press('Enter');
    await expect(surface.getByRole('dialog')).toHaveCount(0);
    await expect(searchInput).toBeFocused();
    await expect(searchInput).toHaveValue('rankfixture');
    expect(await searchInput.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 5]);
    await expect(surface.locator(`[id="${chosenId}"]`)).toHaveAttribute('aria-selected', 'true');
    expect(await surface.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(currentOrder);
    expect(await surface.locator('#justonehop-results').evaluate(node => node.scrollTop)).toBe(currentScroll);
    // Only the view performing forget holds its order; the other palette syncs normally.
    await expect.poll(() => ui.locator('.result.bookmark').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(baseline);
    await expect(surface.locator('button.ranking-forget')).toHaveCount(0);
    await expect(ui.locator('button.ranking-forget')).toHaveCount(0);
    await expect(surface.getByRole('tooltip')).toHaveCount(0);
    expect(await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url })))).toEqual(beforeTabs);
    await expect(page.locator('#justonehop-command-palette')).toBeAttached();
    expect(await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual(expect.arrayContaining(preserved));
    expect(await worker.evaluate(async () => ((await chrome.storage.local.get('searchUsage')).searchUsage as UsageRecord[]).length)).toBe(preserved.length);

    await surface.locator('.settings-button').click();
    await expect(surface.locator('.settings-page')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(searchInput).toBeFocused();
    await expect(searchInput).toHaveValue('rankfixture');
    expect(await searchInput.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 5]);
    expect(await surface.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(currentOrder);
    await expect(surface.locator(`[id="${chosenId}"]`)).toHaveAttribute('aria-selected', 'true');
    await expect(surface.locator(`[id="${chosenId}"]`)).toBeInViewport();

    await searchInput.fill('rankfixture no match');
    await expect(surface.locator('.result.bookmark')).toHaveCount(0);
    await searchInput.fill('rankfixture');
    await expect.poll(() => surface.locator('.result.bookmark').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(baseline);
    await expect(surface.locator('button.ranking-forget')).toHaveCount(0);
    // An already-first result has a record without claiming a boost.
    const firstTarget = baseline[0].replace('justonehop-', '');
    await worker.evaluate(async ({ records, target }) => chrome.storage.local.set({ searchUsage: [
      { query: 'rankfixture', target, weight: 1, lastUsed: Date.now() }, ...records,
    ] }), { records: preserved, target: firstTarget });
    const remembered = surface.locator(`[id="${baseline[0]}"] button.ranking-forget`);
    await expect(remembered).toHaveAttribute('data-promoted', 'false');
    await expect(remembered).toHaveAttribute('tabindex', '0');
    await expect(surface.locator('.ranking-badge')).toHaveCount(0);
    await remembered.hover();
    await expect(surface.getByRole('tooltip')).toHaveText(`${forgetLabel}Shift+Backspace${recordedHint}`);
    await searchInput.hover();
    await expect(surface.getByRole('tooltip')).toHaveCount(0);
    await expect(searchInput).toBeFocused();
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('Ranking forget preserves current order selection and scroll beyond the result limit until query changes', async () => {
    const records = await worker.evaluate(async base => {
      const bookmarks = [];
      for (let index = 0; index < 120; index++) bookmarks.push(await chrome.bookmarks.create({ title: `Longrank ${String(index).padStart(3, '0')}`, url: `${base}/longrank/${index}` }));
      return bookmarks.map(bookmark => bookmark.id);
    }, origin);
    await ui.getByRole('combobox').fill('longrank');
    await expect(ui.locator('.result.bookmark')).toHaveCount(99);
    const baseline = await ui.locator('.result.bookmark').evaluateAll(nodes => nodes.map(node => node.id));
    const inside = baseline[30].replace('justonehop-bookmark:', '');
    const outside = records.find(id => !baseline.includes(`justonehop-bookmark:${id}`))!;
    const beforeTabs = await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url })));
    const input = ui.getByRole('combobox');
    for (const id of [inside, outside]) {
      await worker.evaluate(async id => chrome.storage.local.set({ searchUsage: [{ query: 'longrank', target: `bookmark:${id}`, weight: 5, lastUsed: Date.now() }] }), id);
      const row = ui.locator(`[id="justonehop-bookmark:${id}"]`);
      await expect(ui.locator('.result.bookmark').first()).toHaveAttribute('id', `justonehop-bookmark:${id}`);
      await expect(row.locator('button.ranking-forget')).toHaveAttribute('data-promoted', 'true');
      await input.press('Meta+ArrowUp');
      await expect(row).toHaveAttribute('aria-selected', 'true');
      await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 5));
      const list = ui.locator('#justonehop-results');
      if (id === outside) {
        // Keep the selected promoted row offscreen to catch focus restoration scrolling it back.
        await list.evaluate(node => { node.scrollTop = 240; });
        await expect.poll(() => list.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
      }
      const currentOrder = await list.locator('.result').evaluateAll(nodes => nodes.map(node => node.id));
      const currentScroll = await list.evaluate(node => node.scrollTop);
      if (id === inside) await row.locator('button.ranking-forget').click();
      else await input.press('Shift+Backspace');
      await expect(ui.getByRole('dialog')).toHaveCount(0);
      await expect(input).toBeFocused();
      await expect(input).toHaveValue('longrank');
      expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 5]);
      await expect(ui.locator('button.ranking-forget')).toHaveCount(0);
      await expect(ui.locator('.result.bookmark')).toHaveCount(99);
      expect(await list.locator('.result').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(currentOrder);
      await expect(row).toHaveAttribute('aria-selected', 'true');
      expect(await list.evaluate(node => node.scrollTop)).toBe(currentScroll);
      await expect(ui.locator('.palette-footer .primary-action')).toBeEnabled();
      await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual([]);
      expect(await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url })))).toEqual(beforeTabs);
      await input.fill('longrank no match');
      await expect(ui.locator('.result.bookmark')).toHaveCount(0);
      await input.fill('longrank');
      await expect.poll(() => ui.locator('.result.bookmark').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(baseline);
      await expect(ui.locator('button.ranking-forget')).toHaveCount(0);
      if (id === outside) await expect(row).toHaveCount(0);
    }
  });
  test('Ranking home forget handles storage failure and settings identities stay separate', async () => {
    await ui.getByRole('combobox').fill('language');
    await expect(ui.locator('[id="justonehop-command:settings:language"]')).toHaveAttribute('aria-selected', 'true');
    await ui.getByRole('combobox').press('Enter');
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage?.[0]?.target)).toBe('command:settings:language');
    await ui.keyboard.press('Escape');
    await ui.getByRole('combobox').fill('theme');
    await expect(ui.locator('[id="justonehop-command:settings:theme"]')).toHaveAttribute('aria-selected', 'true');
    await ui.getByRole('combobox').press('Enter');
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage?.[0]?.target)).toBe('command:settings:theme');
    await ui.keyboard.press('Escape');
    await ui.getByRole('combobox').fill('');
    await expect(ui.locator('.result.command').first()).toHaveAttribute('id', 'justonehop-command:settings');
    const defaultOrder = await ui.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id));
    await worker.evaluate(async () => {
      const records = (await chrome.storage.local.get<{ searchUsage: UsageRecord[] }>('searchUsage')).searchUsage;
      await chrome.storage.local.set({ searchUsage: [...records,
        { query: '', target: 'command:pin', weight: 1, lastUsed: Date.now() },
        { query: 'pin', target: 'command:pin', weight: 1, lastUsed: Date.now() },
      ] });
      const original = chrome.storage.local.set.bind(chrome.storage.local);
      chrome.storage.local.set = async value => {
        if ('searchUsage' in value) { chrome.storage.local.set = original; throw new Error('test write failure'); }
        return original(value);
      };
    });
    // Home scores are captured when this palette mounts, including externally seeded weights.
    await ui.reload();
    await expect(ui.locator('.result.command').first()).toHaveAttribute('id', 'justonehop-command:pin');
    const pin = ui.locator('[id="justonehop-command:pin"]');
    const forget = pin.locator('button.ranking-forget');
    await expect(forget).toHaveAccessibleName('Forget This Command’s Preferences');
    await expect(forget).toHaveAttribute('data-promoted', 'true');
    await expect(ui.getByRole('tooltip')).toHaveCount(0);
    const beforeTabs = await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url, pinned: tab.pinned })));
    // Home is one mixed list: Cmd+arrows select its endpoints.
    await ui.getByRole('combobox').press('Meta+ArrowDown');
    await expect(ui.locator('#justonehop-results .result').last()).toHaveAttribute('aria-selected', 'true');
    await ui.getByRole('combobox').press('Meta+ArrowUp');
    await expect(pin).toHaveAttribute('aria-selected', 'true');
    await forget.hover();
    await expect(ui.getByRole('tooltip')).toHaveText('Forget This Command’s PreferencesShift+BackspaceMoved up by your preferences.');
    const currentOrder = await ui.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id));
    const currentScroll = await ui.locator('#justonehop-results').evaluate(node => node.scrollTop);
    const learned = await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage);
    await forget.click();
    await expect(ui.getByRole('alert')).toContainText('Could not forget');
    await expect(ui.getByRole('dialog')).toHaveCount(0);
    await expect(pin).toHaveAttribute('aria-selected', 'true');
    await expect(forget).toBeVisible();
    await expect(forget).toBeEnabled();
    await expect(forget).toHaveAttribute('tabindex', '0');
    await expect(ui.locator('#justonehop-results')).toBeVisible();
    expect(await ui.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(currentOrder);
    expect(await ui.locator('#justonehop-results').evaluate(node => node.scrollTop)).toBe(currentScroll);
    expect(await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toEqual(learned);
    // Retry through the same icon using keyboard activation after mouse failure.
    await ui.getByRole('combobox').focus();
    await ui.getByRole('combobox').hover();
    for (let step = 0; step < 8 && !await forget.evaluate(node => node.matches(':focus')); step++) await ui.keyboard.press('Tab');
    await expect(forget).toBeFocused();
    await ui.keyboard.press('Enter');
    await expect(forget).toHaveCount(0);
    await expect(ui.getByRole('alert')).toHaveCount(0);
    await expect(ui.getByRole('dialog')).toHaveCount(0);
    expect(await ui.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(currentOrder);
    await expect(pin).toHaveAttribute('aria-selected', 'true');
    expect(await ui.locator('#justonehop-results').evaluate(node => node.scrollTop)).toBe(currentScroll);
    await expect(ui.getByRole('combobox')).toBeFocused();
    await expect(ui.getByRole('combobox')).toHaveValue('');
    expect(await ui.getByRole('combobox').evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([0, 0]);
    const remaining = await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage as UsageRecord[]);
    expect(remaining.map(record => record.target).sort()).toEqual(['command:settings:language', 'command:settings:theme']);
    expect(await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({ id: tab.id, url: tab.url, pinned: tab.pinned })))).toEqual(beforeTabs);
    expect(ui.isClosed()).toBe(false);
    await ui.getByRole('combobox').fill('pin');
    await expect(pin).toBeVisible();
    await ui.getByRole('combobox').fill('');
    await expect.poll(() => ui.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(currentOrder);
    await expect(forget).toHaveCount(0);
    await ui.reload();
    await expect.poll(() => ui.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(defaultOrder);
    await pin.click({ button: 'right' });
    await expect(ui.getByRole('dialog')).toBeVisible();
    await expect(ui.locator('.action-description')).toHaveCount(0);
    await expect(ui.getByRole('option', { name: 'Forget This Command’s Preferences', exact: false })).toHaveCount(0);
    await ui.keyboard.press('Escape');
    const newTab = ui.locator('[id="justonehop-command:newTab"]');
    // The toolbar popup normally has a fixed 750px body; resize this layout fixture explicitly.
    await ui.evaluate(() => { document.body.style.width = '100%'; });
    for (const width of [750, 390]) {
      await ui.setViewportSize({ width, height: 600 });
      await ui.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const before = await newTab.locator('.key-chord > kbd').boundingBox();
      await worker.evaluate(async () => chrome.storage.local.set({ searchUsage: [
        { query: '', target: 'command:newTab', weight: 1, lastUsed: Date.now() },
      ] }));
      const icon = newTab.locator('button.ranking-forget');
      await expect(icon).toBeVisible();
      const iconBox = await icon.boundingBox();
      const keyBox = await newTab.locator('.key-chord > kbd').boundingBox();
      expect(iconBox!.x + iconBox!.width).toBeLessThanOrEqual(keyBox!.x);
      expect(keyBox!.x + keyBox!.width).toBeCloseTo(before!.x + before!.width, 0);
      await icon.click();
      await expect(icon).toHaveCount(0);
      await expect(ui.getByRole('combobox')).toBeFocused();
    }
  });
});

for (const language of ['Chinese', 'English']) test.describe(() => {
  test.use({ environment: { ...defaults, locale: language === 'English' ? 'en-US' : 'zh-CN', pageAccess: true, shadow: 'open' } });
  test(`${language} home recommendations mix learned pages and commands with frozen order until reopen`, async () => {
    const chinese = language === 'Chinese';
    const page = await context.newPage(); await page.goto(`${origin}/Home-source`);
    const seed = await worker.evaluate(async base => {
      const source = (await chrome.tabs.query({})).find(tab => tab.url === `${base}/Home-source`)!;
      const learned = await chrome.tabs.create({ url: `${base}/Home-learned`, active: false });
      const duplicate = await chrome.tabs.create({ url: learned.url || `${base}/Home-learned`, active: false });
      const cold = await chrome.tabs.create({ url: `${base}/Home-cold`, active: false });
      const sameSource = await chrome.tabs.create({ url: source.url, active: false });
      const bookmark = await chrome.bookmarks.create({ title: 'Home learned bookmark', url: `${base}/Home-learned` });
      const duplicateBookmark = await chrome.bookmarks.create({ title: 'Home duplicate bookmark', url: `${base}/Home-learned` });
      const saved = await chrome.bookmarks.create({ title: 'Home saved page', url: `${base}/Home-saved` });
      const another = await chrome.bookmarks.create({ title: 'Home another page', url: `${base}/Home-another` });
      const current = await chrome.bookmarks.create({ title: 'Home source bookmark', url: source.url });
      return { source: source.id!, learned: learned.id!, duplicate: duplicate.id!, cold: cold.id!, sameSource: sameSource.id!,
        bookmark: bookmark.id, duplicateBookmark: duplicateBookmark.id, saved: saved.id, another: another.id, current: current.id };
    }, origin);
    for (const id of [seed.learned, seed.duplicate, seed.cold, seed.sameSource]) {
      await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).status, id)).toBe('complete');
    }
    const surface = await openStorageOverlay(page);
    const input = surface.getByRole('combobox', { name: chinese ? '搜索命令、标签页、书签和历史' : 'Search commands, tabs, bookmarks, and history' });
    const ids = () => surface.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id));
    const defaults = ['settings', 'help', 'tabSwitcher', 'searchAllHistory', 'newTab', 'reload', 'pin', 'localStorage', 'cookies']
      .map(action => action === 'searchAllHistory' ? 'justonehop-search-all-history' : `justonehop-command:${action}`);
    await expect.poll(ids).toEqual(defaults);
    await expect(surface.locator('.suggested-label')).toHaveCount(0);
    await expect(surface.locator('#justonehop-results')).toHaveAccessibleName(chinese ? '推荐' : 'Suggested');
    await expect(surface.locator('.section-start')).toHaveCount(0);
    await worker.evaluate(async ({ seed, base }) => {
      const lastUsed = Date.now();
      await chrome.storage.local.set({ searchUsage: [
        { query: 'home learned', target: `tab:${base}/Home-learned`, weight: 4, lastUsed },
        { query: 'bookmark', target: `bookmark:${seed.bookmark}`, weight: 4, lastUsed },
        { query: 'other query', target: `bookmark:${seed.duplicateBookmark}`, weight: 4, lastUsed },
        { query: 'reload', target: 'command:reload', weight: 10, lastUsed },
        { query: 'saved', target: `bookmark:${seed.saved}`, weight: 5, lastUsed },
        { query: 'another', target: `bookmark:${seed.another}`, weight: 3, lastUsed },
        { query: 'source', target: `tab:${base}/Home-source`, weight: 100, lastUsed },
        { query: 'source', target: `bookmark:${seed.current}`, weight: 100, lastUsed },
        ...['mute', 'restore', 'sessionStorage'].map(action => ({ query: action, target: `command:${action}`, weight: 100, lastUsed })),
      ] });
    }, { seed, base: origin });
    for (const [action, queries] of [
      ['mute', ['mute', '静音']], ['restore', ['restore', '恢复关闭的标签页']],
      ['sessionStorage', ['session storage', '会话存储']], ['tabSwitcher', ['tab switcher', '标签切换器']],
    ] as const) for (const query of queries) {
      await input.fill(query);
      await expect(surface.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
      await expect(surface.locator(`[id="justonehop-command:${action}"]`)).toBeVisible();
    }
    // Successful search and home actions learn without reordering this mounted homepage.
    await input.fill('settings');
    await expect(surface.locator('[id="justonehop-command:settings"]')).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
    await expect(surface.getByRole('region', { name: chinese ? '设置' : 'Settings', exact: true })).toBeVisible();
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage: UsageRecord[] }>('searchUsage'))
      .searchUsage.find(record => record.query === 'settings' && record.target === 'command:settings')?.weight)).toBe(1);
    await page.keyboard.press('Escape'); await input.fill('');
    await expect.poll(ids).toEqual(defaults);
    await surface.locator('[id="justonehop-command:settings"]').click();
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage: UsageRecord[] }>('searchUsage'))
      .searchUsage.find(record => record.query === '' && record.target === 'command:settings')?.weight)).toBe(1);
    await page.keyboard.press('Escape');
    await input.fill('Home cold');
    await expect(surface.locator(`[id="justonehop-tab:${seed.cold}"]`)).toHaveAttribute('aria-selected', 'true');
    await input.press('Meta+k');
    const actions = surface.getByRole('combobox', { name: chinese ? '搜索操作' : 'Search actions' });
    await actions.fill('mute'); await actions.press('Enter');
    await expect(surface.getByRole('dialog')).toHaveCount(0);
    await expect(input).toHaveValue('Home cold'); await expect(input).toBeFocused();
    expect(await worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage: UsageRecord[] }>('searchUsage'))
      .searchUsage.some(record => record.query === 'home cold'))).toBe(false);
    await input.fill(''); await expect.poll(ids).toEqual(defaults);
    await page.keyboard.press('Escape');
    await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
    await worker.evaluate(id => chrome.tabs.sendMessage(id, { source: 'justonehop', type: 'toggle' }), seed.source);
    await expect(surface.locator('#justonehop-results .result')).toHaveCount(10);
    const learnedOrder = await ids();
    expect(learnedOrder.slice(0, 4)).toEqual([`justonehop-tab:${seed.learned}`, 'justonehop-command:reload', `justonehop-bookmark:${seed.saved}`, `justonehop-bookmark:${seed.another}`]);
    expect(learnedOrder).toContain('justonehop-command:settings');
    for (const id of [seed.source, seed.sameSource, seed.duplicate, seed.cold]) expect(learnedOrder).not.toContain(`justonehop-tab:${id}`);
    for (const id of [seed.current, seed.bookmark, seed.duplicateBookmark]) expect(learnedOrder).not.toContain(`justonehop-bookmark:${id}`);
    for (const action of ['mute', 'restore', 'sessionStorage']) expect(learnedOrder).not.toContain(`justonehop-command:${action}`);
    await surface.locator('.palette').screenshot({ path: test.info().outputPath(`home-suggested-${language.toLowerCase()}.png`) });
    const forget = surface.locator(`[id="justonehop-tab:${seed.learned}"] button.ranking-forget`);
    await expect(forget).toHaveAccessibleName(chinese ? '忘记此页面的偏好' : 'Forget This Page’s Preferences');
    await forget.click();
    await expect(forget).toHaveCount(0);
    await expect.poll(ids).toEqual(learnedOrder);
    const remaining = await worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage: UsageRecord[] }>('searchUsage')).searchUsage);
    for (const target of [`tab:${origin}/Home-learned`, `bookmark:${seed.bookmark}`, `bookmark:${seed.duplicateBookmark}`]) {
      expect(remaining.some(record => record.target === target)).toBe(false);
    }
    expect(await worker.evaluate(async id => (await chrome.tabs.get(id)).url, seed.learned)).toBe(`${origin}/Home-learned`);
    expect(await worker.evaluate(async id => (await chrome.bookmarks.get(id))[0].url, seed.bookmark)).toBe(`${origin}/Home-learned`);
    await input.fill('help');
    await expect(surface.locator('[id="justonehop-command:help"]')).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
    await expect(surface.locator('.help-view')).toBeVisible();
    await page.keyboard.press('Escape'); await input.fill('');
    await expect.poll(ids).toEqual(learnedOrder);
    // Reset Ranking is the explicit exception to the mounted home snapshot.
    await surface.getByRole('button', { name: chinese ? '设置' : 'Settings', exact: true }).click();
    await surface.getByRole('button', { name: chinese ? '重置搜索排序' : 'Reset Ranking', exact: true }).click();
    await expect(surface.getByRole('status')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect.poll(ids).toEqual(defaults);
    await expect(surface.locator('button.ranking-forget')).toHaveCount(0);
    // A real successful selection makes a previously cold page eligible on the next open.
    await input.fill('Home cold');
    await surface.locator(`[id="justonehop-tab:${seed.cold}"]`).click();
    await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage: UsageRecord[] }>('searchUsage'))
      .searchUsage.find(record => record.target.endsWith('/Home-cold'))?.query)).toBe('home cold');
    await page.bringToFront();
    await worker.evaluate(id => chrome.tabs.sendMessage(id, { source: 'justonehop', type: 'toggle' }), seed.source);
    await expect.poll(ids).toEqual([`justonehop-tab:${seed.cold}`, ...defaults].slice(0, 10));
  });
});

for (const language of ['Chinese', 'English']) test.describe(() => {
  test.use({ environment: { ...defaults, locale: language === 'English' ? 'en-US' : 'zh-CN' } });
  test(`${language} quiet layout exposes Ctrl P N navigation in results and actions at narrow widths`, async () => {
  const chinese = language === 'Chinese';
  const page = await context.newPage(); await page.goto(`${origin}/Navigation-fixture`);
  await ui.bringToFront();
  const input = ui.getByRole('combobox');
  await expect(ui.locator('.result.tab')).toHaveCount(0);
  await expect(ui.locator('.list-heading, .section-heading, .context-hint')).toHaveCount(0);
  await expect(ui.locator('#justonehop-results')).toHaveAccessibleName(chinese ? '推荐' : 'Suggested');
  await expect(ui.getByText(chinese ? '推荐' : 'Suggested', { exact: true })).toHaveCount(0);
  await expect(ui.locator('.section-start')).toHaveCount(0);
  await expect(ui.locator('.suggested-label')).toHaveCount(0);
  await expect(ui.locator('.palette-footer .footer-divider')).toHaveCount(0);
  await expect(ui.locator('.palette-footer-context')).toHaveCSS('margin-left', '16px');
  const hintChords = ui.locator('.navigation-hint .key-chord');
  await expect(hintChords.nth(0).locator('kbd')).toHaveText(['Ctrl+P']);
  await expect(hintChords.nth(1).locator('kbd')).toHaveText(['Ctrl+N']);
  await expect(ui.locator('.navigation-label')).toHaveText(chinese ? ['上一个', '下一个'] : ['Previous', 'Next']);
  await expect(ui.locator('.navigation-hint')).toHaveAttribute('title', /Control \+ P.*Ctrl\+P.*Control \+ N.*Ctrl\+N/);
  await expect(ui.locator('.actions-button')).toHaveAttribute('title', /Command \+ K/);
  // Supporting shortcuts use the same text metrics as other footer context.
  const hintKey = await hintChords.first().locator('kbd').first().evaluate(node => {
    const key = getComputedStyle(node), context = getComputedStyle(node.closest('.palette-footer-context')!);
    return { size: key.fontSize, weight: key.fontWeight, lineHeight: key.lineHeight, color: key.color,
      contextSize: context.fontSize, contextWeight: context.fontWeight, contextLineHeight: context.lineHeight, contextColor: context.color,
      border: key.borderTopWidth, background: key.backgroundColor, height: node.getBoundingClientRect().height };
  });
  expect(hintKey.size).toBe(hintKey.contextSize); expect(hintKey.weight).toBe(hintKey.contextWeight);
  expect(hintKey.lineHeight).toBe(hintKey.contextLineHeight); expect(hintKey.color).toBe(hintKey.contextColor);
  expect(hintKey.border).toBe('0px'); expect(hintKey.background).toBe('rgba(0, 0, 0, 0)'); expect(hintKey.height).toBe(16);
  await expect(ui.locator('.footer-actions .key-chord').first().locator('kbd')).toHaveText(['↵']);
  await expect(ui.locator('.footer-actions .key-chord').nth(1).locator('kbd')).toHaveText(['⌘K']);
  const rows = ui.locator('.result');
  await input.press('Meta+ArrowUp');
  await expect(rows.first()).toHaveAttribute('aria-selected', 'true');
  await input.press('Control+n');
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
  await input.press('Control+p');
  await expect(rows.first()).toHaveAttribute('aria-selected', 'true');
  await expect(input).toBeFocused();
  const header = await ui.locator('.search-bar').boundingBox();
  const first = await rows.first().boundingBox();
  expect(first!.y - header!.y - header!.height).toBeGreaterThanOrEqual(0);
  expect(first!.y - header!.y - header!.height).toBeLessThanOrEqual(9);
  await input.fill('Navigation fixture');
  await expect(ui.locator('.kind-label')).toHaveCount(1);
  await input.press('Meta+k');
  const action = ui.getByRole('combobox', { name: chinese ? '搜索操作' : 'Search actions' });
  await action.press('Control+n');
  await expect(ui.locator('.action-row').nth(1)).toHaveAttribute('aria-selected', 'true');
  await action.press('Control+p');
  await expect(ui.locator('.action-row').first()).toHaveAttribute('aria-selected', 'true');
  await expect(action).toBeFocused();
  await action.press('Escape');
  await expect(input).toHaveValue('Navigation fixture');
  await input.fill('example.com/footer-layout');
  const primary = ui.locator('.primary-action'), secondary = ui.locator('.secondary-action');
  await expect(primary.locator('.primary-label')).toHaveText(chinese ? '当前页打开' : 'Open Here');
  await expect(secondary.locator('.primary-label')).toHaveText(chinese ? '新标签页打开' : 'New Tab');
  await expect(primary).toHaveAccessibleName(chinese ? '当前页打开' : 'Open in Current Tab');
  await expect(secondary).toHaveAccessibleName(chinese ? '在新标签页打开' : 'Open in New Tab');
  await expect(secondary).toHaveAttribute('title', /在新标签页打开|Open in New Tab/);
  await ui.evaluate(() => { document.body.style.width = '100%'; });
  for (const width of [750, 620, 750]) {
    await ui.setViewportSize({ width, height: 600 });
    if (width === 620) await expect(ui.locator('.navigation-hint')).toBeHidden();
    else await expect(ui.locator('.navigation-hint')).toBeVisible();
    const left = (await ui.locator('.palette-footer-location').boundingBox())!;
    const right = (await ui.locator('.footer-actions').boundingBox())!;
    expect(right.x - left.x - left.width).toBeGreaterThanOrEqual(16);
    expect(await ui.locator('.footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect((await ui.locator('.footer').boundingBox())!.height).toBe(44);
    const newTab = (await secondary.boundingBox())!, separator = (await ui.locator('.footer-separator').boundingBox())!;
    expect(separator.x).toBeGreaterThanOrEqual(newTab.x + newTab.width);
    if (width === 620) await ui.locator('.palette').screenshot({ path: test.info().outputPath(`quiet-${language.toLowerCase()}-compact.png`) });
  }
  // Mouse opens the full action descriptions; keyboard closes and restores the query.
  await ui.locator('.actions-button').click();
  await expect(ui.locator('.action-row').first()).toContainText(chinese ? '当前页打开' : 'Open in Current Tab');
  await expect(ui.locator('.action-row').nth(1)).toContainText(chinese ? '在新标签页打开' : 'Open in New Tab');
  await ui.getByRole('combobox', { name: chinese ? '搜索操作' : 'Search actions' }).press('Escape');
  await expect(input).toHaveValue('example.com/footer-layout');
  for (const theme of ['light', 'dark'] as const) {
    await ui.emulateMedia({ colorScheme: theme });
    await ui.locator('.palette').screenshot({ path: test.info().outputPath(`quiet-${language.toLowerCase()}-${theme}.png`) });
  }
  await ui.setViewportSize({ width: 390, height: 600 });
  await ui.locator('.justonehop-app').evaluate(node => { node.classList.replace('popup', 'overlay'); document.body.style.width = '390px'; });
  await expect(ui.locator('.navigation-hint')).toBeHidden();
  await expect(ui.locator('.palette-footer-title')).toHaveText(chinese ? '小范围瞬移' : 'JustOneHop');
  await expect(ui.locator('.footer-navigation')).toHaveAccessibleName(chinese ? '设置' : 'Settings');
  expect(await ui.locator('.footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  const locationBox = await ui.locator('.palette-footer-location').boundingBox(), actionsBox = await ui.locator('.footer-actions').boundingBox();
  expect(locationBox!.x + locationBox!.width).toBeLessThanOrEqual(actionsBox!.x);
  await expect(secondary.locator('.secondary-compact-icon')).toBeVisible();
  await expect(secondary.locator('.primary-label')).toBeHidden();
  await ui.locator('.palette').screenshot({ path: test.info().outputPath(`quiet-${language.toLowerCase()}-narrow.png`) });
  await input.fill('');
  await input.press('Control+n');
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
});
});

async function openStorageOverlay(page: Page) {
  await page.bringToFront();
  const id = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, page.url());
  await worker.evaluate(async tabId => {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, { source: 'justonehop', type: 'toggle' });
  }, id);
  const surface = page.frameLocator('.justonehop-frame');
  await expect(surface.locator('.result.command')).toHaveCount(9);
  return surface;
}

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test('Embedded Tab Switcher overlay confirms explicitly and restores parent query caret on every cancel route', async () => {
    const page = await context.newPage(); await page.goto(`${origin}/Embedded-source`);
    const seed = await worker.evaluate(async base => {
      const source = (await chrome.tabs.query({})).find(tab => tab.url === `${base}/Embedded-source`)!;
      const target = await chrome.tabs.create({ url: `${base}/Embedded-target`, active: false });
      const sibling = await chrome.tabs.create({ url: `${base}/Embedded-sibling`, active: false });
      return { source: source.id!, target: target.id!, sibling: sibling.id!, windowId: source.windowId };
    }, origin);
    for (const id of [seed.target, seed.sibling]) await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).status, id)).toBe('complete');
    const surface = await openStorageOverlay(page);
    const root = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    const child = surface.locator('.recent-switcher');
    const search = child.getByRole('combobox');
    const active = () => worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0]?.id, seed.windowId);
    await root.fill('tab switcher');
    await expect(surface.locator('[id="justonehop-command:tabSwitcher"]')).toHaveAttribute('aria-selected', 'true');
    const parentOrder = await surface.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id));
    for (const route of ['Escape', 'cancel', 'back', 'dismiss'] as const) {
      await root.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 8));
      if (route === 'cancel') await surface.locator('[id="justonehop-command:tabSwitcher"]').click();
      else await root.press('Enter');
      await expect(search).toBeEnabled(); await expect(search).toBeFocused();
      await expect(search).toHaveValue('');
      await expect(child.locator('.palette-footer-title')).toHaveText('Tab Switcher');
      await expect(child.locator(`#recent-${seed.source} .current-badge`)).toHaveText('Current');
      await search.fill('Embedded target');
      await expect(child.getByRole('option')).toHaveCount(1);
      for (const modifier of ['Control', 'Alt', 'Meta']) {
        await page.keyboard.down(modifier); await page.keyboard.up(modifier);
        await expect(search).toBeFocused(); expect(await active()).toBe(seed.source);
      }
      await search.press('Meta+Enter');
      await search.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', repeat: true, bubbles: true });
      await search.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true, bubbles: true });
      expect(await active()).toBe(seed.source);
      if (route === 'Escape') await search.press('Escape');
      else if (route === 'cancel') await child.locator('.secondary-action').click();
      else if (route === 'back') await child.getByRole('button', { name: 'Back · Tab Switcher', exact: true }).click();
      else {
        await child.locator('.search-dismiss').click();
        await expect(search).toHaveValue(''); await expect(search).toBeFocused();
        await child.locator('.search-dismiss').click();
      }
      await expect(child).toHaveCount(0);
      await expect(root).toHaveValue('tab switcher'); await expect(root).toBeFocused();
      expect(await root.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 8]);
      await expect(surface.locator('[id="justonehop-command:tabSwitcher"]')).toHaveAttribute('aria-selected', 'true');
      expect(await surface.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(parentOrder);
      expect(await active()).toBe(seed.source);
    }
    // Mouse row, plain Enter and footer confirmation all use the selected source-window tab.
    for (const confirm of ['mouse', 'keyboard', 'footer'] as const) {
      if (confirm === 'mouse') {
        await root.fill('');
        await surface.locator('[id="justonehop-command:tabSwitcher"]').click();
      } else {
        await page.bringToFront();
        await worker.evaluate(id => chrome.tabs.sendMessage(id, { source: 'justonehop', type: 'toggle' }), seed.source);
        await root.fill('切换标签页');
        await expect(surface.locator('[id="justonehop-command:tabSwitcher"]')).toHaveAttribute('aria-selected', 'true');
        await root.press('Enter');
      }
      await expect(search).toBeFocused();
      await search.fill('Embedded no matching tab');
      await expect(child.getByRole('option')).toHaveCount(0);
      await expect(child.locator('.primary-action')).toBeDisabled();
      await search.press('Enter'); expect(await active()).toBe(seed.source);
      await search.fill('Embedded target');
      await expect(child.getByRole('option')).toHaveCount(1);
      if (confirm === 'mouse') await child.getByRole('option').click();
      else if (confirm === 'keyboard') {
        await search.press('Control+n'); await search.press('Enter');
      } else {
        await page.setViewportSize({ width: 390, height: 600 });
        await expect(child.locator('.primary-action')).toBeInViewport();
        await expect(child.getByRole('button', { name: 'Back · Tab Switcher', exact: true })).toBeInViewport();
        expect(await child.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        await surface.locator('.palette').screenshot({ path: test.info().outputPath('embedded-switcher-narrow.png') });
        await child.locator('.primary-action').click();
      }
      await expect.poll(active).toBe(seed.target);
      await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
    }
  });
});

for (const language of ['English', 'Chinese']) test.describe(() => {
  test.use({ environment: { ...defaults, locale: language === 'English' ? 'en-US' : 'zh-CN', pageAccess: true, shadow: 'open' } });
  test(`${language} storage and Tab Group layers preserve main palette geometry`, async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Layout-host`);
  await page.evaluate(() => { localStorage.setItem('layout.key', 'preview value'); });
  const sourceId = await worker.evaluate(async origin => {
    const source = (await chrome.tabs.query({})).find(tab => tab.url === `${origin}/Layout-host`)!;
    const tab = await chrome.tabs.create({ url: `${origin}/Layout-member`, active: false });
    const id = await chrome.tabs.group({ tabIds: [source.id!, tab.id!] });
    await chrome.tabGroups.update(id, { title: 'Layout Group Unique', color: 'blue' });
    for (let at = 0; at < 7; at++) await chrome.tabs.create({ url: `${origin}/Layout-other-${at}`, active: false });
    return source.id!;
  }, origin);
  const surface = await openStorageOverlay(page);
  const root = surface.locator('.search-bar input');
  await expect(surface.locator('.result.tab')).toHaveCount(0);
  await root.fill('Layout');
  await expect(surface.locator('.result.tab')).toHaveCount(9);
  await expect(surface.locator(`[id="justonehop-tab:${sourceId}"] .current-badge`)).toHaveText(language === 'English' ? 'Current' : '当前');
  await expect(surface.locator('.result.tab .current-badge')).toHaveCount(1);
  async function geometry() {
    return surface.locator('.palette').evaluate(panel => {
      const box = (selector: string) => {
        const rect = panel.querySelector(selector)!.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      const rect = panel.getBoundingClientRect();
      const title = box('.result .entry-title');
      const footerTitle = box('.palette-footer-title');
      const footerType = getComputedStyle(panel.querySelector('.palette-footer-title')!);
      const contextType = getComputedStyle(panel.querySelector('.palette-footer-context')!);
      return {
        panel: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        footer: box('.palette-footer'), search: box('.search-bar, .storage-search'),
        input: box('.search-bar input, .storage-search input'), row: box('.result'),
        icon: box('.result .entry-icon'), title: { x: title.x, y: title.y, height: title.height },
        navigation: box('.footer-navigation'), footerTitle: { x: footerTitle.x, y: footerTitle.y, height: footerTitle.height },
        footerType: { size: footerType.fontSize, weight: footerType.fontWeight, color: footerType.color },
        contextType: { size: contextType.fontSize, weight: contextType.fontWeight, lineHeight: contextType.lineHeight, color: contextType.color },
      };
    });
  }
  for (const size of [{ width: 750, height: 760 }, { width: 390, height: 600 }, { width: 390, height: 440 }]) {
    await page.setViewportSize(size);
    await root.fill('local storage');
    await expect(surface.getByRole('option').first()).toBeVisible();
    const main = await geometry();
    await surface.locator('.palette-footer').screenshot({ path: test.info().outputPath(`footer-main-${language}-${size.width}x${size.height}.png`) });
    expect(main.footer.height).toBe(44);
    expect(main.search.height).toBe(56);
    expect(main.row.y - main.search.y - main.search.height).toBe(4);
    expect(main.row.height).toBe(40);
    await surface.locator('.palette').screenshot({ path: test.info().outputPath(`search-content-spacing-${language}-${size.width}x${size.height}.png`) });
    expect(main.panel.height).toBeLessThanOrEqual(516);
    await root.press('Enter');
    await expect(surface.locator('.storage-row')).toHaveCount(1);
    const storage = await geometry();
    await surface.locator('.palette-footer').screenshot({ path: test.info().outputPath(`footer-storage-${language}-${size.width}x${size.height}.png`) });
    for (const key of ['panel', 'footer', 'search', 'icon', 'title', 'navigation', 'footerTitle', 'footerType', 'contextType'] as const) expect(storage[key]).toEqual(main[key]);
    expect(storage.row.x).toBe(main.row.x); expect(storage.row.y).toBe(main.row.y); expect(storage.row.height).toBe(main.row.height);
    if (size.width > 520) expect(storage.row.width).toBeLessThan(main.row.width);
    else expect(storage.row.width).toBe(main.row.width);
    expect(storage.input.x).toBe(main.input.x);
    expect(storage.input.y).toBe(main.input.y);
    await expect(surface.locator('.palette-footer .primary-action')).toBeInViewport();
    expect(await surface.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await expect(surface.locator('.storage-search .search-dismiss')).toHaveText('esc');
    await surface.locator('.storage-search .search-dismiss').click();
    await expect(root).toBeFocused(); await expect(root).toHaveValue('local storage');
    await root.fill('Layout Group Unique');
    await expect(surface.getByRole('option').filter({ hasText: 'Layout Group Unique' }).first()).toBeVisible();
    const groupMain = await geometry();
    await surface.getByRole('option').filter({ hasText: 'Layout Group Unique' }).first().click();
    await expect(surface.locator('.group-view .result')).toHaveCount(2);
    await expect(surface.locator('.group-view .current-badge')).toHaveCount(1);
    await expect(surface.locator(`[id="group-tab:${sourceId}"] .current-badge`)).toHaveCount(1);
    const group = await geometry();
    for (const key of ['panel', 'footer', 'search', 'row', 'icon', 'title', 'navigation', 'footerTitle', 'footerType', 'contextType'] as const) expect(group[key]).toEqual(groupMain[key]);
    expect(group.input.x).toBe(groupMain.input.x);
    expect(group.input.y).toBe(groupMain.input.y);
    await expect(surface.locator('.palette-footer .primary-action')).toBeInViewport();
    await expect(surface.locator('.group-view .search-dismiss')).toHaveText('esc');
    await surface.locator('.group-view .search-dismiss').click(); await expect(root).toBeFocused();
  }
  await page.setViewportSize({ width: 750, height: 760 });
  await surface.locator('.settings-button').click();
  const settingsInput = surface.locator('.settings-search input');
  await expect(settingsInput).toBeFocused();
  expect((await surface.locator('.settings-search').boundingBox())!.height).toBe(56);
  await surface.locator('.palette').screenshot({ path: test.info().outputPath(`compact-search-settings-${language}.png`) });
});
});

for (const language of ['English', 'Chinese']) test.describe(() => {
  test.use({ environment: { ...defaults, locale: language === 'English' ? 'en-US' : 'zh-CN', pageAccess: true, shadow: 'open' } });
  test(`${language} storage list copies exact values, details, names and restores navigation`, async () => {
  const chinese = language === 'Chinese';
  const page = await context.newPage(); await page.goto(`${origin}/Storage-fixture`);
  const raw = '{"message":"你好\\nworld","enabled":true}';
  await page.evaluate(value => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('app.config', value);
    localStorage.setItem('empty', '');
    localStorage.setItem('markup', '<img src=x onerror=alert(1)>');
    sessionStorage.setItem('session-only', 'session-value');
  }, raw);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const surface = await openStorageOverlay(page);
  const rootInput = surface.locator('.search-bar input');
  await rootInput.fill('local storage'); await rootInput.press('Enter');
  const input = surface.locator('.storage-search input');
  await expect(surface.locator('.storage-row')).toHaveCount(3);
  await expect(surface.locator('.storage-preview .preview-code')).toHaveValue(JSON.stringify(JSON.parse(raw), null, 2));
  await expect(surface.locator('.storage-row').first()).not.toContainText(raw);
  await expect(input).toBeFocused();
  await input.press('Control+n');
  await expect(surface.locator('.storage-row[aria-selected="true"]')).toContainText('empty');
  await input.press('Enter');
  await expect(surface.locator('.operation-feedback')).toContainText(chinese ? '已复制值' : 'Value copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('');
  await input.press('Control+p');
  await input.fill('config');
  await expect(surface.locator('.operation-feedback')).toContainText(chinese ? '已复制值' : 'Value copied');
  await expect(surface.locator('.storage-row mark')).toHaveText('config');
  await input.press('Enter');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(raw);
  await expect(input).toBeFocused();
  await input.press('Meta+k');
  const actionInput = surface.locator('.action-search input');
  await actionInput.press('Control+n');
  await expect(surface.locator('.action-row[aria-selected="true"]')).toContainText(chinese ? '复制名称' : 'Copy Name');
  await actionInput.press('Enter');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('app.config');
  await expect(input).toHaveValue('config');
  await input.press('Meta+k'); await actionInput.fill('details'); await actionInput.press('Enter');
  await expect(surface.locator('.storage-value')).toHaveText(JSON.stringify(JSON.parse(raw), null, 2));
  await expect(surface.locator('.storage-detail')).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(raw);
  await surface.locator('.palette').screenshot({ path: test.info().outputPath(`storage-detail-${language}.png`) });
  await page.keyboard.press('Escape');
  await expect(input).toHaveValue('config'); await expect(input).toBeFocused();
  // The footer chevron is the mouse path out of the deepest layer: one click, same as Escape.
  await input.press('Meta+k'); await actionInput.fill('details'); await actionInput.press('Enter');
  await expect(surface.locator('.storage-detail')).toBeFocused();
  await surface.locator('.palette-footer .footer-back').click();
  await expect(input).toHaveValue('config'); await expect(input).toBeFocused();
  await input.fill('markup'); await input.press('Enter');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('<img src=x onerror=alert(1)>');
  await expect(surface.locator('.storage-row img')).toHaveCount(0);
  await input.fill('absent'); await expect(surface.locator('.empty')).toContainText(chinese ? '没有找到' : 'No results found');
  await input.fill('');
  await page.emulateMedia({ colorScheme: 'dark' });
  await surface.locator('.palette').screenshot({ path: test.info().outputPath(`storage-dark-${language}.png`) });
  await page.emulateMedia({ colorScheme: 'light' });
  await surface.locator('.palette').screenshot({ path: test.info().outputPath(`storage-light-${language}.png`) });
  await page.setViewportSize({ width: 390, height: 600 });

  expect(await surface.locator('.footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await surface.locator('.palette').screenshot({ path: test.info().outputPath(`storage-narrow-${language}.png`) });
  await input.press('Escape');
  await expect(rootInput).toHaveValue('local storage'); await expect(rootInput).toBeFocused();
  // Preserve the source page as Chrome's active tab for the next root command.
  await worker.evaluate(async url => { const [tab] = await chrome.tabs.query({ url }); await chrome.tabs.update(tab.id!, { active: true }); }, page.url());
  await rootInput.fill('session storage');
  await expect(surface.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
  await expect(surface.locator('[id="justonehop-command:sessionStorage"]')).toHaveAttribute('aria-selected', 'true');
  await rootInput.press('Enter');
  await expect(surface.locator('.storage-row')).toHaveCount(1);
  await expect(surface.locator('.storage-row')).toContainText('session-only');
  await input.press('Enter'); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('session-value');
  const saved = await worker.evaluate(() => chrome.storage.local.get(null));
  expect(JSON.stringify(saved)).not.toContain('app.config');
  expect(JSON.stringify(saved)).not.toContain('session-value');
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test('English storage cookies expose HttpOnly and same-name paths, refresh, empty and changed-page errors', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Storage/nested`);
  await context.addCookies([
    { name: 'token', value: 'root-token', url: origin, httpOnly: true },
    { name: 'token', value: 'path-token', domain: '127.0.0.1', path: '/Storage' },
    { name: 'outside', value: 'outside', domain: '127.0.0.1', path: '/Other' },
  ]);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const surface = await openStorageOverlay(page); await surface.locator('.search-bar input').fill('cookie'); await page.keyboard.press('Enter');
  await expect(surface.locator('.storage-row')).toHaveCount(2);
  await expect(surface.locator('.storage-cookie-scope')).toContainText(['/', '/Storage']);
  await expect(surface.locator('.storage-preview .preview-code')).toHaveValue('root-token');
  await expect(surface.locator('.storage-preview .preview-info')).toContainText('true / false');
  await page.setViewportSize({ width: 390, height: 440 });
  await expect(surface.locator('.storage-preview .preview-code')).toBeInViewport({ ratio: 1 });
  const info = surface.locator('.storage-preview .preview-info');
  await info.focus(); await info.press('End');
  expect(await info.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('storage-cookie-preview-narrow.png') });
  await surface.locator('.storage-search input').focus();
  await page.keyboard.press('Enter'); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('root-token');
  await page.keyboard.press('Meta+k'); await surface.locator('.action-search input').fill('details'); await page.keyboard.press('Enter');
  await expect(surface.locator('.cookie-metadata')).toContainText('true / false');
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('storage-cookie-detail.png') });
  await page.keyboard.press('Escape');
  await context.clearCookies();
  await page.keyboard.press('Meta+k'); await surface.locator('.action-search input').fill('refresh'); await page.keyboard.press('Enter');
  await expect(surface.locator('.empty')).toContainText('No entries');
  await page.evaluate(() => history.pushState({}, '', '/Changed'));
  await page.keyboard.press('Meta+k'); await surface.locator('.action-search input').fill('refresh'); await page.keyboard.press('Enter');
  await expect(surface.locator('.storage-error')).toContainText('The page changed');
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test('English storage restricted pages show a recoverable explanation', async () => {
  await ui.locator('.search-bar input').fill('local storage'); await ui.keyboard.press('Enter');
  await expect(ui.locator('.storage-error')).toContainText('HTTP or HTTPS');
  await ui.keyboard.press('Enter');
  await expect(ui.locator('.storage-error')).toContainText('HTTP or HTTPS');
  await ui.keyboard.press('Escape');
  await expect(ui.locator('.search-bar input')).toBeFocused();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test('English storage long values scroll, refresh preserves query, and session storage stays with the source tab', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Storage-long`);
  const raw = Array.from({ length: 2000 }, (_, i) => `line ${i}: 你好 ☀`).join('\n');
  await page.evaluate(value => { localStorage.setItem('long.value', value); sessionStorage.setItem('source', 'source-session'); }, raw);
  const other = await context.newPage(); await other.goto(`${origin}/Storage-other`);
  await other.evaluate(() => sessionStorage.setItem('other', 'other-session'));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const surface = await openStorageOverlay(page);
  const rootInput = surface.locator('.search-bar input');
  await rootInput.fill('local storage'); await rootInput.press('Enter');
  const input = surface.locator('.storage-search input');
  await expect(surface.locator('.storage-row')).toContainText('long.value');
  await input.fill('long'); await input.press('Enter');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(raw);
  await input.press('Meta+k'); await surface.locator('.action-search input').fill('details'); await page.keyboard.press('Enter');
  await expect(surface.locator('.storage-detail')).toBeFocused();
  await page.keyboard.press('Control+n');
  expect(await surface.locator('.storage-detail').evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Meta+ArrowDown');
  expect(await surface.locator('.storage-detail').evaluate(node => node.scrollTop + node.clientHeight >= node.scrollHeight - 1)).toBe(true);
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.setItem('long.value', 'updated-value'));
  await input.press('Meta+k'); await surface.locator('.action-search input').fill('refresh'); await page.keyboard.press('Enter');
  await expect(input).toHaveValue('long');
  await expect(surface.locator('.storage-preview .preview-code')).toHaveValue('updated-value');
  await expect(input).toBeFocused();
  await input.press('Enter'); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('updated-value');
  await input.press('Escape'); await rootInput.fill('session storage'); await rootInput.press('Enter');
  await expect(surface.locator('.storage-row')).toHaveCount(1);
  await expect(surface.locator('.storage-preview .preview-code')).toHaveValue('source-session');
  await input.press('Enter'); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('source-session');
  await input.press('Escape'); await rootInput.press('Escape');
  await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
});
});

for (const vimium of [false, true]) test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, vimium } });
  test(`English closed storage overlay preserves ${vimium ? 'Vimium' : 'production'} keyboard isolation through every layer`, async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Closed-storage`);
  await page.evaluate(() => { localStorage.setItem('config', '{"native":true}'); localStorage.setItem('empty', ''); });
  await context.grantPermissions(['clipboard-read']);
  await page.bringToFront();
  const id = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, page.url());
  await worker.evaluate(async tabId => {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, { source: 'justonehop', type: 'toggle' });
  }, id);
  const cdp = await context.newCDPSession(page);
  const ax = async () => {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
    return (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes;
  };
  const combo = async () => (await ax()).find(node => node.role?.value === 'combobox');
  await expect.poll(async () => (await combo())?.name?.value).toBe('Search commands, tabs, bookmarks, and history');
  await page.keyboard.type('local storage');
  await expect.poll(async () => (await combo())?.value?.value).toBe('local storage');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await combo())?.name?.value).toBe('Search storage keys');
  await expect.poll(async () => (await ax()).filter(node => node.role?.value === 'option').length).toBe(2);
  const selectedName = async () => (await ax()).find(node => node.role?.value === 'option' && node.properties?.some(property => property.name === 'selected' && property.value?.value === true))?.name?.value;
  await page.keyboard.press('Control+n');
  await expect.poll(selectedName).toContain('empty');
  await page.keyboard.press('Control+p');
  await expect.poll(selectedName).toContain('config');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('{"native":true}');
  await page.keyboard.press('Meta+k');
  await expect.poll(async () => (await combo())?.name?.value).toBe('Search actions');
  await page.keyboard.type('details'); await page.keyboard.press('Enter');
  await expect.poll(async () => (await ax()).some(node => node.name?.value === 'JSON preview · copies original value')).toBe(true);
  await page.keyboard.press('Meta+k'); await page.keyboard.press('Escape');
  await expect.poll(async () => (await ax()).some(node => node.name?.value === 'JSON preview · copies original value')).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await combo())?.name?.value).toBe('Search storage keys');
  await page.setViewportSize({ width: 390, height: 600 });
  await page.screenshot({ path: test.info().outputPath('storage-closed-vimium.png') });
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await combo())?.name?.value).toBe('Search commands, tabs, bookmarks, and history');
  await expect.poll(async () => (await combo())?.value?.value).toBe('local storage');
  await page.keyboard.press('Escape');
  await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English cookie authorization handles missing grants, denial, navigation and exact website requests', async () => {
  const source = await context.newPage(); await source.goto(`${origin}/Cookie-permission`);
  const target = await worker.evaluate(async url => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
    return { tabId: tab.id!, windowId: tab.windowId, expectedUrl: url };
  }, source.url());
  const denied = await ui.evaluate(payload => chrome.runtime.sendMessage({ source: 'justonehop', type: 'read-page-storage', payload: { ...payload, kind: 'cookies', query: 'cookie' } }), target);
  expect(denied).toEqual({ ok: false, error: 'Allow access to this website to view its cookies.' });
  const opened = context.waitForEvent('page');
  await ui.evaluate(payload => chrome.runtime.sendMessage({ source: 'justonehop', type: 'open-cookie-access', payload }), target);
  const permission = await opened;
  await expect(permission.getByRole('button', { name: 'Continue to Chrome' })).toBeEnabled();
  await expect(permission.locator('.permission-site')).toHaveText('127.0.0.1');
  // Model Chrome's decision in headless; the real native prompt is tested manually.
  await permission.evaluate(() => {
    (window as unknown as { requested: unknown[] }).requested = [];
    chrome.permissions.request = async args => { (window as unknown as { requested: unknown[] }).requested.push(args); return false; };
  });
  await permission.getByRole('button', { name: 'Continue to Chrome' }).click();
  await expect(permission.getByRole('alert')).toContainText('Access was not granted');
  expect(await permission.evaluate(() => (window as unknown as { requested: unknown[] }).requested)).toEqual([{ origins: ['*://127.0.0.1/*'] }]);
  await source.goto('about:blank');
  await expect(permission.getByRole('alert')).toContainText('The page changed');
  await expect(permission.getByRole('button', { name: 'Continue to Chrome' })).toBeDisabled();
  await permission.close();
  await source.goto(target.expectedUrl);
  const reopened = context.waitForEvent('page');
  await ui.evaluate(payload => chrome.runtime.sendMessage({ source: 'justonehop', type: 'open-cookie-access', payload }), target);
  const accepted = await reopened;
  await expect(accepted.getByRole('button', { name: 'Continue to Chrome' })).toBeEnabled();
  await accepted.evaluate(() => { chrome.permissions.request = async args => args.origins?.length === 1 && args.origins[0] === '*://127.0.0.1/*'; });
  await accepted.getByRole('button', { name: 'Continue to Chrome' }).click();
  await expect.poll(() => accepted.isClosed()).toBe(true);
  expect(await worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage?.some(record => record.target === 'command:cookies') || false)).toBe(false);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', cookieDomains: true } });
  test('English storage cookie domains include parent, Secure, ordinary and current-partition cookies only', async () => {
  const site = 'https://app.example.test/nested';
  await context.route('https://app.example.test/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Cookie domains fixture</title>' }));
  const source = await context.newPage(); await source.goto(site);
  const target = await worker.evaluate(async url => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
    await chrome.cookies.set({ url, name: 'ordinary', value: 'ordinary-value', secure: false, path: '/' });
    await chrome.cookies.set({ url, name: 'secure', value: 'secure-value', secure: true, path: '/' });
    await chrome.cookies.set({ url, name: 'parent', value: 'parent-value', domain: '.example.test', httpOnly: true, path: '/' });
    await chrome.cookies.set({ url, name: 'partitioned', value: 'current-partition', secure: true, sameSite: 'no_restriction', path: '/', partitionKey: { topLevelSite: 'https://example.test', hasCrossSiteAncestor: false } });
    await chrome.cookies.set({ url, name: 'foreign-partition', value: 'excluded', secure: true, sameSite: 'no_restriction', path: '/', partitionKey: { topLevelSite: 'https://other.test', hasCrossSiteAncestor: true } });
    return { kind: 'cookies', tabId: tab.id!, windowId: tab.windowId, expectedUrl: url };
  }, site);
  const reply = await ui.evaluate(payload => chrome.runtime.sendMessage({ source: 'justonehop', type: 'read-page-storage', payload }), target);
  expect(reply.ok).toBe(true);
  expect(reply.data.entries.map((entry: { name: string }) => entry.name)).toEqual(['ordinary', 'parent', 'partitioned', 'secure']);
  expect(reply.data.entries.find((entry: { name: string }) => entry.name === 'parent').cookie.httpOnly).toBe(true);
  expect(reply.data.entries.find((entry: { name: string }) => entry.name === 'partitioned').cookie.partitionKey.topLevelSite).toBe('https://example.test');
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English cookie native permission request accepts the production manifest patterns', async () => {
  // Exercise Chrome itself: two separate scheme declarations do not authorize a
  // wildcard-scheme request, even though they appear to cover the same URLs.
  const result = await ui.evaluate(() => Promise.race([
    chrome.permissions.request({ origins: ['*://127.0.0.1/*'] }).then(granted => ({ granted }), error => ({ error: error.message })),
    new Promise<{ pending: true }>(resolve => setTimeout(() => resolve({ pending: true }), 750)),
  ]));
  expect(result).not.toHaveProperty('error');
});
});

// A separate Chrome window stays focused while source-window tabs change.
async function recentPopup(source: Page, direction = 1) {
  await source.bringToFront();
  const target = await worker.evaluate(async url => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
    await chrome.tabs.update(tab.id!, { active: true });
    return { id: tab.id!, windowId: tab.windowId };
  }, source.url());
  const created = context.waitForEvent('page');
  const own = await worker.evaluate(async ({ target, direction }) => chrome.windows.create({
    url: `switcher.html?tab=${target.id}&window=${target.windowId}&direction=${direction}`,
    type: 'popup', focused: true, width: 500, height: 500,
  }), { target, direction });
  const page = await created;
  await expect(page.getByRole('option').first()).toBeVisible();
  const browser = await context.newCDPSession(page);
  const read = async (expression: string) => (await browser.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  const key = (type: string, key: string, code: string, windowsVirtualKeyCode: number, modifiers = 0) => browser.send('Input.dispatchKeyEvent', { type: type as 'keyDown' | 'keyUp', key, code, windowsVirtualKeyCode, modifiers });
  const active = () => worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0]?.id, target.windowId);
  await expect.poll(active).toBe(target.id);
  return { target, own: own!, page, read, key, selected: () => read("document.querySelector('[aria-selected=true]')?.id"), closed: async () => page.isClosed(), active };
}

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English wheel back cancels the standalone switcher without switching tabs', async () => {
    const source = await context.newPage(); await source.goto(`${origin}/Wheel-switcher-source`);
    const other = await context.newPage(); await other.goto(`${origin}/Wheel-switcher-other`);
    const popup = await recentPopup(source);
    await popup.page.getByRole('button', { name: 'Search recent tabs…', exact: true }).click();
    await popup.page.locator('.palette-footer-title').hover(); await popup.page.mouse.wheel(-140, 0);
    await expect.poll(popup.closed).toBe(true);
    expect(await popup.active()).toBe(popup.target.id);
  });
  test('English recent switcher keeps the source active while selecting and switches only on release', async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Recent-A`);
  const b = await context.newPage(); await b.goto(`${origin}/Recent-B`);
  const c = await context.newPage(); await c.goto(`${origin}/Recent-C`);
  const popup = await recentPopup(a);
  const order: string[] = await popup.read("Array.from(document.querySelectorAll('[role=option]'),row=>row.id)");
  expect(order[0]).toBe(`recent-${popup.target.id}`);
  await popup.key('keyDown', 'Control', 'ControlLeft', 17, 2);
  for (let step = 2; step < order.length + 3; step++) {
    await popup.key('keyDown', 'n', 'KeyN', 78, 2);
    await expect.poll(popup.selected).toBe(order[step % order.length]);
    expect(await popup.active()).toBe(popup.target.id);
    await popup.key('keyUp', 'n', 'KeyN', 78, 2);
    expect(await popup.closed()).toBe(false);
    expect(await popup.read('document.hasFocus()')).toBe(true);
  }
  await popup.key('keyDown', 'p', 'KeyP', 80, 2);
  await expect.poll(popup.selected).toBe(order[1]);
  expect(await popup.active()).toBe(popup.target.id);
  expect(await popup.read("Array.from(document.querySelectorAll('[role=option]'),row=>row.id)")).toEqual(order);
  expect(await worker.evaluate(async () => (await chrome.windows.getLastFocused()).id)).toBe(popup.own.id);
  await popup.key('keyUp', 'Control', 'ControlLeft', 17);
  await expect.poll(popup.closed).toBe(true);
  expect(await popup.active()).toBe(Number(order[1].replace('recent-', '')));
  await expect.poll(() => worker.evaluate(async () => (await chrome.windows.getLastFocused()).id)).toBe(popup.target.windowId);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English recent switcher keeps search disabled and neutral during ordinary typing and navigation', async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Search-Source`);
  const b = await context.newPage(); await b.goto(`${origin}/Filter-One`);
  const popup = await recentPopup(a);
  const input = popup.page.getByRole('combobox');
  const list = popup.page.getByRole('listbox');
  const capsule = () => popup.page.locator('.search-bar').evaluate(node => {
    const style = getComputedStyle(node, '::before');
    return { border: style.borderColor, shadow: style.boxShadow };
  });
  await expect(input).toBeDisabled(); await expect(input).not.toBeFocused();
  await expect(list).toBeFocused(); await expect(list).toHaveAttribute('tabindex', '0');
  await expect(input).not.toHaveAttribute('aria-activedescendant');
  const selected = await popup.selected();
  const count = await popup.page.getByRole('option').count();
  await expect(list).toHaveAttribute('aria-activedescendant', selected);
  await expect.poll(capsule).toEqual({ border: 'rgba(0, 0, 0, 0)', shadow: 'none' });
  await expect(input).toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)');
  await input.evaluate(node => node.focus());
  await expect(input).not.toBeFocused(); await expect(list).toBeFocused();
  await popup.page.keyboard.type('Filter-One');
  await expect(input).toHaveValue(''); await expect(input).toBeDisabled();
  await expect(popup.page.getByRole('option')).toHaveCount(count);
  await popup.page.keyboard.press('ArrowDown');
  await expect(list).not.toHaveAttribute('aria-activedescendant', selected);
  await popup.page.keyboard.press('ArrowUp');
  await expect(list).toHaveAttribute('aria-activedescendant', selected);
  await expect(list).toBeFocused(); await expect(input).not.toBeFocused();
  await expect.poll(capsule).toEqual({ border: 'rgba(0, 0, 0, 0)', shadow: 'none' });
  await expect(input).toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)');
  await popup.key('keyDown', 'Escape', 'Escape', 27);
  await expect.poll(popup.closed).toBe(true); expect(await popup.active()).toBe(popup.target.id);
});
});

for (const confirm of ['Enter', 'row', 'footer'] as const) {
  test.describe(() => {
    test.use({ environment: { ...defaults, locale: 'en-US' } });
    test(`English recent switcher search filters visible targets and confirms with ${confirm}`, async () => {
    const a = await context.newPage(); await a.goto(`${origin}/Search-Source`);
    const b = await context.newPage(); await b.goto(`${origin}/Filter-One`);
    const c = await context.newPage(); await c.goto(`${origin}/Filter-Two`);
    const popup = await recentPopup(a);
    const input = popup.page.getByRole('combobox');
    await expect(popup.page.getByRole('listbox')).toBeFocused();
    await expect(input).toBeDisabled(); await expect(input).toHaveValue('');
    await expect(input).toHaveAttribute('placeholder', 'Search recent tabs…');
    expect(await popup.page.locator('.search-bar').evaluate(node => node.getBoundingClientRect().height)).toBe(56);
    const original = await popup.page.getByRole('option').evaluateAll(rows => rows.map(row => ({ id: row.id, text: row.textContent })));
    await popup.page.locator('button.search-icon').click();
    await expect(input).toBeEnabled(); await expect(input).toBeFocused();
    await input.pressSequentially('Filter');
    const expected = original.filter(row => row.text?.includes('Filter')).map(row => row.id);
    await expect(popup.page.getByRole('option')).toHaveCount(2);
    expect(await popup.page.getByRole('option').evaluateAll(rows => rows.map(row => row.id))).toEqual(expected);
    await expect(popup.page.locator('.entry-title mark')).toHaveText(['Filter', 'Filter']);
    await popup.page.keyboard.press('ArrowDown');
    const target = Number((await popup.selected()).replace('recent-', ''));
    await expect(input).toHaveAttribute('aria-activedescendant', `recent-${target}`);
    expect(await popup.active()).toBe(popup.target.id);
    if (confirm === 'Enter') await popup.key('keyDown', 'Enter', 'Enter', 13);
    else if (confirm === 'row') await popup.page.locator(`#recent-${target}`).click();
    else await popup.page.locator('.primary-action').click();
    await expect.poll(popup.closed).toBe(true);
    expect(await popup.active()).toBe(target);
  });
  });
}

for (const method of ['wrapper', 'icon', 'Control+f', 'Meta+f'] as const) test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test(`English recent switcher search accepts ordinary typing after ${method} and modifier release`, async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Search-Source`);
  const b = await context.newPage(); await b.goto(`${origin}/Filter-One`);
  const popup = await recentPopup(a);
  const input = popup.page.getByRole('combobox');
  const list = popup.page.getByRole('listbox');
  await expect(list).toBeFocused(); await expect(input).toBeDisabled();
  const modifier = method === 'Meta+f' ? 'Meta' : 'Control';
  await popup.page.keyboard.down(modifier);
  if (method === 'wrapper') await popup.page.locator('.recent-search-field').click();
  else if (method === 'icon') await popup.page.locator('button.search-icon.recent-search-activate').click();
  else await popup.page.keyboard.press('f');
  await expect(popup.page.locator('.palette-footer-title')).toHaveText('Tab Switcher');
  await popup.page.keyboard.up(modifier);
  await expect(input).toBeEnabled(); await expect(input).toBeFocused();
  await expect(list).not.toHaveAttribute('aria-activedescendant');
  await expect(input).toHaveAttribute('aria-activedescendant', await popup.selected());
  expect(await popup.closed()).toBe(false); expect(await popup.active()).toBe(popup.target.id);
  await list.click({ position: { x: 10, y: 240 } });
  await expect(list).toBeFocused();
  if (method === 'wrapper') await popup.page.locator('.recent-search-field').click();
  else if (method === 'icon') await popup.page.locator('button.search-icon.recent-search-activate').click();
  else await popup.page.keyboard.press(method);
  await expect(input).toBeFocused();
  await input.pressSequentially('Filter-One');
  await expect(popup.page.getByRole('option')).toHaveCount(1);
  const target = Number((await popup.selected()).replace('recent-', ''));
  await popup.key('keyDown', 'Enter', 'Enter', 13);
  await expect.poll(popup.closed).toBe(true); expect(await popup.active()).toBe(target);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English recent switcher search handles empty results, composition and removed filtered selection safely', async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Search-Source`);
  const b = await context.newPage(); await b.goto(`${origin}/Filter-One`);
  const c = await context.newPage(); await c.goto(`${origin}/Filter-Two`);
  const popup = await recentPopup(a);
  const input = popup.page.getByRole('combobox');
  const originalCount = await popup.page.getByRole('option').count();
  await popup.page.locator('button.search-icon').click();
  await expect(input).toBeEnabled(); await expect(input).toBeFocused();
  await input.fill('127.0.0.1');
  await expect(popup.page.getByRole('option')).toHaveCount(3);
  await expect(popup.page.locator('.entry-subtitle mark')).toHaveCount(3);
  await input.fill('no-such-tab');
  await expect(popup.page.getByRole('option')).toHaveCount(0);
  await expect(input).not.toHaveAttribute('aria-activedescendant');
  await expect(popup.page.locator('.primary-action')).toBeDisabled();
  await popup.key('keyDown', 'Enter', 'Enter', 13);
  await popup.key('keyUp', 'Control', 'ControlLeft', 17);
  expect(await popup.closed()).toBe(false); expect(await popup.active()).toBe(popup.target.id);
  await input.fill(''); await expect(popup.page.getByRole('option')).toHaveCount(originalCount);
  await input.fill('Filter');
  await input.dispatchEvent('compositionstart');
  await popup.key('keyDown', 'Enter', 'Enter', 13);
  await popup.key('keyUp', 'Control', 'ControlLeft', 17);
  expect(await popup.closed()).toBe(false);
  await input.dispatchEvent('keydown', { key: 'Escape', keyCode: 229 });
  expect(await popup.closed()).toBe(false);
  await input.dispatchEvent('compositionend');
  await popup.key('keyDown', 'Enter', 'Enter', 13, 8);
  expect(await popup.closed()).toBe(false);
  await popup.key('keyDown', 'Enter', 'Enter', 13, 2);
  expect(await popup.closed()).toBe(false);
  const browser = await context.newCDPSession(popup.page);
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, autoRepeat: true });
  expect(await popup.closed()).toBe(false);
  await popup.page.keyboard.press('Meta+ArrowDown');
  expect(await popup.selected()).toBe(await popup.page.getByRole('option').last().getAttribute('id'));
  await popup.page.keyboard.press('PageUp');
  expect(await popup.selected()).toBe(await popup.page.getByRole('option').first().getAttribute('id'));
  const selected = Number((await popup.selected()).replace('recent-', ''));
  await worker.evaluate(id => chrome.tabs.remove(id), selected);
  await expect(popup.page.getByRole('option')).toHaveCount(1);
  await expect(input).not.toHaveAttribute('aria-activedescendant');
  await expect(popup.page.locator('.primary-action')).toBeDisabled();
  await popup.key('keyUp', 'Control', 'ControlLeft', 17);
  expect(await popup.closed()).toBe(false); expect(await popup.active()).toBe(popup.target.id);
  await popup.page.keyboard.press('ArrowDown');
  const remaining = Number((await popup.selected()).replace('recent-', ''));
  await popup.page.locator('.primary-action').click();
  await expect.poll(popup.closed).toBe(true); expect(await popup.active()).toBe(remaining);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English recent switcher missed release keeps the original tab and Enter confirms the reverse selection', async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Recent-A`);
  const b = await context.newPage(); await b.goto(`${origin}/Recent-B`);
  const popup = await recentPopup(a, -1);
  const order: string[] = await popup.read("Array.from(document.querySelectorAll('[role=option]'),row=>row.id)");
  expect(await popup.selected()).toBe(order.at(-1));
  const active = await popup.active();
  expect(active).toBe(popup.target.id);
  await popup.key('keyDown', 'Enter', 'Enter', 13);
  await expect.poll(popup.closed).toBe(true);
  expect(await popup.active()).toBe(Number(order.at(-1)!.replace('recent-', '')));
});
});

test('Chinese recent switcher Escape and focus loss cancel without switching or stealing focus', async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Recent-A`);
  const b = await context.newPage(); await b.goto(`${origin}/Recent-B`);
  let popup = await recentPopup(a);
  expect(await popup.read('document.body.textContent')).toContain('松开 Ctrl 切换');
  await popup.key('keyDown', 'Escape', 'Escape', 27);
  await expect.poll(popup.closed).toBe(true);
  expect(await popup.active()).toBe(popup.target.id);
  popup = await recentPopup(a);
  const preview = await popup.active();
  const other = await worker.evaluate(() => chrome.windows.create({ url: 'about:blank', focused: true }));
  await expect.poll(popup.closed).toBe(true);
  expect(await popup.active()).toBe(preview);
  expect(await worker.evaluate(async () => (await chrome.windows.getLastFocused()).id)).toBe(other!.id);
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English recent switcher removes closed or moved candidates without activating another window', async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Recent-A`);
  const b = await context.newPage(); await b.goto(`${origin}/Recent-B`);
  const c = await context.newPage(); await c.goto(`${origin}/Recent-C`);
  const popup = await recentPopup(a);
  const selected = Number((await popup.selected()).replace('recent-', ''));
  await worker.evaluate(async id => { await chrome.windows.create({ tabId: id, focused: false }); }, selected);
  await expect(popup.page.locator(`#recent-${selected}`)).toHaveCount(0);
  const rows = await popup.page.getByRole('option').count();
  await popup.key('keyDown', 'n', 'KeyN', 78, 2);
  expect(await popup.active()).toBe(popup.target.id);
  const closing = Number((await popup.selected()).replace('recent-', ''));
  await worker.evaluate(id => chrome.tabs.remove(id), closing);
  await expect(popup.page.locator(`#recent-${closing}`)).toHaveCount(0);
  expect(await popup.page.getByRole('option').count()).toBe(rows - 1);
  await popup.key('keyDown', 'n', 'KeyN', 78, 2);
  expect(await popup.active()).toBe(popup.target.id);
  const finalId = Number((await popup.selected()).replace('recent-', ''));
  await popup.key('keyUp', 'Control', 'ControlLeft', 17);
  await expect.poll(popup.closed).toBe(true);
  expect(await popup.active()).toBe(finalId);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English recent switcher rapid navigation then release preserves the final selection', async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Recent-A`);
  const b = await context.newPage(); await b.goto(`${origin}/Recent-B`);
  const popup = await recentPopup(a);
  const order: string[] = await popup.read("Array.from(document.querySelectorAll('[role=option]'),row=>row.id)");
  for (let step = 0; step < 9; step++) await popup.key('keyDown', 'n', 'KeyN', 78, 2);
  await popup.key('keyUp', 'Control', 'ControlRight', 17);
  await expect.poll(popup.closed).toBe(true);
  expect(await popup.active()).toBe(Number(order[10 % order.length].replace('recent-', '')));
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English recent switcher closes when source window closes and never changes toolbar popup', async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Recent-A`);
  const b = await context.newPage(); await b.goto(`${origin}/Recent-B`);
  const popup = await recentPopup(a);
  expect(await worker.evaluate(id => chrome.action.getPopup({tabId:id}), popup.target.id)).toBe('');
  await worker.evaluate(id => chrome.windows.remove(id), popup.target.windowId);
  await expect.poll(popup.closed).toBe(true);
});
});

 test.describe(() => {
   test.use({ environment: { ...defaults, locale: 'en-US' } });
   test('English recent switcher cancels when its original tab is closed', async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Recent-A`);
  const b = await context.newPage(); await b.goto(`${origin}/Recent-B`);
  const popup = await recentPopup(a);
  await worker.evaluate(id => chrome.tabs.remove(id), popup.target.id);
  await expect.poll(popup.closed).toBe(true);
 });
 });

async function bridgeFixture() {
  const a = await context.newPage(); await a.goto(`${origin}/Bridge-A`);
  const b = await context.newPage(); await b.goto(`${origin}/Bridge-B`);
  await a.bringToFront();
  const ids = await worker.evaluate(async url => {
    const tabs = await chrome.tabs.query({});
    const source = tabs.find(tab => tab.url === url)!;
    return { source: source.id!, window: source.windowId, previous: tabs.find(tab => tab.url?.endsWith('/Bridge-B'))!.id! };
  }, a.url());
  const open = () => worker.evaluate(async () => { const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands; await Promise.all(callbacks.map(callback => callback('switch-recent'))); });
  const active = () => worker.evaluate(async id => (await chrome.tabs.query({ windowId: id, active: true }))[0]?.id, ids.window);
  const windows = () => worker.evaluate(async () => (await chrome.tabs.query({ url: chrome.runtime.getURL('switcher.html') + '*' })).length);
  return { a, b, ids, open, active, windows };
}

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English recent bridge accepts a quick tap released before the command handler starts', async () => {
  const f = await bridgeFixture();
  await f.a.keyboard.down('Control');
  await f.a.keyboard.up('Control');
  await f.open();
  await expect.poll(f.active).toBe(f.ids.previous);
  expect(await f.windows()).toBe(0);
  // The bridge does not grant Cookie host access as a side effect.
  expect(await worker.evaluate(() => chrome.permissions.contains({ origins: ['*://example.com/*'] }))).toBe(false);
  // A second tap switches back, with no stale session or stale release replay.
  await f.b.keyboard.down('Control'); await f.b.keyboard.up('Control');
  await f.open();
  await expect.poll(f.active).toBe(f.ids.source);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English recent bridge buffers release while the independent window is loading', async () => {
  const f = await bridgeFixture();
  let resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  await context.route('**/switcher.js', async route => { await gate; await route.continue(); });
  await f.a.keyboard.down('Control');
  const created = context.waitForEvent('page', page => page.url().includes('switcher.html'));
  await f.open();
  const popup = await created;
  expect(await f.active()).toBe(f.ids.source);
  await f.a.keyboard.up('Control');
  resume();
  await expect.poll(f.active).toBe(f.ids.previous);
  await expect.poll(() => popup.isClosed()).toBe(true);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English recent bridge hands held Control to the window for navigation and release', async () => {
  const f = await bridgeFixture();
  await f.a.keyboard.down('Control');
  const created = context.waitForEvent('page');
  await f.open();
  const popup = await created;
  await expect(popup.getByRole('option').first()).toBeVisible();
  expect(await f.active()).toBe(f.ids.source);
  await popup.keyboard.press('Control+n');
  // press releases Control, so use a separate held sequence in the next session.
  await expect.poll(() => popup.isClosed()).toBe(true);
  await f.a.bringToFront();
  await f.a.keyboard.down('Control');
  const nextPage = context.waitForEvent('page'); await f.open(); const next = await nextPage;
  await expect(next.getByRole('option').first()).toBeVisible();
  await next.keyboard.down('Control');
  await next.keyboard.press('n'); await next.keyboard.press('p');
  expect(await f.active()).toBe(f.ids.source);
  const selected = await next.locator('[aria-selected=true]').getAttribute('id');
  await next.keyboard.up('Control');
  await expect.poll(f.active).toBe(Number(selected!.replace('recent-', '')));
  await expect.poll(() => next.isClosed()).toBe(true);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English recent bridge Escape cancels the independent switcher during asynchronous startup', async () => {
  const f = await bridgeFixture();
  const script = await readFile(resolve('dist/switcher.js'), 'utf8');
  await context.route('**/switcher.js', async route => {
    await route.fulfill({ contentType: 'text/javascript', body: `const originalCommands = chrome.commands.getAll.bind(chrome.commands);\nchrome.commands.getAll = () => new Promise(resolve => { window.__resumeSwitcherCommands = () => originalCommands().then(resolve); });\n${script}` });
  });
  await f.a.keyboard.down('Control');
  const created = context.waitForEvent('page');
  await worker.evaluate(ids => chrome.windows.create({ url: `switcher.html?tab=${ids.source}&window=${ids.window}&direction=1`, type: 'popup', focused: true }), f.ids);
  const popup = await created;
  await popup.waitForFunction(() => typeof (window as any).__resumeSwitcherCommands === 'function');
  await popup.bringToFront();
  await popup.keyboard.press('Escape').catch(error => { if (!popup.isClosed()) throw error; });
  await expect.poll(() => popup.isClosed()).toBe(true);
  expect(await f.active()).toBe(f.ids.source);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English recent bridge replays paging, jumps and command steps in order after asynchronous startup', async () => {
  const f = await bridgeFixture();
  await worker.evaluate(async ({ windowId, base }) => {
    for (let at = 0; at < 20; at++) await chrome.tabs.create({ windowId, url: `${base}/Startup-${at}`, active: false });
  }, { windowId: f.ids.window, base: origin });
  const script = await readFile(resolve('dist/switcher.js'), 'utf8');
  await context.route('**/switcher.js', async route => {
    await route.fulfill({ contentType: 'text/javascript', body: `const originalCommands = chrome.commands.getAll.bind(chrome.commands);\nchrome.commands.getAll = () => new Promise(resolve => { window.__resumeSwitcherCommands = () => originalCommands().then(resolve); });\nconst originalAddCommand = chrome.commands.onCommand.addListener.bind(chrome.commands.onCommand);\nchrome.commands.onCommand.addListener = callback => { window.__stepSwitcher = callback; originalAddCommand(callback); };\n${script}` });
  });
  const created = context.waitForEvent('page');
  await worker.evaluate(ids => chrome.windows.create({ url: `switcher.html?tab=${ids.source}&window=${ids.window}&direction=1`, type: 'popup', focused: true }), f.ids);
  const popup = await created;
  await popup.waitForFunction(() => typeof (window as any).__resumeSwitcherCommands === 'function');
  await popup.bringToFront();
  await popup.setViewportSize({ width: 750, height: 316 });
  const cdp = await context.newCDPSession(popup);
  const key = (key: string, code: string, windowsVirtualKeyCode: number, modifiers = 0) => cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers });
  await key('PageUp', 'PageUp', 33);
  await key('ArrowDown', 'ArrowDown', 40, 2);
  await key('PageUp', 'PageUp', 33);
  await key('ArrowUp', 'ArrowUp', 38, 1);
  await key('Tab', 'Tab', 9, 8);
  await popup.evaluate(() => (window as any).__stepSwitcher('switch-recent'));
  await key('PageDown', 'PageDown', 34);
  await popup.evaluate(() => (window as any).__resumeSwitcherCommands());
  const rows = popup.getByRole('option');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(20);
  const pageSize = await popup.locator('.recent-list').evaluate(node => Math.max(1, Math.floor(node.clientHeight / 40)));
  expect(pageSize).toBeLessThan(10);
  const target = await rows.nth(await rows.count() - 1 - pageSize).getAttribute('id');
  await expect(popup.getByRole('listbox')).toHaveAttribute('aria-activedescendant', target!);
  expect(await f.active()).toBe(f.ids.source);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 });
  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect.poll(f.active).toBe(Number(target!.replace('recent-', '')));
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English recent bridge search during asynchronous startup supersedes buffered release', async () => {
  const f = await bridgeFixture();
  const script = await readFile(resolve('dist/switcher.js'), 'utf8');
  await context.route('**/switcher.js', async route => {
    await route.fulfill({ contentType: 'text/javascript', body: `const originalCommands = chrome.commands.getAll.bind(chrome.commands);\nchrome.commands.getAll = () => new Promise(resolve => { window.__resumeSwitcherCommands = () => originalCommands().then(resolve); });\n${script}` });
  });
  await f.a.keyboard.down('Control');
  const created = context.waitForEvent('page');
  await worker.evaluate(ids => chrome.windows.create({ url: `switcher.html?tab=${ids.source}&window=${ids.window}&direction=1`, type: 'popup', focused: true }), f.ids);
  const popup = await created;
  await popup.waitForFunction(() => typeof (window as any).__resumeSwitcherCommands === 'function');
  await popup.bringToFront();
  const cdp = await context.newCDPSession(popup);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 });
  await popup.keyboard.press('Control+f');
  await popup.evaluate(() => (window as any).__resumeSwitcherCommands());
  const input = popup.getByRole('combobox'); await expect(input).toBeFocused();
  await expect(popup.locator('.palette-footer-title')).toHaveText('Tab Switcher');
  expect(await f.active()).toBe(f.ids.source);
  await input.pressSequentially('Bridge-B');
  await expect(popup.getByRole('option')).toHaveCount(1);
  await popup.locator('.primary-action').click();
  await expect.poll(() => popup.isClosed()).toBe(true); await expect.poll(f.active).toBe(f.ids.previous);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English recent bridge cancels when focus is lost before the window becomes ready', async () => {
  const f = await bridgeFixture();
  let resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  await context.route('**/switcher.js', async route => { await gate; await route.continue(); });
  await f.a.keyboard.down('Control');
  await f.open();
  const other = await worker.evaluate(() => chrome.windows.create({ url: 'about:blank', focused: true }));
  resume();
  await expect.poll(f.windows).toBe(0);
  expect(await f.active()).toBe(f.ids.source);
  expect(await worker.evaluate(async () => (await chrome.windows.getLastFocused()).id)).toBe(other!.id);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English recent bridge ignores synthetic page releases and leaves typing unchanged', async () => {
  const f = await bridgeFixture();
  const input = f.a.getByRole('textbox');
  await input.fill('ordinary text');
  await f.a.keyboard.down('Control');
  await f.a.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' })));
  const created = context.waitForEvent('page'); await f.open(); const popup = await created;
  await expect(popup.getByRole('option').first()).toBeVisible();
  expect(await f.active()).toBe(f.ids.source);
  await popup.keyboard.down('Escape');
  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect(input).toHaveValue('ordinary text');
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English recent bridge catches a quick release inside a focused child frame', async () => {
  const f = await bridgeFixture();
  await f.a.evaluate(url => { const frame = document.createElement('iframe'); frame.src = url; document.body.append(frame); }, `${origin}/Child-frame`);
  const input = f.a.frameLocator('iframe').getByRole('textbox');
  await input.click();
  await f.a.keyboard.down('Control'); await f.a.keyboard.up('Control');
  await f.open();
  await expect.poll(f.active).toBe(f.ids.previous);
  expect(await f.windows()).toBe(0);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English recent bridge does not infer release on pages without an injected listener', async () => {
  const f = await bridgeFixture();
  await f.a.goto('about:blank');
  const created = context.waitForEvent('page'); await f.open(); const popup = await created;
  await expect(popup.getByRole('option').first()).toBeVisible();
  expect(await f.active()).toBe(f.ids.source);
  await popup.keyboard.down('Escape');
  await expect.poll(() => popup.isClosed()).toBe(true);
  expect(await f.active()).toBe(f.ids.source);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English recent bridge preserves repeated command steps during delayed window startup', async () => {
  const f = await bridgeFixture();
  let resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  await context.route('**/switcher.js', async route => { await gate; await route.continue(); });
  await f.a.keyboard.down('Control');
  const created = context.waitForEvent('page'); await f.open(); const popup = await created;
  await f.open(); await f.open();
  await f.a.keyboard.up('Control');
  const order = await worker.evaluate(async id => {
    const all = await chrome.tabs.query({ windowId: id });
    return all.sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0) || a.index - b.index).map(tab => tab.id);
  }, f.ids.window);
  resume();
  await expect.poll(f.active).toBe(order[3 % order.length]);
  await expect.poll(() => popup.isClosed()).toBe(true);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English recent bridge closes a loading popup when its source window is removed', async () => {
  const f = await bridgeFixture();
  let resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  await context.route('**/switcher.js', async route => { await gate; await route.continue(); });
  await f.a.keyboard.down('Control');
  await f.open();
  await worker.evaluate(id => chrome.windows.remove(id), f.ids.window);
  resume();
  await expect.poll(f.windows).toBe(0);
});
});


for (const host of ['overlay', 'native'] as const) test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true, headed: true } });
  test(`English Settings Keyboard binding guide survives real ${host} navigation`, async () => {
    const source = await context.newPage();
    await source.goto(host === 'overlay' ? `${origin}/Binding-guide-source` : 'chrome://version/');
    await source.bringToFront();
    const visibilitySession = await context.newCDPSession(source);
    await visibilitySession.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    await expect.poll(() => source.evaluate(() => document.hasFocus())).toBe(true);
    await worker.evaluate(async () => {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    });
    if (host === 'native') await expect.poll(() => context.pages().some(page => page.url().includes('popup.html#window='))).toBe(true);
    const native = host === 'native' ? context.pages().find(page => page.url().includes('popup.html#window='))! : undefined;
    const surface = native || source.frameLocator('.justonehop-frame');
    await surface.locator('.settings-button').click();
    await surface.getByRole('button', { name: 'Set Up', exact: true }).click();
    const code = await surface.getByRole('textbox', { name: 'JavaScript code' }).inputValue();
    await surface.getByRole('button', { name: 'Copy & Open', exact: true }).click();
    await expect.poll(() => context.pages().some(page => page.url() === 'chrome://extensions/shortcuts')).toBe(true);
    const shortcuts = context.pages().find(page => page.url() === 'chrome://extensions/shortcuts')!;
    await shortcuts.bringToFront();
    await expect.poll(() => source.evaluate(() => document.hidden)).toBe(true);
    if (host === 'overlay') {
      for (let round = 0; round < 3; round++) {
        await source.bringToFront();
        await expect(surface.locator('.binding-guide')).toBeVisible();
        await expect(surface.getByRole('textbox', { name: 'JavaScript code' })).toHaveValue(code);
        await expect.poll(() => source.evaluate(() => document.hidden)).toBe(false);
        await shortcuts.bringToFront();
        await expect.poll(() => source.evaluate(() => document.hidden)).toBe(true);
      }
      await source.bringToFront();
      await surface.locator('.footer-back').click();
      await shortcuts.bringToFront();
      await expect.poll(() => source.evaluate(() => document.hidden)).toBe(true);
      await source.bringToFront();
      await expect(source.locator('#justonehop-command-palette')).toHaveCount(0);
    } else {
      await expect.poll(() => context.pages().some(page => page.url().endsWith('popup.html#binding'))).toBe(true);
      const guide = context.pages().find(page => page.url().endsWith('popup.html#binding'))!;
      await guide.bringToFront();
      await expect(guide.locator('.binding-guide')).toBeVisible();
      await expect(guide.getByRole('textbox', { name: 'JavaScript code' })).toHaveValue(code);
    }
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English retired scripts stay absent from search and Settings while binding setup remains available', async () => {
    await worker.evaluate(() => chrome.storage.local.set({
      'saved-script:legacy': { title: 'Legacy helper unique', code: 'globalThis.__legacyScriptExecuted = true' },
    }));
    await ui.reload();
    const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await expect(ui.locator('.result.command')).toHaveCount(9);
    for (const query of ['scripts', 'script library', 'new script', 'run script', 'userscript', '脚本', 'Legacy helper unique']) {
      await search.fill(query);
      await expect(ui.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
      await expect(ui.locator('#justonehop-results .result:not(#justonehop-search-all-history)')).toHaveCount(0);
    }
    const permissions = await worker.evaluate(() => {
      const manifest = chrome.runtime.getManifest();
      return [...(manifest.permissions || []), ...(manifest.optional_permissions || [])];
    });
    expect(permissions).not.toContain('userScripts');
    expect(await ui.evaluate(() => '__legacyScriptExecuted' in globalThis)).toBe(false);
    await ui.locator('.settings-button').click();
    await expect(ui.locator('[data-setting]')).toHaveCount(7);
    await expect(ui.getByRole('button', { name: 'Manage Scripts', exact: true })).toHaveCount(0);
    const settings = ui.getByRole('textbox', { name: 'Search settings', exact: true });
    await settings.fill('scripts'); await expect(ui.locator('[data-setting]')).toHaveCount(0);
    await settings.fill('ctrl tab');
    const setup = ui.getByRole('button', { name: 'Set Up', exact: true });
    await setup.click();
    await expect(ui.getByRole('region', { name: 'Set Up Ctrl+Tab', exact: true })).toBeVisible();
    await expect(ui.locator('.binding-code-field textarea')).toHaveAttribute('readonly', '');
    await ui.locator('.footer-back').click();
    await expect(settings).toHaveValue('ctrl tab'); await expect(setup).toBeFocused();
    await ui.keyboard.press('Escape'); await expect(search).toBeFocused();
    await search.fill('Ctrl+Tab');
    await expect(ui.locator('[id="justonehop-command:settings:binding"]')).toHaveAttribute('aria-selected', 'true');
    await search.press('Enter'); await expect(setup).toBeFocused();
    await ui.keyboard.press('Escape'); await search.fill('help');
    await expect(ui.locator('[id="justonehop-command:help"]')).toHaveAttribute('aria-selected', 'true');
    await expect(ui.locator('.palette-footer .primary-action')).toBeEnabled();
    await search.press('Enter');
    const help = ui.getByRole('textbox', { name: 'Search help', exact: true });
    await help.fill('userscript');
    await expect(ui.getByRole('article').getByRole('heading')).toHaveCount(0);
    expect(await worker.evaluate(async () => (await chrome.storage.local.get('saved-script:legacy'))['saved-script:legacy']))
      .toEqual({ title: 'Legacy helper unique', code: 'globalThis.__legacyScriptExecuted = true' });
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English binding guide copies this installation ID and opens Chrome shortcuts', async () => {
  await context.grantPermissions(['clipboard-read']);
  const before = await worker.evaluate(() => chrome.commands.getAll());
  await ui.locator('.settings-button').click();
  await ui.getByRole('button', { name: 'Set Up', exact: true }).click();
  await expect(ui.locator('.palette-footer-title').filter({ hasText: 'Set Up Ctrl+Tab' })).toBeVisible();
  await expect(ui.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await expect(ui.getByRole('textbox', { name: 'JavaScript code' })).toHaveAttribute('readonly', '');
  await expect(ui.locator('.binding-view .settings-header')).toHaveCount(0);
  const copy = ui.locator('.palette-footer .primary-action');
  await expect(copy).toHaveAccessibleName('Copy & Open');
  await expect(copy).toBeFocused();
  await expect(ui.locator('.binding-body')).toBeVisible();
  await ui.locator('.palette-footer .actions-button').click();
  await ui.getByRole('dialog').getByRole('option', { name: /^Copy Code/ }).click();
  await expect(ui.getByRole('status')).toContainText('Code copied');
  const code = await ui.evaluate(() => navigator.clipboard.readText());
  expect(code).not.toMatch(/[\r\n]/);
  await expect(ui.locator('.palette-footer-title')).toHaveText('Set Up Ctrl+Tab');
  const calls: unknown[] = [];
  new Function('chrome', code)({ developerPrivate: { updateExtensionCommand: (value: unknown) => calls.push(value) } });
  expect(calls).toEqual([
    { extensionId: new URL(worker.url()).hostname, commandName: 'switch-recent', keybinding: 'Ctrl+Tab' },
    { extensionId: new URL(worker.url()).hostname, commandName: 'switch-recent-back', keybinding: 'Ctrl+Shift+Tab' },
  ]);
  expect(await worker.evaluate(() => chrome.commands.getAll())).toEqual(before);
  await ui.setViewportSize({ width: 390, height: 500 });
  await ui.locator('.justonehop-app').evaluate(node => { node.classList.replace('popup', 'overlay'); document.body.style.width = '390px'; });
  expect(await ui.locator('.binding-body').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(ui.locator('.palette-footer .primary-action')).toBeInViewport({ ratio: 1 });
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('binding-guide.png') });
  await ui.locator('.palette-footer .actions-button').click();
  await expect(ui.getByRole('dialog').getByRole('option', { name: 'Delete', exact: true })).toHaveCount(0);
  await ui.locator('.palette-footer .footer-back').click();
  await expect(ui.locator('.action-menu')).toHaveCount(0);
  await expect(ui.locator('.palette-footer-title')).toHaveText('Set Up Ctrl+Tab');
  await ui.evaluate(() => navigator.clipboard.writeText('before combined action'));
  await copy.focus();
  const created = context.waitForEvent('page');
  await ui.keyboard.press('Enter');
  await expect(await created).toHaveURL('chrome://extensions/shortcuts');
  expect(ui.isClosed()).toBe(false);
  await ui.bringToFront();
  await expect(ui.locator('.binding-guide')).toBeVisible();
  await expect(ui.locator('.palette-footer-title')).toHaveText('Set Up Ctrl+Tab');
  expect(await ui.evaluate(() => navigator.clipboard.readText())).toBe(code);
  await ui.locator('.palette-footer .actions-button').click();
  await ui.getByRole('dialog').getByRole('option', { name: /Open Chrome Shortcuts/ }).click();
  expect(ui.isClosed()).toBe(false);
  await ui.bringToFront();
  await expect(ui.locator('.binding-guide')).toBeVisible();
});
});


test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true } });
  test('English binding guide copies from unified search inside the closed keyboard frame', async () => {
  await context.grantPermissions(['clipboard-read']);
  const page = await context.newPage(); await page.goto(`${origin}/Binding-overlay`);
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, page.url());
  await worker.evaluate(async id => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(id, { source: 'justonehop', type: 'toggle' });
  }, tabId);
  const cdp = await context.newCDPSession(page);
  await expect.poll(async () => {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
    return (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes.some(node => node.role?.value === 'combobox');
  }).toBe(true);
  const focused = async (name: string) => {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
    return (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes.some(node => node.name?.value === name && node.properties?.some(prop => prop.name === 'focused' && prop.value.value === true));
  };
  await expect.poll(() => focused('Search commands, tabs, bookmarks, and history')).toBe(true);
  await page.keyboard.type('ctrl tab');
  await expect.poll(async () => {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
    const nodes = (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes;
    return nodes.some(node => node.role?.value === 'option' && node.name?.value?.includes('JustOneHop Settings: Set Up Ctrl+Tab') && node.properties?.some(prop => prop.name === 'selected' && prop.value.value === true)) &&
      nodes.some(node => node.role?.value === 'button' && node.name?.value === 'Set Up Ctrl+Tab' && !node.properties?.some(prop => prop.name === 'disabled' && prop.value.value === true));
  }).toBe(true);
  await page.keyboard.press('Enter');
  await expect.poll(() => focused('Set Up')).toBe(true);
  await page.keyboard.press('Enter'); await expect.poll(() => focused('Copy & Open')).toBe(true);
  await page.keyboard.press('Meta+k'); await expect.poll(() => focused('Search actions')).toBe(true);
  await page.keyboard.type('copy'); await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('chrome.developerPrivate.updateExtensionCommand');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(new URL(worker.url()).hostname);
  await page.keyboard.press('Escape'); await expect.poll(() => focused('Set Up')).toBe(true);
  await page.keyboard.press('Escape'); await expect.poll(() => focused('Search commands, tabs, bookmarks, and history')).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
});
});


test('Chinese binding guide returns to settings and retains its standalone handoff', async () => {
  const search = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
  await search.fill('ctrl tab'); await search.press('Enter');
  const setup = ui.locator('[data-setting=binding] button');
  await expect(setup).toBeFocused(); await setup.press('Enter');
  await expect(ui.getByRole('region', { name: '配置 Ctrl+Tab', exact: true })).toBeVisible();
  await expect(ui.getByLabel('JavaScript 代码')).toHaveAttribute('readonly', '');
  await ui.keyboard.press('Meta+k');
  await expect(ui.locator('.action-row')).toContainText(['复制代码', '打开 Chrome 快捷键页']);
  await ui.keyboard.press('Escape'); await ui.keyboard.press('Escape');
  await expect(setup).toBeFocused();
  await ui.keyboard.press('Escape'); await expect(search).toBeFocused(); await expect(search).toHaveValue('ctrl tab');
  await search.press('Enter'); await expect(setup).toBeFocused(); await setup.press('Enter');
  const created = context.waitForEvent('page');
  await ui.getByRole('button', { name: '复制并打开', exact: true }).click();
  await expect(await created).toHaveURL('chrome://extensions/shortcuts');
  expect(ui.isClosed()).toBe(false);
  await ui.bringToFront();
  await expect(ui.locator('.binding-guide')).toBeVisible();
  // Exercise the transient-host handoff separately from the persistent test tab.
  const guideCreated = context.waitForEvent('page');
  await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'open-shortcuts', preserveBindingGuide: true }));
  const guide = await guideCreated;
  await expect(guide).toHaveURL(/popup\.html#binding$/);
  await guide.bringToFront();
  await expect(guide.locator('.binding-guide')).toBeVisible();
  await expect(guide.getByRole('button', { name: '复制并打开', exact: true })).toBeVisible();
  await guide.getByRole('button', { name: '复制并打开', exact: true }).click();
  await guide.bringToFront();
  await expect(guide.locator('.binding-guide')).toBeVisible();
  await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'open-shortcuts', preserveBindingGuide: true }));
  expect(context.pages().filter(page => page.url().endsWith('popup.html#binding'))).toHaveLength(1);
});


test('Chinese command discovery opens each preference at its keyboard control', async () => {
  const search = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
  for (const [query, label] of [['语言', '语言'], ['主题', '主题']] as const) {
    await search.fill(query); await ui.keyboard.press('Enter');
    const control = ui.getByRole('combobox', { name: label, exact: true });
    await expect(control).toBeFocused();
    await ui.keyboard.press('Enter'); await expect(control).toHaveAttribute('aria-expanded', 'true');
    await ui.keyboard.press('Escape'); await ui.keyboard.press('Escape');
    await expect(search).toBeFocused(); await expect(search).toHaveValue(query);
  }
  await search.fill('快捷键'); await ui.keyboard.press('Enter');
  await expect(ui.locator('.hotkey-change')).toBeFocused();
  await ui.keyboard.press('Escape'); await expect(search).toBeFocused();
  await search.fill('重置搜索排序'); await ui.keyboard.press('Enter');
  await expect(ui.locator('[data-setting=ranking] button')).toBeFocused();
  await ui.keyboard.press('Escape'); await expect(search).toBeFocused();
  await search.fill('设置 Ctrl+Tab'); await ui.keyboard.press('Enter');
  await expect(ui.locator('[data-setting=binding] button')).toBeFocused();
  await ui.keyboard.press('Enter');
  await expect(ui.locator('.binding-view')).toBeVisible();
  await ui.keyboard.press('Escape'); await expect(ui.locator('[data-setting=binding] button')).toBeFocused();
  await ui.keyboard.press('Escape'); await expect(search).toBeFocused();

});



test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English palette launch storage overlay opens centered on a fresh ordinary page', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Fresh-launch`);
  // The ordinary page already has the lightweight recent-key listener, but not the palette.
  const id = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, page.url());
  await expect.poll(() => worker.evaluate(async tabId => {
    try { return await chrome.tabs.sendMessage(tabId, { source: 'justonehop-recent', type: 'arm', session: 'launch-check', modifier: 'Control' }, { frameId: 0 }); }
    catch { return null; }
  }, id)).not.toBeNull();
  await worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  await expect(page.locator('#justonehop-command-palette')).toBeAttached();
  expect(await worker.evaluate(tabId => chrome.action.getPopup({ tabId }), id)).toBe('');
  const surface = page.frameLocator('.justonehop-frame');
  await expect(surface.getByRole('combobox')).toBeFocused();
  const bounds = await surface.locator('.palette').boundingBox();
  expect(Math.abs(bounds!.x + bounds!.width / 2 - 550)).toBeLessThan(1);
  await surface.getByRole('combobox').fill('settings'); await page.keyboard.press('Enter');
  await expect(surface.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  const settings = await surface.locator('.palette').boundingBox();
  expect(settings!.x).toBe(bounds!.x); expect(settings!.y).toBe(bounds!.y);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
  // A successful launch must also recover any per-tab popup left by an earlier failure.
  await worker.evaluate(async tabId => {
    await chrome.action.setPopup({ tabId, popup: 'popup.html' });
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  }, id);
  await expect(page.locator('#justonehop-command-palette')).toBeAttached();
  expect(await worker.evaluate(tabId => chrome.action.getPopup({ tabId }), id)).toBe('');
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English binding guide preserves code selection through the shared action menu', async () => {
  await context.grantPermissions(['clipboard-read']);
  const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await search.fill('ctrl tab'); await search.press('Enter');
  const setup = ui.getByRole('button', { name: 'Set Up', exact: true });
  await expect(setup).toBeFocused(); await setup.press('Enter');
  const code = ui.locator('.binding-code-field textarea');
  const original = await code.inputValue();
  await expect(code).toHaveAttribute('readonly', '');
  await code.focus(); await code.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(6, 11));
  await code.press('Meta+k');
  const actions = ui.getByRole('combobox', { name: 'Search actions' });
  await expect(actions).toBeFocused();
  await expect(ui.locator('#binding-actions')).toBeVisible();
  await expect(ui.locator('.action-row')).toContainText(['Copy Code', 'Open Chrome Shortcuts']);
  await actions.press('Control+n');
  await expect(ui.locator('.action-row[aria-selected=true]')).toContainText('Open Chrome Shortcuts');
  await actions.press('Control+p');
  await expect(ui.locator('.action-row[aria-selected=true]')).toContainText('Copy Code');
  await actions.press('Escape'); await expect(code).toBeFocused();
  expect(await code.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([6, 11]);
  await code.press('Meta+k'); await actions.fill('copy'); await actions.press('Enter');
  await expect(code).toBeFocused();
  expect(await ui.evaluate(() => navigator.clipboard.readText())).toBe(original);
  expect(await code.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([6, 11]);
  await code.press('Escape'); await expect(setup).toBeFocused();
  await ui.keyboard.press('Escape'); await expect(search).toBeFocused(); await expect(search).toHaveValue('ctrl tab');
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, commands: true } });
  test('English palette launch overlay Escape returns one level from binding setup', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Escape-binding`);
  await worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  const cdp = await context.newCDPSession(page);
  const ax = async () => {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
    return (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes;
  };
  const focused = async (name: string) => (await ax()).some(node => node.name?.value === name && node.properties?.some(prop => prop.name === 'focused' && prop.value.value === true));
  await expect.poll(() => focused('Search commands, tabs, bookmarks, and history')).toBe(true);
  await page.keyboard.type('ctrl tab'); await page.keyboard.press('Enter');
  await expect.poll(() => focused('Set Up')).toBe(true);
  await page.keyboard.press('Enter'); await expect.poll(() => focused('Copy & Open')).toBe(true);
  await page.keyboard.press('Meta+k'); await expect.poll(() => focused('Search actions')).toBe(true);
  await page.keyboard.press('Escape'); await expect.poll(() => focused('Copy & Open')).toBe(true);
  await page.keyboard.press('Escape'); await expect.poll(() => focused('Set Up')).toBe(true);
  await expect.poll(async () => (await ax()).some(node => node.role?.value === 'region' && node.name?.value === 'Settings')).toBe(true);
  await expect(page.locator('#justonehop-command-palette')).toBeAttached();
  await page.keyboard.press('Escape'); await expect.poll(() => focused('Search commands, tabs, bookmarks, and history')).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English palette launch storage overlay Escape returns after clicking non-focusable content', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Escape-content`);
  await worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  const surface = page.frameLocator('.justonehop-frame');
  const search = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  for (const [query, heading] of [['settings', 'Settings'], ['local storage', 'Local Storage'], ['session storage', 'Session Storage']]) {
    await search.fill(query); await page.keyboard.press('Enter');
    await surface.locator('.palette-footer-title').filter({ hasText: heading }).click();
    await page.keyboard.press('Escape'); await expect(search).toBeFocused();
    await expect(search).toHaveValue(query);
  }
  await search.fill('ctrl tab'); await page.keyboard.press('Enter');
  await surface.getByRole('button', { name: 'Set Up', exact: true }).click();
  await page.keyboard.press('Meta+k');
  await surface.locator('.action-heading').click(); await page.keyboard.press('Escape');
  await expect(surface.locator('.binding-view .primary-action')).toBeFocused();
  await surface.locator('.binding-guide p').first().click(); await page.keyboard.press('Escape');
  await expect(surface.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  await surface.locator('.settings-view .palette-footer-title').click();
  await page.keyboard.press('Escape'); await expect(search).toBeFocused();
  await search.fill('local storage'); await page.keyboard.press('Enter');
  await surface.locator('.palette-footer-context').click(); await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
  await search.fill('no-such-command'); await surface.getByText('No results found', { exact: true }).click();
  await page.keyboard.press('Escape'); await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English wheel back preserves layers readers and cancels on other input', async () => {
    const page = await context.newPage(); await page.goto(`${origin}/Wheel-readers`);
    await page.evaluate(() => localStorage.setItem('wide', 'wide text '.repeat(400)));
    await worker.evaluate(async () => {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    });
    const surface = page.frameLocator('.justonehop-frame');
    const search = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await search.fill('local storage');
    await expect(surface.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
    await expect(surface.locator('.primary-action')).toBeEnabled();
    await search.press('Enter');
    const keys = surface.getByRole('combobox', { name: 'Search storage keys' });
    await expect(surface.locator('.storage-row')).toHaveCount(1);
    const reader = surface.locator('.storage-preview .preview-code');
    await reader.hover(); await page.mouse.wheel(300, 0);
    await expect.poll(() => reader.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
    await page.mouse.wheel(-1000, 0);
    await expect.poll(() => reader.evaluate(node => node.scrollLeft)).toBe(0);
    await page.mouse.wheel(-200, 0);
    await page.waitForTimeout(300);
    await expect(keys).toBeVisible();
    await keys.fill('wide'); await keys.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 3));
    await surface.locator('.storage-row').click({ button: 'right' });
    await expect(surface.locator('.action-menu')).toBeVisible();
    await surface.locator('.action-heading').hover();
    for (const amount of [-45, -70, -30, -12, -4]) await page.mouse.wheel(amount, 0);
    await expect(surface.locator('.action-menu')).toHaveCount(0);
    await expect(keys).toBeFocused(); await expect(keys).toHaveValue('wide');
    expect(await keys.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 3]);
    // Playwright wheel calls may span several native sequences. End the reader's
    // final tail before starting a distinct gesture over the footer.
    await page.waitForTimeout(300);
    await surface.locator('.palette-footer-title').hover();
    await page.mouse.wheel(-60, 0);
    await expect(surface.locator('.wheel-back-hint')).toHaveAttribute('data-ready', 'false');
    await keys.evaluate(node => ((node.getRootNode() as ShadowRoot).activeElement as HTMLElement)?.blur());
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300); await expect(keys).toBeVisible();
    await surface.locator('.palette-footer-title').hover();
    await page.mouse.wheel(-20, 0); await page.waitForTimeout(300); await expect(keys).toBeVisible();
    await page.mouse.wheel(0, 150); await page.waitForTimeout(300); await expect(keys).toBeVisible();
    await page.mouse.wheel(-140, 0); await expect(search).toBeFocused();
    await expect(search).toHaveValue('local storage');
    await search.fill('tab switcher');
    await expect(surface.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
    await expect(surface.locator('.primary-action')).toBeEnabled();
    await search.press('Enter');
    await expect(surface.locator('.recent-switcher')).toBeVisible();
    await page.waitForTimeout(300);
    await surface.locator('.palette-footer-title').hover(); await page.mouse.wheel(-140, 0);
    await expect(search).toBeFocused(); await expect(search).toHaveValue('tab switcher');
    await page.keyboard.press('Escape'); await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, commands: true } });
  test('English wheel back works in the closed iframe and closes only the palette', async () => {
    const page = await context.newPage(); await page.goto(`${origin}/Wheel-closed`);
    await page.getByRole('textbox', { name: 'Page input' }).focus();
    await worker.evaluate(async () => {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    });
    const cdp = await context.newCDPSession(page);
    const focused = async (name: string) => {
      const { frameTree } = await cdp.send('Page.getFrameTree');
      const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
      const { nodes } = await cdp.send('Accessibility.getFullAXTree', { frameId });
      return nodes.some(node => node.name?.value === name && node.properties?.some(prop => prop.name === 'focused' && prop.value.value === true));
    };
    await expect.poll(() => focused('Search commands, tabs, bookmarks, and history')).toBe(true);
    // Wait for the settings button before using the shared keyboard shortcut.
    await expect.poll(async () => {
      const { frameTree } = await cdp.send('Page.getFrameTree');
      const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
      return (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes.some(node =>
        node.role?.value === 'button' && node.name?.value === 'Settings' &&
        !node.properties?.some(prop => prop.name === 'disabled' && prop.value.value === true));
    }).toBe(true);
    await page.keyboard.press('Meta+,');
    await expect.poll(() => focused('Search settings')).toBe(true);
    const size = page.viewportSize()!;
    await page.mouse.move(size.width / 2, Math.min(150, Math.max(28, size.height * .16)) + 30);
    await page.mouse.wheel(-140, 0);
    await expect.poll(() => focused('Search commands, tabs, bookmarks, and history')).toBe(true);
    await page.waitForTimeout(300);
    await page.mouse.wheel(-140, 0);
    await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
    await expect(page.getByRole('textbox', { name: 'Page input' })).toBeFocused();
    await expect(page).toHaveURL(`${origin}/Wheel-closed`);
    await cdp.detach();
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English wheel back returns from settings in the extension page', async () => {
    const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await search.fill('settings'); await search.press('Enter');
    await expect(ui.getByRole('textbox', { name: 'Search settings' })).toBeFocused();
    const result = await ui.locator('.palette-footer-title').evaluate(node => {
      const swipe = () => new WheelEvent('wheel', { deltaX: -140, bubbles: true, cancelable: true });
      const first = swipe(); node.dispatchEvent(first);
      // Inspect synchronously: a timer-based return must fail this assertion.
      const returned = !!document.querySelector('input[aria-label="Search commands, tabs, bookmarks, and history"]');
      const tail = swipe(); document.querySelector('.palette-footer-title')!.dispatchEvent(tail);
      return { returned, captured: first.defaultPrevented, tailCaptured: tail.defaultPrevented };
    });
    expect(result).toEqual({ returned: true, captured: true, tailCaptured: true });
    await ui.waitForTimeout(300);
    await expect(search).toBeFocused();
    expect(ui.isClosed()).toBe(false);
  });
  test('English Escape routing survives lost control focus through binding and settings layers', async () => {
  const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  const escapeWithoutControlFocus = async () => {
    await ui.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await ui.keyboard.press('Escape');
  };
  await search.fill('settings'); await search.press('Enter');
  const language = ui.getByRole('combobox', { name: 'Language', exact: true });
  await language.press('Enter'); await escapeWithoutControlFocus();
  await expect(language).toHaveAttribute('aria-expanded', 'false'); await expect(language).toBeFocused();
  const setup = ui.getByRole('button', { name: 'Set Up', exact: true });
  await setup.click();
  await ui.keyboard.press('Meta+k'); await escapeWithoutControlFocus();
  await expect(ui.locator('.binding-view .primary-action')).toBeFocused();
  await escapeWithoutControlFocus(); await expect(setup).toBeFocused();
  await expect(ui.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  await escapeWithoutControlFocus(); await expect(search).toBeFocused(); await expect(search).toHaveValue('settings');
  await search.fill('help'); await search.press('Enter');
  await expect(ui.getByRole('article', { name: 'Help', exact: true })).toBeVisible();
  await escapeWithoutControlFocus(); await expect(search).toBeFocused(); await expect(search).toHaveValue('help');
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English palette launch storage overlay Escape routes from the document through storage layers', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Escape-storage-layers`);
  await page.evaluate(() => { localStorage.setItem('fixture', '{"hello":"world"}'); sessionStorage.setItem('fixture', 'session'); });
  const open = () => worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  await open();
  const surface = page.frameLocator('.justonehop-frame');
  const search = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  const blur = () => surface.locator('.justonehop-app').evaluate(node => {
    ((node.getRootNode() as ShadowRoot).activeElement as HTMLElement)?.blur();
  });
  const escape = async () => { await blur(); await page.keyboard.press('Escape'); };
  for (const command of ['local storage', 'session storage']) {
    await search.fill(command); await page.keyboard.press('Enter');
    const keys = surface.getByRole('combobox', { name: 'Search storage keys' });
    await expect(surface.locator('.storage-row')).toHaveCount(1);
    await page.keyboard.press('Meta+k');
    await surface.getByRole('combobox', { name: 'Search actions' }).fill('details');
    await page.keyboard.press('Enter');
    await expect(surface.locator('.storage-detail')).toBeVisible();
    await page.keyboard.press('Meta+k'); await escape();
    await expect(surface.locator('.storage-detail')).toBeFocused();
    await escape(); await expect(keys).toBeFocused();
    await escape(); await expect(search).toBeFocused();
    await expect(search).toHaveValue(command);
  }
  await search.fill('local storage'); await page.keyboard.press('Enter');
  // Composition owns Escape until committed; repeated keydown must not pop again.
  await surface.locator('.justonehop-app').evaluate(node => {
    const doc = node.ownerDocument;
    doc.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true }));
    doc.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, repeat: true }));
  });
  await expect(surface.getByRole('combobox', { name: 'Search storage keys' })).toBeVisible();
  await escape(); await expect(search).toBeFocused();
  await escape(); await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
  // Reopen to catch stale registrations/listeners left behind by the prior mount.
  await open(); await expect(search).toBeFocused();
  await search.fill('local storage'); await page.keyboard.press('Enter');
  await escape(); await expect(search).toBeFocused();
  await escape(); await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
});
});


test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English Backspace returns from empty searches while preserving text editing and the root', async () => {
  const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await search.fill('settings'); await search.press('Enter');
  const settings = ui.getByRole('textbox', { name: 'Search settings', exact: true });
  await settings.fill('test'); await settings.press('Backspace'); await expect(settings).toHaveValue('tes');
  await settings.press('Meta+a'); await settings.press('Backspace'); await expect(settings).toHaveValue('');
  const setup = ui.getByRole('button', { name: 'Set Up', exact: true });
  await setup.click();
  const code = ui.getByLabel('JavaScript code');
  const original = await code.inputValue();
  await code.focus(); await code.press('Backspace'); await expect(code).toBeFocused(); await expect(code).toHaveValue(original);
  await code.press('Meta+k');
  const actions = ui.getByRole('combobox', { name: 'Search actions' });
  await actions.fill('copy'); await actions.press('Backspace'); await expect(actions).toHaveValue('cop');
  await actions.fill(''); await actions.press('Backspace'); await expect(code).toBeFocused();
  await ui.locator('.footer-back').focus(); await ui.keyboard.press('Backspace'); await expect(setup).toBeFocused();
  const language = ui.getByRole('combobox', { name: 'Language', exact: true });
  await language.press('Enter'); await language.press('Backspace'); await expect(language).toHaveAttribute('aria-expanded', 'false');
  await language.press('Backspace'); await expect(search).toBeFocused();
  await search.fill(''); await search.press('Backspace'); await expect(search).toBeFocused();
  await search.press('Meta+k'); await ui.keyboard.press('Backspace'); await expect(search).toBeFocused();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, commands: true } });
  test('English palette launch overlay Backspace respects fields inside the closed keyboard frame', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Backspace-navigation`);
  await page.evaluate(() => localStorage.setItem('fixture', '{"value":42}'));
  await worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  const cdp = await context.newCDPSession(page);
  const ax = async () => {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
    return (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes;
  };
  const focused = async (name: string) => (await ax()).some(node => node.name?.value === name && node.properties?.some(prop => prop.name === 'focused' && prop.value.value === true));
  await expect.poll(() => focused('Search commands, tabs, bookmarks, and history')).toBe(true);
  await page.keyboard.type('help'); await page.keyboard.press('Enter');
  await expect.poll(() => focused('Search help')).toBe(true);
  await page.keyboard.type('x'); await page.keyboard.press('Backspace');
  await expect.poll(() => focused('Search help')).toBe(true);
  await page.keyboard.press('Backspace');
  await expect.poll(() => focused('Search commands, tabs, bookmarks, and history')).toBe(true);
  await page.keyboard.press('Meta+a'); await page.keyboard.type('ctrl tab'); await page.keyboard.press('Enter');
  await expect.poll(() => focused('Set Up')).toBe(true);
  await page.keyboard.press('Enter'); await expect.poll(() => focused('Copy & Open')).toBe(true);
  await page.keyboard.press('Meta+k'); await expect.poll(() => focused('Search actions')).toBe(true);
  await page.keyboard.press('Backspace'); await expect.poll(() => focused('Copy & Open')).toBe(true);
  await page.keyboard.press('Backspace'); await expect.poll(() => focused('Set Up')).toBe(true);
  await page.keyboard.press('Backspace'); await expect.poll(() => focused('Search commands, tabs, bookmarks, and history')).toBe(true);
  await page.keyboard.press('Meta+a'); await page.keyboard.type('local storage'); await page.keyboard.press('Enter');
  await expect.poll(() => focused('Search storage keys')).toBe(true);
  await expect.poll(async () => (await ax()).some(node => node.role?.value === 'option')).toBe(true);
  await page.keyboard.press('Meta+k'); await expect.poll(() => focused('Search actions')).toBe(true);
  await page.keyboard.type('details'); await page.keyboard.press('Enter');
  await expect.poll(async () => (await ax()).some(node => node.name?.value === 'JSON preview · copies original value')).toBe(true);
  await page.keyboard.press('Meta+k'); await expect.poll(() => focused('Search actions')).toBe(true);
  await page.keyboard.press('Backspace');
  await expect.poll(async () => (await ax()).some(node => node.name?.value === 'JSON preview · copies original value')).toBe(true);
  await page.keyboard.press('Backspace'); await expect.poll(() => focused('Search storage keys')).toBe(true);
  await page.keyboard.press('Backspace'); await expect.poll(() => focused('Search commands, tabs, bookmarks, and history')).toBe(true);
  await page.keyboard.press('Meta+a'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
  await expect.poll(() => focused('Search commands, tabs, bookmarks, and history')).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
});
});

for (const language of ['English', 'Chinese']) test.describe(() => {
  test.use({ environment: { ...defaults, locale: language === 'English' ? 'en-US' : 'zh-CN', pageAccess: true, shadow: 'open' } });
  test(`${language} bookmark search shows shortcut and menu dispatch preserves bookmark state`, async () => {
    const page = await context.newPage(); await page.goto(`${origin}/Bookmark-shortcut-source`);
    await page.bringToFront();
    await worker.evaluate(async url => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
      await chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id!, { source: 'justonehop', type: 'toggle' });
    }, page.url());
    const surface = page.frameLocator('.justonehop-frame');
    const input = surface.locator('.search-bar input');
    await input.fill(language === 'English' ? 'bookmark tab' : '收藏标签页');
    const add = surface.locator('[id="justonehop-command:bookmarkTab"]');
    await expect(add.locator('.entry-shortcut kbd')).toHaveText('⌘D');
    await expect(add.locator('.entry-shortcut')).toHaveAttribute('aria-label', 'Command + D');
    await add.click({ button: 'right' });
    await expect(surface.locator('.action-row .entry-shortcut kbd')).toHaveText('⌘D');
    await page.keyboard.press('Meta+d');
    const bookmarks = () => worker.evaluate(url => chrome.bookmarks.search({ url }), page.url());
    await expect.poll(async () => (await bookmarks()).length).toBe(1);
    const remove = surface.locator('[id="justonehop-command:unbookmarkTab"]');
    await expect(remove).toBeVisible();
    await expect(remove.locator('.entry-shortcut')).toHaveCount(0);
    for (const query of ['add bookmark', 'save bookmark', '添加书签']) {
      await input.fill(query);
      const remembered = surface.locator('#justonehop-results [aria-disabled="true"]');
      await expect(remembered).toContainText(language === 'English' ? 'Already Bookmarked' : '已收藏');
      await expect(surface.locator('.primary-action')).toBeDisabled();
      await expect(surface.locator('.actions-button')).toBeDisabled();
      await input.press('Enter');
      const bounds = (await remembered.boundingBox())!;
      await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      expect((await bookmarks()).length).toBe(1);
    }
    await input.fill('book');
    await expect(remove).not.toHaveAttribute('aria-disabled', 'true');
    await remove.click();
    await expect.poll(async () => (await bookmarks()).length).toBe(0);
    await expect(add.locator('.entry-shortcut kbd')).toHaveText('⌘D');
    await expect(surface.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
    await input.press('Meta+ArrowUp');
    await expect(add).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
    await expect.poll(async () => (await bookmarks()).length).toBe(1);
    await expect(remove).toBeVisible();
    await expect(remove.locator('.entry-shortcut')).toHaveCount(0);
  });
});

for (const language of ['English', 'Chinese']) test.describe(() => {
  test.use({ environment: { ...defaults, locale: language === 'English' ? 'en-US' : 'zh-CN' } });
  test(`${language} categorized candidates show real shortcuts and keep search matching and binding setup`, async () => {
  const en = language === 'English';
  const search = ui.locator('.search-bar input');
  const switcher = ui.locator('[id="justonehop-command:tabSwitcher"]');
  const switcherSubtitle = 'Switch tabs like in VS Code';
  const actualBinding = await worker.evaluate(async () => (await chrome.commands.getAll()).find(command => command.name === 'switch-recent')?.shortcut || '');
  await expect(switcher.locator('.entry-subtitle')).toHaveText(switcherSubtitle);
  if (actualBinding) await expect(switcher.locator('.entry-shortcut kbd')).toHaveText(actualBinding);
  else await expect(switcher.locator('.entry-shortcut')).toHaveCount(0);
  await search.fill('Code');
  await expect(switcher).toBeVisible();
  await expect(switcher.locator('.entry-subtitle')).toHaveText(switcherSubtitle);
  await expect(switcher.locator('.entry-subtitle mark')).toHaveText('Code');
  if (actualBinding) await expect(switcher.locator('.entry-shortcut kbd')).toHaveText(actualBinding);
  else await expect(switcher.locator('.entry-shortcut')).toHaveCount(0);
  await search.fill('storage:local');
  const first = ui.locator('#justonehop-results [role="option"]').first();
  await expect(first.locator('.entry-title')).toHaveText(en ? 'Storage: View Local Storage' : '存储: 查看 Local Storage');
  await expect(first.locator('mark')).not.toHaveCount(0);
  await expect(first.locator('.entry-shortcut')).toHaveCount(0);
  await search.fill('new tab');
  await expect(first.locator('.entry-title')).toHaveText(en ? 'Tab: New Tab' : '标签页: 新建标签页');
  await expect(first.locator('.entry-shortcut kbd')).toHaveText(['⌘T']);
  await search.fill('restore'); await expect(first.locator('.entry-shortcut kbd')).toHaveText(['⌘⇧T']);
  await search.fill('settings'); await expect(first.locator('.entry-shortcut kbd')).toHaveText(['⌘,']);
  await search.press('Meta+k');
  await expect(ui.locator('.action-row .entry-shortcut kbd')).toHaveText(['⌘,']);
  await ui.keyboard.press('Meta+,'); await expect(ui.locator('.settings-view .palette-footer-title')).toHaveText(en ? 'Settings' : '设置');
  await ui.keyboard.press('Escape');
  await search.fill('ctrl tab'); await search.press('Enter');
  const setup = ui.locator('[data-setting=binding] button');
  await expect(setup).toBeFocused(); await setup.press('Enter');
  await expect(ui.locator('.binding-view')).toHaveAccessibleName(en ? 'Set Up Ctrl+Tab' : '配置 Ctrl+Tab');
  await expect(ui.locator('.binding-code-field textarea')).toHaveAttribute('readonly', '');
  await ui.keyboard.press('Escape'); await expect(setup).toBeFocused();
  await ui.keyboard.press('Escape'); await expect(search).toBeFocused();
  for (const theme of ['light', 'dark']) {
    await worker.evaluate(preferences => chrome.storage.local.set({ preferences }), { language: en ? 'en' : 'zh', theme });
    await search.fill('new tab'); await ui.setViewportSize({ width: 390, height: 516 });
    await ui.evaluate(() => { document.body.style.width = '390px'; });
    await expect(ui.locator('.justonehop-app')).toHaveAttribute('data-theme', theme);
    const row = ui.locator('#justonehop-command\\:newTab');
    await expect(row.locator('.entry-shortcut')).toBeInViewport();
    expect(await ui.locator('.palette').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await ui.locator('.palette').screenshot({ path: test.info().outputPath(`justonehop-categories-${language}-${theme}.png`) });
  }
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English palette launch storage overlay native favicons render cached website icons and fall back on errors', async () => {
  const website = await context.newPage(); await website.goto(`${origin}/Favicon-site`);
  await expect.poll(() => worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.favIconUrl || '', website.url())).toContain('/fixture-icon.png');
  await worker.evaluate(url => chrome.bookmarks.create({ title: 'Favicon bookmark', url }), website.url());
  await ui.bringToFront(); await ui.reload();
  const input = ui.locator('.search-bar input'); await input.fill('Favicon');
  for (const kind of ['tab', 'bookmark']) {
    const row = ui.locator(`.result.${kind}`).first();
    await expect(row.locator('.entry-title')).toHaveText(kind === 'tab' ? 'Favicon site' : 'Favicon bookmark');
    const icon = row.locator('img.entry-favicon.loaded');
    await expect(icon).toBeVisible();
    expect(await icon.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(32);
    expect(await icon.getAttribute('src')).toContain('/_favicon/?pageUrl=');
  }
  await website.bringToFront();
  await worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  const surface = website.frameLocator('.justonehop-frame');
  const search = surface.locator('.search-bar input'); await search.fill('Favicon site');
  const icon = surface.locator('.result.tab img.entry-favicon.loaded').first();
  await expect(icon).toBeVisible();
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('justonehop-favicon-overlay.png') });
  // A real image failure must leave a type icon, never a broken-image glyph.
  await icon.evaluate((img: HTMLImageElement) => { img.src = img.src.replace('/_favicon/', '/missing-icon.png'); });
  await expect(surface.locator('.result.tab img')).toHaveCount(0);
  await expect(surface.locator('.result.tab .entry-icon svg')).toBeVisible();
  await search.fill('close tab'); await expect(surface.locator('.result.command .entry-shortcut').first()).toHaveText('⌘W');
  await search.fill('reload'); await expect(surface.locator('.result.command .entry-shortcut').first()).toHaveText('⌘R');
  await search.fill('settings'); await search.press('Meta+,');
  await expect(surface.locator('.settings-view .palette-footer-title')).toHaveText('Settings');
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English performance repeated openings reuse bookmarks and observe bookmark edits', async () => {
  await worker.evaluate(() => {
    const scope = globalThis as unknown as { __bookmarkReads: number };
    scope.__bookmarkReads = 0;
    const original = chrome.bookmarks.getTree.bind(chrome.bookmarks);
    chrome.bookmarks.getTree = (async () => { scope.__bookmarkReads++; return original(); }) as typeof chrome.bookmarks.getTree;
  });
  const timings: number[] = [];
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    await ui.reload();
    await expect(ui.locator('.result.command')).toHaveCount(9);
    timings.push(Math.round(performance.now() - start));
  }
  const reads = await worker.evaluate(() => (globalThis as unknown as { __bookmarkReads: number }).__bookmarkReads);
  console.log(JSON.stringify({ performance: 'reopen', readyMs: timings, bookmarkReads: reads }));
  expect(reads).toBeLessThanOrEqual(1);
  const bookmark = await worker.evaluate(url => chrome.bookmarks.create({ title: 'Performance saved bookmark', url }), `${origin}/perf-bookmark`);
  await ui.locator('.search-bar input').fill('Performance saved bookmark');
  await expect(ui.locator('.result.bookmark')).toHaveCount(1);
  await worker.evaluate(id => chrome.bookmarks.update(id, { title: 'Renamed performance bookmark' }), bookmark.id);
  await ui.locator('.search-bar input').fill('Renamed performance bookmark');
  await expect(ui.locator('.result.bookmark')).toHaveCount(1);
  await worker.evaluate(id => chrome.bookmarks.remove(id), bookmark.id);
  await expect(ui.locator('.result.bookmark')).toHaveCount(0);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English performance switching acknowledges before slow usage persistence completes', async () => {
  const target = await context.newPage(); await target.goto(`${origin}/Switch-speed-fixture`);
  await ui.bringToFront();
  await ui.locator('.search-bar input').fill('Switch speed fixture');
  await expect(ui.locator('.result.tab')).toHaveCount(1);
  await worker.evaluate(() => {
    const original = chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set = (async items => {
      if ('searchUsage' in items) await new Promise<void>(resolve => {
        (globalThis as unknown as { __releaseUsage: () => void }).__releaseUsage = resolve;
      });
      return original(items);
    }) as typeof chrome.storage.local.set;
  });
  const closing = ui.waitForEvent('close', { timeout: 3000 });
  const start = performance.now();
  await ui.locator('.search-bar input').press('Enter');
  await closing;
  const elapsed = Math.round(performance.now() - start);
  // Keep persistence blocked until after dismissal. This checks the dependency,
  // rather than asserting a fragile wall-clock threshold on a busy machine.
  await expect.poll(() => worker.evaluate(() => typeof (globalThis as unknown as { __releaseUsage?: () => void }).__releaseUsage)).toBe('function');
  expect(await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage)).toBeUndefined();
  console.log(JSON.stringify({ performance: 'switch', closeMs: elapsed, persistenceStillBlocked: true }));
  await worker.evaluate(() => (globalThis as unknown as { __releaseUsage: () => void }).__releaseUsage());
  await expect.poll(() => worker.evaluate(async () => ((await chrome.storage.local.get('searchUsage')).searchUsage as { query: string }[] | undefined)?.some(record => record.query === 'switch speed fixture'))).toBe(true);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English performance palette launch storage overlay opens and searches a large bookmark library', async () => {
  await worker.evaluate(async () => {
    const original = chrome.bookmarks.getTree.bind(chrome.bookmarks);
    chrome.bookmarks.getTree = (async () => [...await original(), ...Array.from({ length: 5000 }, (_, i) => ({
      id: `fixture-${i}`, title: `Reference ${i} developer documentation`, url: `https://docs.example.test/${i}`,
    }))]) as typeof chrome.bookmarks.getTree;
    await chrome.bookmarks.create({ title: 'Invalidate performance cache', url: 'https://example.test/' });
  });
  const page = await context.newPage(); await page.goto(`${origin}/Performance-launch`);
  const launch = () => worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  const surface = page.frameLocator('.justonehop-frame');
  const start = performance.now(); await launch();
  await expect(surface.locator('.result.command')).toHaveCount(9);
  const coldMs = Math.round(performance.now() - start);
  const input = surface.locator('.search-bar input');
  const searchMs: number[] = [];
  for (const query of ['ref', 'refer', 'reference', 'reference 42', 'new tab', 'iam']) {
    const start = performance.now(); await input.fill(query);
    if (query === 'iam') await expect(surface.locator('.result')).toHaveCount(0);
    else if (query === 'new tab') await expect(surface.locator('.result').first()).toHaveAttribute('id', 'justonehop-command:newTab');
    else await expect(surface.locator('.result.bookmark').first().locator('.entry-title mark').first()).toHaveText(query.split(' ')[0], { ignoreCase: true });
    searchMs.push(Math.round(performance.now() - start));
  }
  await page.keyboard.press('Escape'); await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
  const warm = performance.now(); await launch();
  await expect(surface.locator('.result.command')).toHaveCount(9);
  const warmMs = Math.round(performance.now() - warm);
  console.log(JSON.stringify({ performance: 'large-library', bookmarks: 5000, coldMs, warmMs, searchMs }));
  // Broad bounds catch a blocked UI; detailed timings remain observational.
  expect(coldMs).toBeLessThan(1000); expect(warmMs).toBeLessThan(500);
  expect(Math.max(...searchMs)).toBeLessThan(500);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English performance recent bridge reuses the prepared tabs instead of querying again', async () => {
  const code = await readFile(resolve('dist/switcher.js'), 'utf8');
  await context.route('**/switcher.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    globalThis.__switchQueries = 0;
    const originalQuery = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = async (...args) => {
      globalThis.__switchQueries++;
      await new Promise(resolve => setTimeout(resolve, 600));
      return originalQuery(...args);
    };
    ${code}` }));
  const f = await bridgeFixture();
  await f.a.keyboard.down('Control');
  const created = context.waitForEvent('page', page => page.url().includes('switcher.html'));
  const start = performance.now(); await f.open(); const popup = await created;
  await expect(popup.getByRole('option').first()).toBeVisible();
  const elapsed = Math.round(performance.now() - start);
  const queries = await popup.evaluate(() => (globalThis as unknown as { __switchQueries: number }).__switchQueries);
  console.log(JSON.stringify({ performance: 'recent-ready', readyMs: elapsed, duplicateQueries: queries, simulatedQueryMs: 600 }));
  expect(queries).toBe(0);
  await popup.keyboard.down('Control');
  await popup.keyboard.press('n'); await popup.keyboard.press('p');
  const selected = await popup.locator('[aria-selected=true]').getAttribute('id');
  await popup.keyboard.up('Control');
  await expect.poll(f.active).toBe(Number(selected!.replace('recent-', '')));
  await expect.poll(() => popup.isClosed()).toBe(true);
});
});

for (const scenario of ['fast', 'slow', 'failure and retry']) {
  test.describe(() => {
    test.use({ environment: { ...defaults, locale: 'en-US' } });
    test(`English delayed loading ${scenario}`, async () => {
    // Control time and the snapshot response separately: no wall-clock thresholds.
    await ui.clock.install();
    await ui.clock.pauseAt(new Date());
    await ui.addInitScript(() => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      const pending: (() => void)[] = [];
      const scope = globalThis as unknown as { __snapshot: { pending: (() => void)[]; fail: boolean } };
      scope.__snapshot = { pending, fail: false };
      chrome.runtime.sendMessage = (async (request: { type?: string }) => {
        if (request.type !== 'snapshot') return original(request);
        await new Promise<void>(resolve => pending.push(resolve));
        if (scope.__snapshot.fail) return { ok: false, error: 'Snapshot fixture failed' };
        return original(request);
      }) as typeof chrome.runtime.sendMessage;
    });
    await ui.reload();
    const input = ui.locator('.search-bar input');
    await expect(input).toBeFocused();
    await expect(ui.locator('.results .spinner')).toHaveCount(0);
    await expect(ui.locator('.result-status')).toHaveText('');
    const release = (fail = false) => ui.evaluate(fail => {
      const state = (globalThis as unknown as { __snapshot: { pending: (() => void)[]; fail: boolean } }).__snapshot;
      state.fail = fail;
      state.pending.splice(0).forEach(resolve => resolve());
    }, fail);
    if (scenario === 'fast') {
      await ui.clock.runFor(100);
      await release();
      await expect(ui.locator('.result.command')).toHaveCount(9);
      await ui.clock.runFor(200);
      await expect(ui.locator('.results .spinner')).toHaveCount(0);
    } else if (scenario === 'slow') {
      await input.fill('new tab');
      await ui.clock.runFor(149);
      await expect(ui.locator('.results .spinner')).toHaveCount(0);
      await ui.clock.runFor(1);
      await expect(ui.locator('.results .spinner')).toBeVisible();
      await expect(ui.locator('.result-status')).not.toHaveText('');
      await release();
      await expect(ui.locator('.result').first()).toHaveAttribute('id', 'justonehop-command:newTab');
      await expect(input).toHaveValue('new tab');
      await expect(input).toBeFocused();
      await expect(ui.locator('.results .spinner')).toHaveCount(0);
      // Refreshes keep the existing list, with no new loading indicator.
      await ui.evaluate(() => window.dispatchEvent(new Event('focus')));
      await ui.clock.runFor(200);
      await expect(ui.locator('.result').first()).toHaveAttribute('id', 'justonehop-command:newTab');
      await expect(ui.locator('.results .spinner')).toHaveCount(0);
      await release();
    } else {
      await ui.clock.runFor(50);
      await release(true);
      await expect(ui.getByRole('alert')).toContainText('Something went wrong. Please try again.');
      await ui.clock.runFor(200);
      await expect(ui.locator('.results .spinner')).toHaveCount(0);
      await expect(ui.locator('.result-status')).toHaveText('');
      await ui.locator('.error-banner button').click();
      await ui.clock.runFor(149);
      await expect(ui.locator('.results .spinner')).toHaveCount(0);
      await ui.clock.runFor(1);
      await expect(ui.locator('.results .spinner')).toBeVisible();
      await release();
      await expect(ui.locator('.result.command')).toHaveCount(9);
      await expect(ui.getByRole('alert')).toHaveCount(0);
      await expect(ui.locator('.results .spinner')).toHaveCount(0);
    }
  });
  });
}


test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English interaction polish settings choices accept Control navigation without accidental confirmation', async () => {
  const mainInput = ui.locator('.search-bar input');
  const clear = ui.locator('.search-dismiss');
  await mainInput.fill('query to clear');
  const bounds = await clear.boundingBox();
  await clear.hover();
  await expect(clear.locator('kbd')).toBeHidden();
  await expect(clear.locator('svg')).toBeVisible();
  await expect(clear).toHaveAccessibleName('Clear search');
  expect(await clear.boundingBox()).toEqual(bounds);
  await clear.click();
  await expect(mainInput).toHaveValue(''); await expect(mainInput).toBeFocused();
  await expect(clear.locator('kbd')).toBeVisible();
  await expect(clear.locator('svg')).toBeHidden();
  await mainInput.fill('keyboard clear');
  await mainInput.hover();
  await mainInput.press('Tab');
  await expect(clear).toBeFocused();
  await expect(clear.locator('svg')).toBeVisible();
  await clear.press('Space');
  await expect(mainInput).toHaveValue(''); await expect(mainInput).toBeFocused();
  await mainInput.fill('theme');
  await expect(ui.getByRole('option', { name: 'JustOneHop Settings: Theme', exact: true })).toHaveAttribute('aria-selected', 'true');
  await mainInput.press('Enter');
  const theme = ui.getByRole('combobox', { name: 'Theme', exact: true });
  await expect(theme).toBeFocused();
  await theme.press('Control+n'); await expect(theme).toHaveAttribute('aria-expanded', 'true');
  await theme.press('Control+n');
  await expect(ui.locator('.choice-option.highlighted')).toContainText('Light');
  await theme.press('Control+p');
  await expect(ui.locator('.choice-option.highlighted')).toContainText('Follow System');
  await theme.press('Shift+Enter'); await expect(theme).toHaveAttribute('aria-expanded', 'true');
  await theme.press('Enter'); await expect(theme).toHaveAttribute('aria-expanded', 'false');
  await expect(theme).toBeFocused();
  const currentTheme = await theme.innerText();
  await theme.click();
  await theme.press('Control+n');
  await ui.locator('.settings-page .palette-footer .footer-back').click();
  await expect(theme).toHaveAttribute('aria-expanded', 'false');
  await expect(theme).toBeFocused();
  await expect(theme).toHaveText(currentTheme);
  await expect(ui.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  await theme.click();
  const dismiss = ui.locator('.settings-search .search-dismiss');
  await expect(dismiss).toHaveText('esc');
  await expect(dismiss).toHaveAttribute('title', 'Escape — Back');
  await expect(dismiss.locator('kbd')).toBeVisible();
  await expect(dismiss.locator('svg')).toBeHidden();
  const dismissBounds = await dismiss.boundingBox();
  await dismiss.hover();
  await expect(dismiss.locator('kbd')).toBeVisible();
  await expect(dismiss.locator('svg')).toBeHidden();
  expect(await dismiss.boundingBox()).toEqual(dismissBounds);
  await theme.hover();
  await expect(dismiss.locator('kbd')).toBeVisible();
  await expect(dismiss.locator('svg')).toBeHidden();
  await dismiss.click();
  await expect(theme).toHaveAttribute('aria-expanded', 'false');
  await expect(theme).toBeFocused();
  await dismiss.click();
  await expect(ui.locator('.settings-page')).toHaveCount(0);
  await expect(ui.locator('.search-bar input')).toHaveValue('theme');
  await ui.keyboard.press('Meta+k');
  await expect(ui.locator('.action-search .search-dismiss')).toHaveText('esc');
  await ui.locator('.action-search input').press('Tab');
  await expect(ui.locator('.action-search .search-dismiss')).toBeFocused();
  await expect(ui.locator('.action-search .search-dismiss kbd')).toBeVisible();
  await expect(ui.locator('.action-search .search-dismiss svg')).toBeHidden();
  await ui.keyboard.press('Enter');
  await expect(ui.locator('.action-menu')).toHaveCount(0);
  await expect(ui.locator('.search-bar input')).toBeFocused();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test('English interaction polish storage shares menu footer highlighting and focus restoration', async () => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage(); await page.goto(`${origin}/Interaction-polish`);
  const raw = JSON.stringify({ lines: Array.from({ length: 120 }, (_, index) => `Value ${index}: 你好`) });
  await page.evaluate(value => {
    localStorage.setItem('polish.key', 'value');
    localStorage.setItem('polish.long', value);
    for (let index = 0; index < 24; index++) localStorage.setItem(`z.key.${String(index).padStart(2, '0')}`, `${index}`);
  }, raw);
  const surface = await openStorageOverlay(page);
  await surface.locator('.search-bar input').fill('local storage'); await page.keyboard.press('Enter');
  const search = surface.locator('.storage-search input');
  // A secondary list names its layer at the left of the footer and spends nothing on the ↑↓ hint.
  await expect(surface.locator('.palette-footer .navigation-hint')).toHaveCount(0);
  await expect(surface.locator('.palette-footer-title')).toHaveText('Local Storage');
  await expect(surface.locator('.storage-row')).toHaveCount(26);
  const locationTitle = await surface.locator('.palette-footer-title').boundingBox();
  const contextBox = await surface.locator('.palette-footer-context').boundingBox();
  await page.evaluate(() => navigator.clipboard.writeText('before selection'));
  await surface.locator('.storage-row').first().click();
  await expect(surface.locator('.storage-preview .preview-code')).toHaveValue('value');
  await expect(surface.locator('.operation-feedback')).toBeEmpty();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('before selection');
  await surface.locator('.palette-footer .primary-action').click();
  await expect(surface.locator('.operation-feedback')).toContainText('Value copied');
  await expect(surface.locator('.palette-footer-context')).toBeHidden();
  expect(await surface.locator('.palette-footer-title').boundingBox()).toEqual(locationTitle);
  expect((await surface.locator('.operation-feedback').boundingBox())!.x).toBe(contextBox!.x);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('value');
  await search.fill('polish');
  await search.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 3));
  await surface.locator('.storage-row').first().click({ button: 'right' });
  const actions = surface.getByRole('combobox', { name: 'Search actions' });
  await expect(actions).toBeFocused(); await actions.fill('copy');
  await expect(surface.locator('.action-row mark')).toHaveCount(2);
  await surface.locator('.palette-footer-title').click();
  await expect(surface.locator('.storage-view')).toBeFocused();
  for (const key of ['ArrowDown', 'Control+n', 'PageDown', 'Meta+ArrowDown']) await page.keyboard.press(key);
  await expect(surface.locator('.storage-row[aria-selected="true"]')).toHaveText('polish.key');
  await expect(surface.locator('.action-heading')).toHaveText('polish.key');
  await page.keyboard.press('Tab'); await expect(actions).toBeFocused();
  await surface.locator('.palette-footer-title').click();
  await page.keyboard.press('Shift+Tab'); await expect(surface.locator('.action-search .search-dismiss')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(surface.locator('.action-search .search-focus')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(actions).toBeFocused();
  await actions.press('Control+n');
  await expect(surface.locator('.palette-footer .primary-action')).toHaveText(/Copy Name/);
  await actions.press('Tab'); await expect(surface.locator('.action-search .search-dismiss')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(surface.locator('.action-search .search-focus')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(actions).toBeFocused();
  const primary = surface.locator('.palette-footer .primary-action');
  await primary.focus();
  for (const key of ['Shift+Enter', 'Control+Enter', 'Alt+Enter', 'Meta+Enter', 'Shift+Space']) {
    await primary.press(key);
    await expect(surface.locator('.action-menu')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('value');
  }
  const prevented = await primary.evaluate(node => [
    { key: 'Enter', repeat: true }, { key: 'Enter', isComposing: true }, { key: 'Enter', keyCode: 229 },
  ].map(init => !node.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }))));
  expect(prevented).toEqual([true, true, true]);
  await primary.press('Enter');
  await expect(surface.locator('.action-menu')).toHaveCount(0);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('polish.key');
  await expect(search).toBeFocused();
  expect(await search.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 3]);
  await search.fill('');
  const preview = surface.locator('.storage-preview');
  const value = preview.locator('.preview-code');
  const list = surface.locator('.storage-results');
  const longRow = surface.getByRole('option', { name: 'polish.long', exact: true });
  for (const size of [{ width: 1100, height: 760 }, { width: 390, height: 440 }]) {
    await page.setViewportSize(size);
    await longRow.click();
    await expect(value).toHaveValue(JSON.stringify(JSON.parse(raw), null, 2));
    await expect(value).toHaveAttribute('readonly', '');
    await expect(preview.locator('h1, .storage-value-label')).toHaveCount(0);
    await expect(preview.locator('.preview-info')).toContainText('Keypolish.long');
    await expect(preview.locator('.preview-info')).toContainText('Content TypeJSON');
    const valueBox = (await value.boundingBox())!;
    const infoBox = (await preview.locator('.preview-info').boundingBox())!;
    expect(valueBox.y + valueBox.height).toBeLessThan(infoBox.y);
    await surface.getByRole('option', { name: 'polish.key', exact: true }).hover();
    await expect(longRow).toHaveAttribute('aria-selected', 'true');
    const listBox = (await list.boundingBox())!;
    const previewBox = (await preview.boundingBox())!;
    if (size.width > 520) {
      expect(listBox.x + listBox.width).toBeLessThanOrEqual(previewBox.x);
      expect(listBox.y).toBe(previewBox.y);
    } else {
      expect(listBox.y + listBox.height).toBeLessThanOrEqual(previewBox.y);
      expect(listBox.width).toBe(previewBox.width);
    }
    await expect(list).toBeInViewport({ ratio: 1 });
    await expect(preview).toBeInViewport({ ratio: 1 });
    const footerBox = await surface.locator('.palette-footer').boundingBox();
    const searchBox = await surface.locator('.storage-search').boundingBox();
    await search.press('Control+p');
    await expect(preview.locator('.preview-code')).toHaveValue('value');
    await search.press('Control+n');
    await search.press('Enter');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(raw);
    await search.press('Tab'); await expect(surface.locator('.storage-search .search-dismiss')).toBeFocused();
    await page.keyboard.press('Tab'); await expect(value).toBeFocused();
    const listScroll = await list.evaluate(node => node.scrollTop);
    await value.press('PageDown');
    await expect.poll(() => value.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await expect(longRow).toHaveAttribute('aria-selected', 'true');
    expect(await list.evaluate(node => node.scrollTop)).toBe(listScroll);
    // Native PageDown scrolls over several frames; compare independent scrolling
    // only after the preview has stopped, rather than sampling its animation.
    let previewScroll = -1;
    let stableSamples = 0;
    await expect.poll(async () => {
      const current = await value.evaluate(node => node.scrollTop);
      stableSamples = current === previewScroll ? stableSamples + 1 : 0;
      previewScroll = current;
      return stableSamples;
    }, { intervals: [100], timeout: 3000 }).toBeGreaterThanOrEqual(3);
    await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
    expect(await list.evaluate(node => node.scrollTop)).toBeGreaterThan(listScroll);
    expect(await value.evaluate(node => node.scrollTop)).toBe(previewScroll);
    expect(await surface.locator('.palette-footer').boundingBox()).toEqual(footerBox);
    expect(await surface.locator('.storage-search').boundingBox()).toEqual(searchBox);
    await value.press('Tab'); await expect(surface.locator('.palette-footer .footer-back')).toBeFocused();
    await list.evaluate(node => { node.scrollTop = 0; });
    await value.evaluate(node => { node.scrollTop = 0; });
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await surface.locator('.palette').screenshot({ path: test.info().outputPath(`storage-preview-${theme}-${size.width}.png`) });
    }
    expect(await surface.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  await search.fill('missing-key');
  await expect(preview).toHaveCount(0);
  await expect(surface.locator('.palette-footer .primary-action')).toBeDisabled();
  await surface.locator('.palette-footer .footer-back').click();
  await expect(surface.locator('.search-bar input')).toHaveValue('local storage');
});
});


test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English recent bridge storage overlay shares palette geometry and focuses its capsule only after search activation', async () => {
  const f = await bridgeFixture();
  await worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  const surface = f.a.frameLocator('.justonehop-frame');
  await expect(surface.getByRole('combobox')).toBeFocused();
  const paletteBounds = await surface.locator('.palette').boundingBox();
  const paletteFooter = await surface.locator('.palette-footer').boundingBox();
  const navigationHint = await surface.locator('.navigation-hint').innerHTML();
  const searchGeometry = () => surface.locator('.search-bar').evaluate(node => {
    const input = node.querySelector('input')!;
    const icon = node.querySelector('.search-icon')!;
    const close = node.querySelector('.close-button')!;
    const rect = (element: Element) => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; };
    const pill = getComputedStyle(node, '::before');
    return { bar: rect(node), input: rect(input), icon: rect(icon), close: rect(close), border: pill.borderColor, radius: pill.borderRadius, background: pill.backgroundColor, font: getComputedStyle(input).fontSize };
  });
  await expect.poll(async () => (await searchGeometry()).border).toBe('rgb(11, 87, 208)');
  await expect.poll(async () => (await searchGeometry()).background).toBe('rgb(255, 255, 255)');
  const mainSearch = await searchGeometry();
  await f.a.keyboard.press('Escape');
  await f.a.keyboard.down('Control'); await f.open();
  await expect(f.a.locator('#justonehop-command-palette')).toBeAttached();
  await expect(surface.getByRole('listbox')).toBeFocused();
  await expect(surface.getByRole('combobox')).toBeDisabled();
  expect(await f.windows()).toBe(0);
  const switcherBounds = await surface.locator('.palette').boundingBox();
  expect(switcherBounds).toEqual(paletteBounds);
  expect(await surface.locator('.palette-footer').boundingBox()).toEqual(paletteFooter);
  expect(await surface.locator('.navigation-hint').innerHTML()).toBe(navigationHint);
  await expect.poll(async () => {
    const { bar, input, icon, close } = await searchGeometry();
    return { bar, input, icon, close };
  }).toEqual({ bar: mainSearch.bar, input: mainSearch.input, icon: mainSearch.icon, close: mainSearch.close });
  await expect.poll(async () => (await searchGeometry()).border).toBe('rgba(0, 0, 0, 0)');
  await expect(surface.getByRole('combobox')).toHaveValue('');
  await expect(surface.getByRole('combobox')).toHaveAttribute('placeholder', 'Search recent tabs…');
  await expect(surface.locator('.recent-help')).toHaveCount(0);
  await expect(surface.locator('.palette-footer-title')).toHaveText('Release Ctrl to switch');
  await expect(surface.locator('.primary-action')).toHaveText('Switch↵');
  await expect(surface.locator('.secondary-action')).toHaveText('Cancelesc');
  expect(await surface.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(surface.locator('.recent-overlay')).toHaveCSS('opacity', '1');
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('justonehop-switcher-shared-footer.png') });
  const initial = await surface.locator('[aria-selected=true]').getAttribute('id');
  await f.a.keyboard.press('n');
  expect(await surface.locator('[aria-selected=true]').getAttribute('id')).not.toBe(initial);
  await f.a.keyboard.press('p');
  expect(await surface.locator('[aria-selected=true]').getAttribute('id')).toBe(initial);
  expect(await f.active()).toBe(f.ids.source);
  await surface.locator('button.search-icon').click();
  await expect(surface.getByRole('combobox')).toBeEnabled();
  await expect(surface.getByRole('combobox')).toBeFocused();
  await expect.poll(searchGeometry).toEqual(mainSearch);
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('justonehop-switcher-activated.png') });
  await f.a.keyboard.up('Control');
  await expect(surface.getByRole('combobox')).toBeFocused();
  expect(await f.active()).toBe(f.ids.source);
  await surface.locator('.primary-action').click();
  await expect.poll(f.active).toBe(Number(initial!.replace('recent-', '')));
  await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English recent bridge storage overlay held search activation ignores release and confirms filtered results with Enter', async () => {
  const f = await bridgeFixture();
  const extra = await context.newPage(); await extra.goto(`${origin}/Bridge-C`);
  await f.a.bringToFront();
  await f.a.keyboard.down('Control'); await f.open();
  const surface = f.a.frameLocator('.justonehop-frame');
  const input = surface.getByRole('combobox');
  await expect(surface.getByRole('listbox')).toBeFocused(); await expect(input).toBeDisabled();
  await f.a.keyboard.press('f');
  await expect(input).toBeEnabled(); await expect(input).toBeFocused();
  await input.fill('Bridge');
  await expect(surface.getByRole('option')).toHaveCount(3);
  const selected = await input.getAttribute('aria-activedescendant');
  await f.a.keyboard.press('n');
  await expect(input).not.toHaveAttribute('aria-activedescendant', selected!);
  await f.a.keyboard.press('p');
  await expect(input).toHaveAttribute('aria-activedescendant', selected!);
  await expect(input).toHaveValue('Bridge');
  expect(await f.active()).toBe(f.ids.source);
  await input.fill('Bridge C');
  await expect(surface.getByRole('option')).toHaveCount(1);
  await expect(surface.locator('.entry-title mark')).toHaveText(['Bridge', 'C']);
  await expect(surface.locator('.recent-overlay')).toHaveCSS('opacity', '1');
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('justonehop-switcher-filtered.png') });
  const target = Number((await input.getAttribute('aria-activedescendant'))!.replace('recent-', ''));
  await f.a.keyboard.up('Control');
  await expect(input).toBeFocused(); await expect(input).toHaveValue('Bridge C');
  await expect(f.a.locator('#justonehop-command-palette')).toBeAttached();
  expect(await f.active()).toBe(f.ids.source);
  await f.a.keyboard.press('Enter');
  await expect.poll(f.active).toBe(target);
  await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
});
});

for (const method of ['wrapper', 'icon', 'keyboard'] as const) test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test(`English recent bridge storage overlay search accepts typing after ${method} and release`, async () => {
  const f = await bridgeFixture();
  await f.a.keyboard.down('Control'); await f.open();
  const surface = f.a.frameLocator('.justonehop-frame');
  const input = surface.getByRole('combobox');
  await expect(surface.getByRole('listbox')).toBeFocused(); await expect(input).toBeDisabled();
  if (method === 'wrapper') await surface.locator('.recent-search-field').click();
  else if (method === 'icon') await surface.locator('button.search-icon.recent-search-activate').click();
  else await f.a.keyboard.press('f');
  await expect(input).toBeEnabled();
  await expect(surface.locator('.palette-footer-title')).toHaveText('Tab Switcher');
  await f.a.keyboard.up('Control');
  await expect(input).toBeFocused(); expect(await f.active()).toBe(f.ids.source);
  const list = surface.getByRole('listbox');
  await list.click({ position: { x: 10, y: 240 } });
  await expect(list).toBeFocused();
  if (method === 'wrapper') await surface.locator('.recent-search-field').click();
  else if (method === 'icon') await surface.locator('button.search-icon.recent-search-activate').click();
  else await f.a.keyboard.press('Control+f');
  await expect(input).toBeFocused();
  await input.pressSequentially('Bridge-B');
  await expect(surface.getByRole('option')).toHaveCount(1);
  await surface.locator('.palette').screenshot({ path: test.info().outputPath(`justonehop-switcher-search-${method}.png`) });
  await f.a.keyboard.press('Enter');
  await expect.poll(f.active).toBe(f.ids.previous);
  await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English recent bridge storage overlay search with no matches stays open until a visible choice', async () => {
  const f = await bridgeFixture();
  await f.a.keyboard.down('Control'); await f.open();
  const surface = f.a.frameLocator('.justonehop-frame');
  const input = surface.getByRole('combobox');
  await expect(surface.getByRole('listbox')).toBeFocused(); await expect(input).toBeDisabled();
  await surface.locator('button.search-icon').click();
  await expect(input).toBeEnabled(); await expect(input).toBeFocused();
  await input.fill('no-such-tab');
  await expect(surface.getByRole('option')).toHaveCount(0);
  await expect(input).not.toHaveAttribute('aria-activedescendant');
  await expect(surface.locator('.primary-action')).toBeDisabled();
  await f.a.keyboard.press('Enter');
  await f.a.keyboard.up('Control');
  expect(await f.active()).toBe(f.ids.source);
  await expect(input).toBeFocused();
  await input.fill(`${origin}/Bridge-B`);
  await expect(surface.getByRole('option')).toHaveCount(1);
  await f.a.keyboard.press('Shift+Enter');
  await expect(input).toBeFocused(); expect(await f.active()).toBe(f.ids.source);
  await input.press('ArrowDown');
  await surface.getByRole('option').click();
  await expect.poll(f.active).toBe(f.ids.previous);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English recent bridge storage overlay quick taps alternate without creating a window', async () => {
  const f = await bridgeFixture();
  for (let attempt = 0; attempt < 6; attempt++) {
    const page = attempt % 2 ? f.b : f.a;
    await page.keyboard.down('Control'); await page.keyboard.up('Control'); await f.open();
    await expect.poll(f.active).toBe(attempt % 2 ? f.ids.source : f.ids.previous);
    expect(await f.windows()).toBe(0);
    await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
  }
});
});

async function delayRecentOverlay() {
  await worker.evaluate(() => {
    const state = globalThis as unknown as { __resumeOverlay?: () => void; __overlayPending?: boolean };
    const original = chrome.tabs.sendMessage.bind(chrome.tabs);
    chrome.tabs.sendMessage = (async (id: number, message: any, options: any) => {
      if (message?.type === 'open-overlay') {
        state.__overlayPending = true;
        await new Promise<void>(resolve => { state.__resumeOverlay = resolve; });
      }
      return original(id, message, options);
    }) as typeof chrome.tabs.sendMessage;
  });
}
async function resumeRecentOverlay() {
  await worker.evaluate(() => (globalThis as unknown as { __resumeOverlay: () => void }).__resumeOverlay());
}

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English recent bridge storage overlay buffers release and repeated shortcuts while opening', async () => {
  const f = await bridgeFixture();
  await delayRecentOverlay();
  await f.a.keyboard.down('Control');
  const opening = f.open();
  await expect.poll(() => worker.evaluate(() => !!(globalThis as unknown as { __overlayPending: boolean }).__overlayPending)).toBe(true);
  await f.open(); await f.open();
  const order = await worker.evaluate(async id => (await chrome.tabs.query({ windowId: id }))
    .sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0) || a.index - b.index).map(tab => tab.id), f.ids.window);
  await f.a.keyboard.up('Control');
  await resumeRecentOverlay(); await opening;
  await expect.poll(f.active).toBe(order[3 % order.length]);
  await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
  expect(await f.windows()).toBe(0);
});
});

for (const reason of ['Escape', 'outside click', 'another window', 'another tab', 'opening interrupted']) {
  test.describe(() => {
    test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
    test(`English recent bridge storage overlay cancels on ${reason} without accepting a tab`, async () => {
    const f = await bridgeFixture();
    await f.a.getByRole('textbox').fill('keep my text'); await f.a.getByRole('textbox').focus();
    if (reason === 'opening interrupted') await delayRecentOverlay();
    await f.a.keyboard.down('Control');
    const opening = f.open();
    if (reason === 'opening interrupted') {
      await expect.poll(() => worker.evaluate(() => !!(globalThis as unknown as { __overlayPending: boolean }).__overlayPending)).toBe(true);
      const other = await worker.evaluate(() => chrome.windows.create({ url: 'about:blank', focused: true }));
      await resumeRecentOverlay(); await opening;
      expect(await worker.evaluate(async () => (await chrome.windows.getLastFocused()).id)).toBe(other!.id);
    } else {
      await opening;
      const surface = f.a.frameLocator('.justonehop-frame');
      await expect(surface.getByRole('listbox')).toBeFocused();
      if (reason === 'Escape') await f.a.keyboard.press('Escape');
      if (reason === 'outside click') await surface.locator('.recent-overlay').click({ position: { x: 5, y: 5 } });
      if (reason === 'another window') await worker.evaluate(() => chrome.windows.create({ url: 'about:blank', focused: true }));
      if (reason === 'another tab') await worker.evaluate(id => chrome.tabs.update(id, { active: true }), f.ids.previous);
    }
    await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
    expect(await f.active()).toBe(reason === 'another tab' ? f.ids.previous : f.ids.source);
    expect(await f.windows()).toBe(0);
    await expect(f.a.getByRole('textbox')).toHaveValue('keep my text');
    if (reason === 'Escape' || reason === 'outside click') {
      await expect(f.a.getByRole('textbox')).toBeFocused();
      await f.a.keyboard.up('Control');
      expect(await f.active()).toBe(f.ids.source);
    }
  });
  });
}

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English recent bridge storage overlay keeps source selected when a candidate closes', async () => {
  const f = await bridgeFixture();
  await f.a.keyboard.down('Control'); await f.open();
  const surface = f.a.frameLocator('.justonehop-frame');
  await expect(surface.getByRole('listbox')).toBeFocused();
  await worker.evaluate(id => chrome.tabs.remove(id), f.ids.previous);
  await expect(surface.locator('[aria-selected=true]')).toHaveAttribute('id', `recent-${f.ids.source}`);
  await f.a.keyboard.up('Control');
  await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
  expect(await f.active()).toBe(f.ids.source);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English recent bridge storage overlay rejects unfocused pages and retains window fallback', async () => {
  const f = await bridgeFixture();
  await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false });
  } }), f.ids.source);
  const created = context.waitForEvent('page', page => page.url().includes('switcher.html'));
  await f.open(); const popup = await created;
  await expect(popup.getByRole('listbox')).toBeFocused();
  await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
  expect(await f.active()).toBe(f.ids.source);
  await popup.keyboard.press('Escape').catch(error => { if (!popup.isClosed()) throw error; });
  await expect.poll(() => popup.isClosed()).toBe(true);
});
});

for (const language of ['English', 'Chinese']) test.describe(() => {
  test.use({ environment: { ...defaults, locale: language === 'English' ? 'en-US' : 'zh-CN', pageAccess: true, shadow: 'open', commands: true } });
  test(`${language} recent bridge storage overlay mouse selection and narrow geometry match palette`, async () => {
  const f = await bridgeFixture(); await f.a.setViewportSize({ width: 390, height: 440 });
  await f.open();
  const surface = f.a.frameLocator('.justonehop-frame');
  await expect(surface.getByRole('listbox')).toBeFocused();
  await expect(surface.getByRole('combobox')).toBeDisabled();
  const before = await surface.locator('.palette').boundingBox();
  expect(before!.x).toBe(10); expect(before!.y).toBe(24);
  expect(before!.x + before!.width).toBeLessThanOrEqual(380);
  expect(before!.y + before!.height).toBeLessThanOrEqual(416);
  const footer = await surface.locator('.palette-footer').boundingBox();
  expect(footer!.height).toBe(44);
  expect(footer!.y + footer!.height).toBe(before!.y + before!.height - 1);
  await expect(surface.locator('.palette-footer-context')).toBeHidden();
  await expect(surface.locator('.palette-footer-title')).toHaveText(language === 'Chinese' ? '松开 Ctrl 切换' : 'Release Ctrl to switch');
  await expect(surface.getByRole('combobox')).toHaveAttribute('placeholder', language === 'Chinese' ? '搜索最近标签页…' : 'Search recent tabs…');
  expect((await surface.locator('.search-bar').boundingBox())!.height).toBe(56);
  await surface.locator('button.search-icon').click();
  await expect(surface.getByRole('combobox')).toBeEnabled();
  await expect(surface.getByRole('combobox')).toBeFocused();
  await surface.getByRole('combobox').fill('Bridge');
  await expect(surface.getByRole('option')).toHaveCount(2);
  await expect(surface.locator('.primary-action')).toBeInViewport({ ratio: 1 });
  await expect(surface.locator('.secondary-action')).toBeInViewport({ ratio: 1 });
  expect(await surface.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect.poll(() => surface.locator('.recent-overlay').evaluate(node => getComputedStyle(node).opacity)).toBe('1');
  await surface.locator('.palette').screenshot({ path: test.info().outputPath(`justonehop-switcher-shared-footer-narrow-${language}.png`) });
  await surface.getByRole('option').filter({ hasText: 'Bridge B' }).click();
  await expect.poll(f.active).toBe(f.ids.previous);
  await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English recent bridge storage overlay closes safely when its worker stops', async () => {
  const f = await bridgeFixture(); await f.a.keyboard.down('Control'); await f.open();
  await expect(f.a.frameLocator('.justonehop-frame').getByRole('listbox')).toBeFocused();
  const monitor = await context.newCDPSession(f.a);
  await monitor.send('ServiceWorker.enable'); await monitor.send('ServiceWorker.stopAllWorkers');
  await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
});
});

for (const action of ['header cancel', 'footer cancel', 'search', 'switch'] as const) test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, commands: true } });
  test(`English recent bridge closed storage overlay Enter belongs to focused ${action} button`, async () => {
  const f = await bridgeFixture(); await f.a.keyboard.down('Control'); await f.open();
  await expect(f.a.locator('#justonehop-command-palette')).toBeAttached();
  const cdp = await context.newCDPSession(f.a);
  const name = action.includes('cancel') ? 'Cancel' : action === 'search' ? 'Search recent tabs…' : 'Switch';
  const frameId = await focusClosedButton(cdp, name, action === 'footer cancel' ? 1 : 0, action.includes('cancel') ? 2 : 1);
  await pressNativeEnter(cdp, f.a);
  if (action === 'search') {
    await f.a.keyboard.up('Control');
    const focusedInput = async () => (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes.some(node =>
      node.role?.value === 'combobox' && node.properties?.some(property => property.name === 'focused' && property.value?.value === true));
    await expect.poll(focusedInput).toBe(true);
    expect(await f.active()).toBe(f.ids.source);
    await f.a.keyboard.press('Escape');
  }
  await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
  expect(await f.active()).toBe(action === 'switch' ? f.ids.previous : f.ids.source);
});
});

for (const vimium of [false, true]) test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, commands: true, vimium } });
  test(`English recent bridge closed storage overlay preserves ${vimium ? 'Vimium' : 'production'} navigation and release`, async () => {
  const f = await bridgeFixture(); await f.a.keyboard.down('Control'); await f.open();
  await expect(f.a.locator('#justonehop-command-palette')).toBeAttached();
  const cdp = await context.newCDPSession(f.a);
  const selectedName = async () => {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
    const { nodes } = await cdp.send('Accessibility.getFullAXTree', { frameId });
    return nodes.find(node => node.role?.value === 'option' && node.properties?.some(property => property.name === 'selected' && property.value?.value === true))?.name?.value;
  };
  await expect.poll(selectedName).toContain('Bridge B');
  await f.a.keyboard.press('n');
  await expect.poll(selectedName).not.toContain('Bridge B');
  await f.a.keyboard.press('p');
  await expect.poll(selectedName).toContain('Bridge B');
  expect(await f.active()).toBe(f.ids.source);
  await f.a.keyboard.up('Control');
  await expect.poll(f.active).toBe(f.ids.previous);
  await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
  expect(await f.windows()).toBe(0);
});
});

for (const acceptDelay of [0, 250]) test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test(`English recent bridge storage overlay quick release never paints the scrim or panel (${acceptDelay}ms accept)`, async () => {
  const f = await bridgeFixture();
  if (acceptDelay) await worker.evaluate(delay => {
    const update = chrome.tabs.update.bind(chrome.tabs);
    chrome.tabs.update = (async (...args: any[]) => {
      await new Promise(resolve => setTimeout(resolve, delay));
      return (update as any)(...args);
    }) as typeof chrome.tabs.update;
  }, acceptDelay);
  await f.a.evaluate(() => {
    const samples: number[] = [];
    (window as any).__switcherPaint = samples;
    const sample = () => {
      const dialog = document.querySelector('#justonehop-command-palette')?.shadowRoot?.querySelector('dialog');
      if (dialog) {
        const surface = dialog.querySelector('iframe')?.contentDocument?.body.shadowRoot?.querySelector('.recent-overlay');
        if (surface) {
          const backdrop = getComputedStyle(dialog, '::backdrop');
          const scrimVisible = backdrop.backgroundColor !== 'rgba(0, 0, 0, 0)' && Number(backdrop.opacity) > 0;
          samples.push(scrimVisible ? 1 : Number(getComputedStyle(surface).opacity));
        }
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await f.a.keyboard.down('Control'); await f.open();
  // Release after one painted frame, rather than before the background starts.
  await f.a.waitForFunction(() => (window as any).__switcherPaint.length > 0, undefined, { polling: 'raf' });
  await f.a.keyboard.up('Control');
  await expect.poll(f.active).toBe(f.ids.previous);
  const samples = await f.a.evaluate(() => (window as any).__switcherPaint as number[]);
  expect(samples.length).toBeGreaterThan(0);
  expect(samples.every(opacity => opacity === 0)).toBe(true);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English recent bridge storage overlay held shortcut reveals and navigates normally', async () => {
  const f = await bridgeFixture();
  await f.a.keyboard.down('Control'); await f.open();
  const surface = f.a.frameLocator('.justonehop-frame');
  await expect(surface.locator('.recent-overlay')).toHaveCSS('opacity', '1');
  const list = surface.getByRole('listbox');
  const input = surface.getByRole('combobox');
  await expect(list).toBeFocused(); await expect(input).toBeDisabled();
  await expect(input).not.toBeFocused(); await expect(input).not.toHaveAttribute('aria-activedescendant');
  const selected = await list.getAttribute('aria-activedescendant');
  await f.a.keyboard.press('n');
  await expect(list).not.toHaveAttribute('aria-activedescendant', selected!);
  await f.a.keyboard.press('p');
  await expect(list).toHaveAttribute('aria-activedescendant', selected!);
  await expect(list).toBeFocused(); await expect(input).toBeDisabled();
  await expect(input).toHaveValue(''); await expect(input).toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)');
  await expect.poll(() => surface.locator('.search-bar').evaluate(node => {
    const style = getComputedStyle(node, '::before');
    return { border: style.borderColor, shadow: style.boxShadow };
  })).toEqual({ border: 'rgba(0, 0, 0, 0)', shadow: 'none' });
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('justonehop-switcher-disabled.png') });
  await f.a.keyboard.up('Control');
  await expect.poll(f.active).toBe(f.ids.previous);
  await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
  await f.a.bringToFront();
  await f.a.keyboard.down('Control'); await f.open();
  await expect(surface.locator('.current-badge')).toHaveText('Current');
  await expect(surface.locator('.search-dismiss')).toHaveAttribute('title', 'Escape — Cancel');
  await surface.getByRole('button', { name: 'Search recent tabs…' }).click();
  await expect(surface.getByRole('combobox')).toBeEnabled();
  await f.a.keyboard.up('Control');
  await expect(f.a.locator('#justonehop-command-palette')).toBeAttached();
  expect(await f.active()).toBe(f.ids.source);
  await surface.locator('.search-dismiss').click();
  await expect(f.a.locator('#justonehop-command-palette')).not.toBeAttached();
  expect(await f.active()).toBe(f.ids.source);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English human first recent switcher exposes clickable confirm and respects focused cancel', async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Mouse-A`);
  const b = await context.newPage(); await b.goto(`${origin}/Mouse-B`);
  let popup = await recentPopup(a);
  const selected = Number((await popup.selected()).replace('recent-', ''));
  await popup.page.getByRole('button', { name: 'Switch', exact: true }).click();
  await expect.poll(popup.closed).toBe(true); expect(await popup.active()).toBe(selected);
  popup = await recentPopup(a);
  await expect(popup.page.locator('.current-badge')).toHaveText('Current');
  const cancel = popup.page.locator('.search-dismiss');
  await expect(cancel).toHaveAttribute('title', 'Escape — Cancel');
  await cancel.press('Enter').catch(error => { if (!popup.page.isClosed()) throw error; });
  await expect.poll(popup.closed).toBe(true); expect(await popup.active()).toBe(popup.target.id);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English human first recent switcher mouse hover preserves release selection and row click switches', async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Mouse-A`);
  const b = await context.newPage(); await b.goto(`${origin}/Mouse-B`);
  const c = await context.newPage(); await c.goto(`${origin}/Mouse-C`);
  const popup = await recentPopup(a);
  const initial = await popup.selected();
  const row = popup.page.getByRole('option').filter({ hasText: 'Mouse B' });
  await row.hover();
  expect(await popup.selected()).toBe(initial);
  await popup.key('keyDown', 'n', 'KeyN', 78, 2);
  expect(await popup.selected()).not.toBe(initial);
  const target = Number((await row.getAttribute('id'))!.replace('recent-', ''));
  await row.click();
  await expect.poll(popup.closed).toBe(true); expect(await popup.active()).toBe(target);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English pinned hostname result outranks bookmark prefixes and switches without opening a duplicate', async () => {
  const target = await context.newPage(); await target.goto(`${origin}/Service-Console`);
  const targetId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, target.url());
  await worker.evaluate(async ({ id, base }) => {
    await chrome.tabs.update(id, { pinned: true });
    for (const name of ['api', 'dev', 'prod']) await chrome.bookmarks.create({ title: `127 ${name}`, url: `${base}/${name}` });
  }, { id: targetId, base: origin });
  await ui.bringToFront(); await ui.reload();
  const input = ui.getByRole('combobox');
  await input.fill('127');
  await expect(ui.getByRole('option').first()).toContainText('Service Console');
  await input.fill('127 api');
  await expect(ui.getByRole('option').first()).toContainText('127 api');
  await input.fill('127');
  await expect(ui.getByRole('option').first()).toContainText('Service Console');
  await input.press('Enter');
  await expect.poll(() => ui.isClosed()).toBe(true);
  await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).active, targetId)).toBe(true);
  expect(await worker.evaluate(async url => (await chrome.tabs.query({})).filter(tab => tab.url === url).length, target.url())).toBe(1);
});
});

for (const method of ['mouse', 'keyboard'] as const) {
  test.describe(() => {
    test.use({ environment: { ...defaults, locale: 'en-US', commands: true, pageAccess: true, shadow: method === 'mouse' ? 'open' : 'closed' } });
    test(`English reload justonehop extension via ${method} preserves pages and reopens the palette`, async () => {
      const page = await context.newPage();
      await page.goto('chrome://extensions');
      const developerMode = page.getByRole('button', { name: 'Developer mode', exact: true });
      if (await developerMode.getAttribute('aria-pressed') !== 'true') await developerMode.click();
      await page.goto(`${origin}/Reload-extension-fixture`);
      await page.getByRole('textbox', { name: 'Page input' }).fill('keep this text');
      await worker.evaluate(() => chrome.storage.local.set({ reloadFixture: 'kept' }));
      const launch = async () => {
        await page.bringToFront();
        await worker.evaluate(async () => {
          const scope = globalThis as typeof globalThis & { __recentCommands: ((command: string) => Promise<void>)[] };
          for (const callback of scope.__recentCommands) await callback('toggle-palette');
        });
        await expect(page.locator('#justonehop-command-palette')).toBeAttached();
      };
      await launch();
      await page.keyboard.type(method === 'mouse' ? 'JustOneHop: Reload' : 'JustOneHop：重新加载');
      const nextWorker = context.waitForEvent('serviceworker', candidate => candidate.url() === worker.url());
      const oldWorker = worker;
      const stopped = oldWorker.waitForEvent('close');
      if (method === 'mouse') {
        const frame = page.frameLocator('.justonehop-frame');
        await expect(frame.getByRole('option').first().locator('.entry-title')).toHaveText('JustOneHop: Reload');
        await frame.getByRole('option').first().click();
      } else {
        await page.keyboard.press('Shift+Enter');
        await expect(page.locator('#justonehop-command-palette')).toBeAttached();
        await page.keyboard.press('Enter');
      }
      await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
      await stopped;
      worker = await nextWorker;
      await expect(page.getByRole('textbox', { name: 'Page input' })).toHaveValue('keep this text');
      await expect(page.getByRole('textbox', { name: 'Page input' })).toBeFocused();
      expect(await worker.evaluate(async () => (await chrome.storage.local.get('reloadFixture')).reloadFixture)).toBe('kept');
      await expect.poll(() => ui.isClosed()).toBe(true);
      await launch();
      await page.keyboard.type('settings');
      await page.keyboard.press('Enter');
      if (method === 'mouse') await expect(page.frameLocator('.justonehop-frame').getByRole('textbox', { name: 'Search settings' })).toBeFocused();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
    });
  });
}

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true } });
  test('English palette launch worker lifecycle repeatedly wakes and reloads without script load errors', async () => {
  test.setTimeout(90_000);
  const monitor = await context.newPage(); await monitor.goto('chrome://extensions');
  await monitor.getByRole('button', { name: 'Developer mode', exact: true }).click();
  await monitor.goto(origin);
  const client = await context.newCDPSession(monitor);
  const errors: unknown[] = [];
  client.on('ServiceWorker.workerErrorReported', event => errors.push(event.errorMessage));
  await client.send('ServiceWorker.enable');
  for (let round = 0; round < 100; round++) {
    await client.send('ServiceWorker.stopAllWorkers');
    const reply = await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'snapshot' }));
    expect(reply.ok, `wake ${round}: ${JSON.stringify(errors)}`).toBe(true);
    if (round % 5 === 4) {
      await ui.evaluate(() => chrome.runtime.reload()).catch(() => {});
      ui = await context.newPage();
      await expect.poll(async () => {
        try { await ui.goto(popupUrl); return await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'snapshot' })).then(reply => reply.ok); }
        catch { return false; }
      }, { message: JSON.stringify(errors) }).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English palette preserves query and settings while hidden but closes on a source tab switch', async () => {
    const page = await context.newPage(); await page.goto(`${origin}/App-switch-retention`); await page.bringToFront();
    const id = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, page.url());
    await worker.evaluate(async () => {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    });
    const surface = page.frameLocator('.justonehop-frame');
    const search = surface.getByRole('combobox');
    await expect(search).toBeFocused();
    await page.keyboard.type('settings');
    await expect(surface.getByRole('option').first().locator('.entry-title')).toHaveText('JustOneHop Settings');
    await expect(search).toHaveAttribute('aria-activedescendant', 'justonehop-command:settings');
    await page.keyboard.press('Enter');
    const settings = surface.getByRole('textbox', { name: 'Search settings' });
    await settings.fill('theme');
    // Inject the OS visibility signal in the content-script world; this proves
    // retention on occlusion, not a physical macOS application-switch gesture.
    await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    } }), id);
    await expect(settings).toHaveValue('theme');
    await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
      Reflect.deleteProperty(document, 'hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    } }), id);
    await surface.locator('.footer-back').click();
    await expect(search).toHaveValue('settings');
    await expect(search).toBeFocused();
    await worker.evaluate(async () => { await chrome.tabs.create({ url: 'about:blank', active: true }); });
    await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
    await page.bringToFront();
    await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
  });
  test('English palette keeps an unfocused overlay and offers click recovery', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Focus-boundary`);
  const id = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, page.url());
  await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }), id);
  // Headless Chrome emulates tab focus, so inject the observed native failure
  // at the isolated-world boundary. Native omnibox acceptance is separate.
  await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false });
  } }), id);
  await worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  const surface = page.frameLocator('.justonehop-frame');
  await expect(page.locator('#justonehop-command-palette')).toBeAttached();
  await expect(surface.locator('.search-focus-hint')).toHaveText('Click the search field to type');
  expect(context.pages().some(candidate => candidate.url().includes('popup.html#window='))).toBe(false);
  expect(await worker.evaluate(tabId => chrome.action.getPopup({ tabId }), id)).toBe('');
  const search = surface.getByRole('combobox');
  await search.evaluate(node => { node.ownerDocument.body.tabIndex = -1; node.ownerDocument.body.focus(); });
  await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
    Reflect.deleteProperty(document, 'hasFocus');
  } }), id);
  await surface.getByRole('button', { name: 'Focus search', exact: true }).click();
  await expect(search).toBeFocused();
  await expect(surface.locator('.search-focus-hint')).toHaveCount(0);
  await page.keyboard.type('settings');
  await expect(search).toHaveValue('settings');
  await page.keyboard.press('Escape');
  await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true, headed: true, pageAccess: true } });
  test('English palette restricted fallback opens a source-bound window without toolbar popup', async () => {
    const page = await context.newPage();
    await page.goto('data:text/html,<title>Restricted source</title>');
    await page.bringToFront();
    const source = await worker.evaluate(async url => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
      await chrome.windows.update(tab.windowId, { focused: true });
      return { id: tab.id!, windowId: tab.windowId };
    }, page.url());
    await worker.evaluate(async () => {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    });
    await expect.poll(() => context.pages().some(page => page.url().includes('popup.html#window='))).toBe(true);
    const palette = context.pages().find(page => page.url().includes('popup.html#window='))!;
    const search = palette.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await expect(search).toBeFocused();
    expect(await worker.evaluate(tabId => chrome.action.getPopup({ tabId }), source.id)).toBe('');
    const bound = await palette.evaluate(async () => {
      const reply = await chrome.runtime.sendMessage({ source: 'justonehop', type: 'snapshot' });
      return { source: reply.data.currentTabId, window: reply.data.windowId, host: (await chrome.tabs.getCurrent())!.windowId };
    });
    expect(bound).toMatchObject({ source: source.id, window: source.windowId });
    expect(bound.host).not.toBe(source.windowId);
    await palette.locator('.settings-button').click();
    await expect(palette.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
    await palette.keyboard.press('Escape');
    await expect(search).toBeFocused();
    await search.fill('pin');
    await expect(palette.locator('[id="justonehop-command:pin"]')).toHaveAttribute('aria-selected', 'true');
    await expect(palette.locator('.palette-footer .primary-action')).toBeEnabled();
    await search.press('Enter');
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).pinned, source.id)).toBe(true);
    await expect(search).toHaveValue('pin');
    await palette.keyboard.press('Escape').catch(error => { if (!palette.isClosed()) throw error; });
    await expect.poll(() => palette.isClosed()).toBe(true);
    expect(await worker.evaluate(tabId => chrome.action.getPopup({ tabId }), source.id)).toBe('');
  });
});

test('brand logo follows panel themes and the offscreen system theme updates toolbar icons', async () => {
  await expect(ui.locator('.search-bar .brand-logo svg')).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await ui.evaluate(theme => chrome.storage.local.set({ preferences: { language: 'en', theme } }), theme);
    await expect(ui.locator('.justonehop-app')).toHaveAttribute('data-theme', theme);
    await expect(ui.locator('.search-bar .brand-logo rect').nth(1)).toHaveCSS('fill', theme === 'dark' ? 'rgb(138, 180, 248)' : 'rgb(11, 87, 208)');
    await ui.locator('.palette').screenshot({ path: test.info().outputPath(`brand-${theme}.png`) });
  }
  await ui.setViewportSize({ width: 390, height: 700 });
  await ui.evaluate(() => { document.body.style.width = '100%'; });
  await ui.locator('.search-bar input').fill('tab switcher');
  await ui.keyboard.press('Enter');
  await expect(ui.locator('.recent-search-activate .brand-logo svg')).toBeVisible();
  await ui.locator('.recent-search-activate').click();
  await expect(ui.locator('.recent-search-field input')).toBeFocused();
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('brand-switcher-narrow.png') });

  await expect.poll(() => worker.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] })).length)).toBe(1);
  await worker.evaluate(() => {
    const state = globalThis as unknown as { __iconPaths: unknown[] };
    state.__iconPaths = [];
    const setIcon = chrome.action.setIcon.bind(chrome.action);
    chrome.action.setIcon = (async details => { await setIcon(details); state.__iconPaths.push(details.path); }) as typeof chrome.action.setIcon;
  });
  const cdp = await context.newCDPSession(ui);
  const targets = await cdp.send('Target.getTargets');
  const target = targets.targetInfos.find(target => target.url === popupUrl.replace('popup.html', 'theme.html'))!;
  expect(target).toBeTruthy();
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId });
  let id = 0;
  const command = (method: string, params: object) => new Promise<{ result?: { value?: unknown } }>((resolve, reject) => {
    const requestId = ++id;
    const listener = (event: { sessionId: string; message: string }) => {
      const reply = JSON.parse(event.message);
      if (event.sessionId !== sessionId || reply.id !== requestId) return;
      cdp.off('Target.receivedMessageFromTarget', listener);
      if (reply.error) reject(new Error(JSON.stringify(reply.error))); else resolve(reply.result);
    };
    cdp.on('Target.receivedMessageFromTarget', listener);
    void cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: requestId, method, params }) }).catch(reject);
  });
  try {
    for (const theme of ['light', 'dark', 'light']) {
      await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      // Offscreen documents have no compositor frames; flush the emulated style change.
      const media = await command('Runtime.evaluate', { expression: `(document.body.offsetWidth, matchMedia('(prefers-color-scheme: dark)').matches)`, returnByValue: true });
      expect(media.result?.value).toBe(theme === 'dark');
      // Exercise the real alarm callback without waiting the full 30-second period.
      await worker.evaluate(() => chrome.alarms.create('justonehop-toolbar-theme', { when: Date.now() + 100 }));
      await expect.poll(() => worker.evaluate(() => (globalThis as unknown as { __iconPaths: unknown[] }).__iconPaths.at(-1))).toEqual({
        16: `icon16${theme === 'dark' ? '-dark' : ''}.png`, 32: `icon32${theme === 'dark' ? '-dark' : ''}.png`,
        48: `toolbar48${theme === 'dark' ? '-dark' : ''}.png`, 128: `toolbar128${theme === 'dark' ? '-dark' : ''}.png`,
      });
    }
  } finally { await cdp.detach(); }
});

for (const host of ['overlay', 'native'] as const) test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true, headed: true, pageAccess: true, shadow: 'open' } });
  test(`English manual search focus recovers from body and controls in ${host}`, async () => {
    const source = await context.newPage();
    await source.goto(host === 'overlay' ? `${origin}/Manual-focus-source` : 'chrome://version/');
    await source.bringToFront();
    await worker.evaluate(async () => {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    });
    if (host === 'native') await expect.poll(() => context.pages().some(page => page.url().includes('popup.html#window='))).toBe(true);
    const page = host === 'native' ? context.pages().find(page => page.url().includes('popup.html#window='))! : source;
    const surface = host === 'native' ? page : page.frameLocator('.justonehop-frame');
    const input = surface.locator('.search-bar input');
    await expect(input).toBeFocused();
    await input.fill('new tab');
    await expect(surface.locator('[id="justonehop-command:newTab"]')).toHaveAttribute('aria-selected', 'true');
    await input.evaluate((node: HTMLInputElement) => {
      node.setSelectionRange(1, 4);
      node.ownerDocument.body.tabIndex = -1; node.ownerDocument.body.focus();
    });
    await expect(input).not.toBeFocused();
    await expect(surface.locator('.search-focus-hint')).toHaveText('Press Tab to focus search');
    const expectCenteredHint = async () => {
      const geometry = await surface.locator('.search-focus-hint').evaluate(node => {
        const hint = node.getBoundingClientRect();
        const input = node.parentElement!.querySelector('input')!.getBoundingClientRect();
        const clear = node.parentElement!.querySelector('.search-clear')?.getBoundingClientRect();
        return { offset: Math.abs(hint.top + hint.height / 2 - input.top - input.height / 2), clearGap: clear ? clear.left - hint.right : null };
      });
      expect(geometry.offset).toBeLessThan(2);
      if (geometry.clearGap !== null) expect(geometry.clearGap).toBeGreaterThanOrEqual(4);
    };
    await expectCenteredHint();
    expect(await input.evaluate(node => ['Meta', 'Control'].map(modifier => {
      const view = node.ownerDocument.defaultView!;
      const event = new view.KeyboardEvent('keydown', { key: 'f', metaKey: modifier === 'Meta', ctrlKey: modifier === 'Control', bubbles: true, cancelable: true });
      node.ownerDocument.body.dispatchEvent(event);
      return event.defaultPrevented;
    }))).toEqual([false, false]);
    await page.keyboard.press('Tab');
    await expect(surface.locator('.search-focus-hint')).toHaveCount(0);
    await expect(input).toBeFocused();
    expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
    await surface.locator('.settings-button').focus();
    await surface.getByRole('button', { name: 'Focus search', exact: true }).click();
    await expect(input).toBeFocused(); await expect(input).toHaveValue('new tab');
    expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
    await input.press('Meta+k');
    const menu = surface.getByRole('combobox', { name: 'Search actions', exact: true });
    await expect(menu).toBeFocused();
    const menuButton = surface.locator('.action-menu [data-focus-search]');
    await menuButton.focus(); await page.keyboard.press('Enter');
    await expect(menu).toBeFocused();
    await menu.evaluate(node => node.ownerDocument.body.focus());
    await expect(surface.locator('.action-menu .search-focus-hint')).toBeVisible();
    await expectCenteredHint();
    await page.keyboard.press('Tab');
    await expect(menu).toBeFocused();
    await expect(surface.locator('.action-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(input).toHaveValue('new tab');
    await surface.locator('.settings-button').click();
    const settingsInput = surface.getByRole('textbox', { name: 'Search settings', exact: true });
    await expect(settingsInput).toBeVisible();
    await settingsInput.fill('theme');
    await settingsInput.evaluate(node => node.ownerDocument.body.focus());
    await expect(surface.locator('.search-focus-hint')).toBeVisible();
    await expectCenteredHint();
    await page.screenshot({ path: test.info().outputPath(`search-focus-hint-${host}.png`) });
    await page.keyboard.press('Tab');
    await expect(settingsInput).toBeFocused(); await expect(settingsInput).toHaveValue('theme');
    await page.keyboard.press('Shift+Tab');
    await expect(surface.getByRole('button', { name: 'Focus search', exact: true })).toBeFocused();
    await expect(surface.locator('.search-focus-hint')).toHaveCount(0);
    await page.keyboard.press('Tab'); await expect(settingsInput).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(input).toHaveValue('new tab');
    await page.keyboard.press('Escape').catch(error => { if (!page.isClosed()) throw error; });
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test('Saved pages use current tab by default and new tab through shortcut footer and menu', async () => {
    const page = await context.newPage(); await page.goto(`${origin}/Saved-source`);
    const source = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!, page.url());
    const shortcut = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta+Enter' : 'Alt+Enter');
    for (const kind of ['bookmark', 'history', 'allHistory'] as const) {
      const term = `SavedDestination${kind}`;
      const url = `${origin}/${term}?q=one#two`;
      await worker.evaluate(async ({ kind, term, url }) => {
        if (kind === 'bookmark') await chrome.bookmarks.create({ title: term, url });
        else await chrome.history.addUrl({ url });
      }, { kind, term, url });
      for (const method of ['enter', 'click', 'shortcut', 'footer', 'menu'] as const) {
        await worker.evaluate(id => chrome.tabs.update(id, { pinned: false, active: true }), source.id!);
        await page.goto(`${origin}/Saved-source`);
        if (method === 'menu') await worker.evaluate(id => chrome.tabs.update(id, { pinned: true }), source.id!);
        const surface = await openStorageOverlay(page);
        let input = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
        await input.fill(term);
        if (kind === 'allHistory') {
          await surface.locator('#justonehop-search-all-history').click();
          input = surface.getByRole('combobox', { name: 'Search browsing history', exact: true });
        }
        const row = surface.locator(`.result.${kind === 'bookmark' ? 'bookmark' : 'history'}`).filter({ hasText: term });
        await expect(row).toHaveCount(1);
        await expect(row).toHaveAttribute('aria-selected', 'true');
        const before = await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId })).map(tab => tab.id), source.windowId);
        for (const init of [{ key: 'Enter', isComposing: true }, { key: 'Enter', repeat: true }, { key: 'Enter', metaKey: true, shiftKey: true }]) await input.dispatchEvent('keydown', init);
        if (method === 'enter') await input.press('Enter');
        else if (method === 'click') await row.locator('.entry-title').click();
        else if (method === 'shortcut') await input.press(shortcut);
        else if (method === 'footer') {
          await page.setViewportSize({ width: 390, height: 640 });
          await surface.getByRole('button', { name: 'Open in New Tab', exact: true }).click();
        } else {
          await expect(surface.getByRole('button', { name: 'Open in Current Tab', exact: true })).toBeDisabled();
          await input.press('Enter');
          expect((await worker.evaluate(id => chrome.tabs.get(id), source.id!)).url).toBe(`${origin}/Saved-source`);
          const bounds = (await row.boundingBox())!;
          await page.mouse.click(bounds.x + 30, bounds.y + bounds.height / 2, { button: 'right' });
          const actions = surface.getByRole('combobox', { name: 'Search actions' });
          await actions.fill('新标签页'); await actions.press('Enter');
        }
        await expect.poll(() => worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0]?.url, source.windowId)).toBe(url);
        const active = await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0], source.windowId);
        const after = await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId })).map(tab => tab.id), source.windowId);
        if (method === 'enter' || method === 'click') {
          expect(active.id).toBe(source.id); expect(after).toEqual(before);
        } else {
          expect(active.id).not.toBe(source.id); expect(after.length).toBe(before.length + 1);
          expect((await worker.evaluate(id => chrome.tabs.get(id), source.id!)).url).toBe(`${origin}/Saved-source`);
          await worker.evaluate(id => chrome.tabs.remove(id), active.id!);
        }
        await page.setViewportSize({ width: 1100, height: 760 });
      }
    }
  });

  test('Google search: local priority and mouse keyboard menu navigation preserve search terms', async () => {
    // Chrome API-created tabs can navigate before Playwright installs routing.
    // Capture the requested destination and use a local page to verify tab effects.
    await worker.evaluate(base => {
      const state = globalThis as unknown as { __googleRequests: string[] };
      state.__googleRequests = [];
      const redirect = (url: string | undefined) => {
        if (!url?.startsWith('https://www.google.com/search?')) return url;
        state.__googleRequests.push(url);
        return `${base}/Google-destination${new URL(url).search}`;
      };
      const update = chrome.tabs.update.bind(chrome.tabs), create = chrome.tabs.create.bind(chrome.tabs);
      chrome.tabs.update = (async (id: number, props: chrome.tabs.UpdateProperties) => update(id, { ...props, ...(props.url ? { url: redirect(props.url) } : {}) })) as typeof chrome.tabs.update;
      chrome.tabs.create = (async (props: chrome.tabs.CreateProperties) => create({ ...props, ...(props.url ? { url: redirect(props.url) } : {}) })) as typeof chrome.tabs.create;
    }, origin);
    const requests = () => worker.evaluate(() => (globalThis as unknown as { __googleRequests: string[] }).__googleRequests);
    const page = await context.newPage(); await page.goto(`${origin}/Google-source`);
    const source = await worker.evaluate(async url => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
      await chrome.bookmarks.create({ title: 'LocalSearchMatch', url: 'https://example.test/local-result' });
      return { id: tab.id!, windowId: tab.windowId };
    }, page.url());
    let surface = await openStorageOverlay(page);
    let input = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    const rows = () => surface.locator('#justonehop-results .result');
    await expect(rows().filter({ hasText: 'Search Google for' })).toHaveCount(0);
    await input.fill('LocalSearchMatch');
    await expect(rows().first()).toHaveClass(/bookmark/);
    await expect(rows().last()).toContainText('Search Google for “LocalSearchMatch”');
    await input.fill('example.test/new-path');
    await expect(rows().first()).toContainText('Go to URL');
    await expect(rows().last()).toContainText('Search Google for');
    expect(await requests()).toEqual([]);
    await input.press('Escape');
    const shortcut = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta+Enter' : 'Alt+Enter');
    for (const method of ['click', 'enter', 'shortcut', 'footer', 'menu'] as const) {
      await page.goto(`${origin}/Google-source`);
      if (method === 'menu') await worker.evaluate(id => chrome.tabs.update(id, { pinned: true }), source.id);
      surface = await openStorageOverlay(page);
      input = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
      const terms = `UnmatchedSearch ${method} 中文 C++ & #part`;
      const prefix = method === 'shortcut' ? '谷歌搜索 ' : method === 'menu' ? 'google ' : '';
      await input.fill(prefix + terms);
      const row = rows().first();
      await expect(row).toContainText(`Search Google for “${terms}”`);
      await expect(row).toHaveAttribute('aria-selected', 'true');
      const before = (await requests()).length;
      for (const init of [{ key: 'Enter', isComposing: true }, { key: 'Enter', keyCode: 229 }, { key: 'Enter', repeat: true }, { key: 'Enter', metaKey: true, shiftKey: true }]) {
        await input.dispatchEvent('keydown', init);
      }
      expect((await requests()).length).toBe(before);
      if (method === 'click') await row.click();
      else if (method === 'enter') await input.press('Enter');
      else if (method === 'shortcut') await input.press(shortcut);
      else if (method === 'footer') {
        await page.setViewportSize({ width: 390, height: 640 });
        const button = surface.getByRole('button', { name: 'Open in New Tab', exact: true });
        const bounds = await button.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
        await button.click();
      } else {
        await expect(surface.getByRole('button', { name: 'Open in Current Tab', exact: true })).toBeDisabled();
        // Only the primary action is disabled; a real right click must still open Actions.
        const bounds = (await row.boundingBox())!;
        await page.mouse.click(bounds.x + 30, bounds.y + bounds.height / 2, { button: 'right' });
        let menuInput = surface.getByRole('combobox', { name: 'Search actions' });
        await menuInput.press('Escape');
        await expect(input).toHaveValue(prefix + terms); await expect(input).toBeFocused();
        await input.press('Enter');
        expect((await requests()).length).toBe(before);
        await page.mouse.click(bounds.x + 30, bounds.y + bounds.height / 2, { button: 'right' });
        menuInput = surface.getByRole('combobox', { name: 'Search actions' });
        await menuInput.fill('新标签页');
        await expect(surface.locator('.action-row')).toHaveCount(1);
        await menuInput.press('Enter');
      }
      await expect(page.locator('.justonehop-frame')).toHaveCount(0);
      await expect.poll(async () => (await requests()).length).toBe(before + 1);
      const destination = new URL((await requests()).at(-1)!);
      expect(destination.origin + destination.pathname).toBe('https://www.google.com/search');
      expect([...destination.searchParams]).toEqual([['q', terms]]);
      expect(destination.hash).toBe('');
      await expect.poll(async () => worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0]?.url, source.windowId)).toBe(`${origin}/Google-destination${destination.search}`);
      const active = await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0], source.windowId);
      if (method === 'click' || method === 'enter') expect(active.id).toBe(source.id);
      else {
        expect(active.id).not.toBe(source.id);
        expect((await worker.evaluate(id => chrome.tabs.get(id), source.id)).url).toBe(`${origin}/Google-source`);
        await worker.evaluate(id => chrome.tabs.remove(id), active.id!);
      }
      await page.setViewportSize({ width: 1100, height: 760 });
    }
    expect(await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage ?? [])).toEqual([]);
  });

  test('Address navigation: exact existing results suppress the URL candidate but distinct destinations keep it', async () => {
    const page = await context.newPage(); await page.goto(`${origin}/Address-dedup-source`);
    const urls = { tab: `${origin}/Address-dedup-tab`, bookmark: `${origin}/Address-dedup-bookmark`, history: `${origin}/Address-dedup-history` };
    await worker.evaluate(async urls => {
      await chrome.tabs.create({ url: urls.tab, active: false });
      await chrome.bookmarks.create({ title: 'Saved address', url: urls.bookmark });
      await chrome.history.addUrl({ url: urls.history });
    }, urls);
    const surface = await openStorageOverlay(page);
    const input = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    const address = surface.locator('#justonehop-results .result').filter({ hasText: 'Go to URL' });
    for (const kind of ['tab', 'bookmark', 'history'] as const) {
      await input.fill(urls[kind]);
      await expect(surface.locator(`#justonehop-results .result.${kind}`)).toHaveCount(1);
      await expect(surface.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
      await expect(address).toHaveCount(0);
    }
    for (const suffix of ['/different', '?q=1', '#part']) {
      const target = `${urls.tab}${suffix}`;
      await input.fill(target);
      await expect(address).toHaveCount(1);
      await expect(address).toContainText(target);
    }
    await input.fill(`${origin}/Address-dedup-unseen`);
    await expect(address).toHaveCount(1);
    await expect(address).toHaveAttribute('aria-selected', 'true');
    await input.fill(urls.tab);
    await expect(surface.locator('#justonehop-results .result.tab')).toHaveAttribute('aria-selected', 'true');
    await expect(address).toHaveCount(0);
    await input.press('Enter');
    await expect(page.locator('.justonehop-frame')).toHaveCount(0);
    await expect.poll(async () => worker.evaluate(async url => (await chrome.tabs.query({ active: true })).some(tab => tab.url === url), urls.tab)).toBe(true);
    await expect(page).toHaveURL(`${origin}/Address-dedup-source`);
  });

  test('Address navigation: overlay mouse keyboard and menu open the selected address in the intended tab', async () => {
    const page = await context.newPage(); await page.goto(`${origin}/Address-source`);
    const source = await worker.evaluate(async url => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
      return { id: tab.id!, windowId: tab.windowId };
    }, page.url());
    const initialCount = await worker.evaluate(async () => (await chrome.tabs.query({})).length);
    const shortcut = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta+Enter' : 'Alt+Enter');
    for (const method of ['click', 'enter', 'shortcut', 'footer', 'menu'] as const) {
      const surface = await openStorageOverlay(page);
      const input = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
      const target = `${origin}/Address-${method}?Q=A%2Bb#Part`;
      await input.fill(target.replace('http://', ''));
      const row = surface.locator('#justonehop-results .result').first();
      await expect(row).toHaveText(/Go to URL/);
      await expect(row).toContainText(target);
      await expect(row).toHaveAttribute('aria-selected', 'true');
      for (const init of [{ key: 'Enter', isComposing: true }, { key: 'Enter', keyCode: 229 }, { key: 'Enter', repeat: true, metaKey: true }, { key: 'Enter', metaKey: true, shiftKey: true }]) {
        await input.dispatchEvent('keydown', init);
      }
      expect(await worker.evaluate(async id => (await chrome.tabs.get(id)).url, source.id)).toBe(page.url());
      expect(await worker.evaluate(async () => (await chrome.tabs.query({})).length)).toBe(initialCount);
      if (method === 'click') await row.click();
      else if (method === 'enter') await input.press('Enter');
      else if (method === 'shortcut') await input.press(shortcut);
      else if (method === 'footer') {
        await page.setViewportSize({ width: 390, height: 640 });
        const button = surface.getByRole('button', { name: 'Open in New Tab', exact: true });
        await expect(button).toBeVisible();
        const bounds = await button.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
        await button.click();
      } else {
        await row.click({ button: 'right' });
        const menuInput = surface.getByRole('combobox', { name: 'Search actions' });
        await menuInput.fill('新标签页');
        await expect(surface.locator('.action-row')).toHaveCount(1);
        await menuInput.press('Enter');
      }
      await expect(page.locator('.justonehop-frame')).toHaveCount(0);
      if (method === 'click' || method === 'enter') {
        await expect(page).toHaveURL(target);
        expect(await worker.evaluate(async () => (await chrome.tabs.query({})).length)).toBe(initialCount);
      } else {
        await expect.poll(async () => worker.evaluate(async ({ windowId, target }) => {
          const tab = (await chrome.tabs.query({ windowId, active: true }))[0];
          return tab?.url === target ? tab.id : undefined;
        }, { windowId: source.windowId, target })).not.toBeUndefined();
        const created = await worker.evaluate(async ({ windowId, target }) => (await chrome.tabs.query({ windowId })).find(tab => tab.url === target)!, { windowId: source.windowId, target });
        expect(created.id).not.toBe(source.id);
        expect(await worker.evaluate(async () => (await chrome.tabs.query({})).length)).toBe(initialCount + 1);
        expect(await worker.evaluate(async id => (await chrome.tabs.get(id)).url, source.id)).toBe(`${origin}/Address-enter?Q=A%2Bb#Part`);
        await worker.evaluate(id => chrome.tabs.remove(id), created.id!);
      }
      await page.setViewportSize({ width: 1100, height: 760 });
    }
    expect(await worker.evaluate(async () => (await chrome.storage.local.get('searchUsage')).searchUsage ?? [])).toEqual([]);
  });
});

async function openNativePalette() {
  const source = await worker.evaluate(async () => {
    const tab = await chrome.tabs.create({ url: 'chrome://version/', active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    return { tabId: tab.id!, windowId: tab.windowId };
  });
  await expect.poll(() => context.pages().some(page => page.url().includes('popup.html#window='))).toBe(true);
  const palette = context.pages().find(page => page.url().includes('popup.html#window='))!;
  await expect(palette.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' })).toBeFocused();
  return { source, palette };
}

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true, headed: true } });
  test('Google search: native panel opens current and new tabs in its source window', async () => {
    await context.route('https://www.google.com/search?**', route => route.fulfill({ contentType: 'text/html', body: '<title>Search destination</title>' }));
    for (const newTab of [false, true]) {
      const { source, palette } = await openNativePalette();
      const input = palette.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
      const terms = `NativeSearch ${newTab} 中文 & C++`;
      await input.fill(`google ${terms}`);
      await expect(palette.locator('#justonehop-results .result').first()).toContainText(`Search Google for “${terms}”`);
      const shortcut = newTab ? await palette.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta+Enter' : 'Alt+Enter') : 'Enter';
      await input.press(shortcut).catch(error => { if (!palette.isClosed()) throw error; });
      await expect.poll(() => palette.isClosed()).toBe(true);
      await expect.poll(async () => worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0]?.url, source.windowId)).toMatch(/^https:\/\/www.google.com\/search\?/);
      const active = await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0], source.windowId);
      expect(new URL(active.url!).searchParams.get('q')).toBe(terms);
      expect(active.id === source.tabId).toBe(!newTab);
      if (newTab) expect((await worker.evaluate(id => chrome.tabs.get(id), source.tabId)).url).toBe('chrome://version/');
    }
  });

  test('Address navigation: native panel navigates its source and opens new tabs in the source window', async () => {
    for (const newTab of [false, true]) {
      const { source, palette } = await openNativePalette();
      const input = palette.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
      const target = `${origin}/Address-native-${newTab ? 'new' : 'current'}?Q=A%2Bb#Part`;
      const before = await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId })).map(tab => tab.id), source.windowId);
      await input.fill(target);
      await expect(palette.locator('#justonehop-results .result').first()).toHaveAttribute('aria-selected', 'true');
      const shortcut = newTab ? await palette.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta+Enter' : 'Alt+Enter') : 'Enter';
      await input.press(shortcut).catch(error => { if (!palette.isClosed()) throw error; });
      await expect.poll(() => palette.isClosed()).toBe(true);
      await expect.poll(async () => worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0]?.url, source.windowId)).toBe(target);
      const tabs = await worker.evaluate(windowId => chrome.tabs.query({ windowId }), source.windowId);
      expect(tabs).toHaveLength(before.length + Number(newTab));
      expect(tabs.find(tab => tab.id === source.tabId)?.url).toBe(newTab ? 'chrome://version/' : target);
      expect(tabs.find(tab => tab.url === target)?.id === source.tabId).toBe(!newTab);
    }
  });

  test('Embedded Tab Switcher native palette returns to parent and confirms only in its source window', async () => {
    const target = await worker.evaluate(async base => {
      const tab = await chrome.tabs.create({ url: `${base}/Embedded-native-target`, active: false });
      return { id: tab.id!, windowId: tab.windowId };
    }, origin);
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).status, target.id)).toBe('complete');
    const { source, palette } = await openNativePalette();
    expect(source.windowId).toBe(target.windowId);
    const root = palette.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    const child = palette.locator('.recent-switcher');
    const search = child.getByRole('combobox');
    await root.fill('tab switcher');
    await expect(palette.locator('[id="justonehop-command:tabSwitcher"]')).toHaveAttribute('aria-selected', 'true');
    await root.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 7));
    await root.press('Enter');
    await expect(search).toBeEnabled(); await expect(search).toBeFocused();
    await expect(child.locator(`#recent-${source.tabId} .current-badge`)).toHaveText('Current');
    await search.fill('Embedded native target');
    await expect(child.getByRole('option')).toHaveCount(1);
    await palette.keyboard.down('Control'); await palette.keyboard.up('Control');
    await expect(search).toBeFocused();
    expect(await worker.evaluate(async id => (await chrome.tabs.get(id)).active, source.tabId)).toBe(true);
    await child.getByRole('button', { name: 'Back · Tab Switcher', exact: true }).click();
    await expect(root).toHaveValue('tab switcher'); await expect(root).toBeFocused();
    expect(await root.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 7]);
    await expect(palette.locator('[id="justonehop-command:tabSwitcher"]')).toHaveAttribute('aria-selected', 'true');
    await palette.locator('.palette-footer .primary-action').click();
    await search.fill('Embedded native target');
    await expect(child.locator(`#recent-${target.id}`)).toHaveAttribute('aria-selected', 'true');
    await search.press('Enter').catch(error => { if (!palette.isClosed()) throw error; });
    await expect.poll(() => palette.isClosed()).toBe(true);
    await expect.poll(() => worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0]?.id, source.windowId)).toBe(target.id);
    expect(await worker.evaluate(async id => (await chrome.tabs.get(id)).windowId, target.id)).toBe(source.windowId);
  });
});

for (const mode of ['create', 'reuse'] as const) test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true, headed: true } });
  test(`Chrome Pages: native standalone popup ${mode}s only in its source window and preserves other routes`, async () => {
    const owner = await ui.evaluate(async () => (await chrome.tabs.getCurrent())!.windowId);
    // Finish all setup before launching the popup: a newly focused window after
    // launch would correctly dismiss it and invalidate the interaction under test.
    const seeded = await worker.evaluate(async ({ windowId, reuse }) => {
      const sibling = await chrome.tabs.create({ windowId, url: 'chrome://extensions/shortcuts', active: false });
      const exact = reuse ? await chrome.tabs.create({ windowId, url: 'chrome://extensions/', active: false, pinned: true }) : undefined;
      const other = await chrome.windows.create({ url: 'chrome://extensions/', focused: false });
      await chrome.windows.update(windowId, { focused: true });
      return { siblingId: sibling.id!, exactId: exact?.id, otherWindowId: other!.id!, otherTabId: other!.tabs![0].id! };
    }, { windowId: owner, reuse: mode === 'reuse' });
    for (const id of [seeded.siblingId, seeded.otherTabId, ...(seeded.exactId === undefined ? [] : [seeded.exactId])]) {
      await expect.poll(() => worker.evaluate(async tabId => (await chrome.tabs.get(tabId)).status, id)).toBe('complete');
    }
    const { source, palette } = await openNativePalette();
    expect(source.windowId).toBe(owner);
    const popupWindow = await palette.evaluate(() => chrome.windows.getCurrent());
    expect(popupWindow.type).toBe('popup');
    expect(popupWindow.id).not.toBe(owner);
    const before = await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId })).map(tab => tab.id!).sort((a, b) => a - b), owner);
    const search = palette.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await search.fill('extensions');
    await expect(palette.locator('#justonehop-results [role="option"]').first()).toHaveAttribute('id', 'justonehop-command:openExtensions');
    await search.press('Enter').catch(error => { if (!palette.isClosed()) throw error; });
    await expect.poll(() => palette.isClosed()).toBe(true);
    await expect.poll(() => worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0]?.url, owner)).toBe('chrome://extensions/');
    const after = await worker.evaluate(async windowId => chrome.tabs.query({ windowId }), owner);
    const matches = after.filter(tab => tab.url === 'chrome://extensions/');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ windowId: owner, active: true });
    if (mode === 'reuse') {
      expect(matches[0]).toMatchObject({ id: seeded.exactId, pinned: true });
      expect(after.map(tab => tab.id!).sort((a, b) => a - b)).toEqual(before);
    } else {
      expect(before).not.toContain(matches[0].id);
      expect(after.map(tab => tab.id!).sort((a, b) => a - b)).toEqual([...before, matches[0].id!].sort((a, b) => a - b));
    }
    expect(await worker.evaluate(id => chrome.tabs.get(id), source.tabId)).toMatchObject({ windowId: owner, url: 'chrome://version/' });
    expect(await worker.evaluate(id => chrome.tabs.get(id), seeded.siblingId)).toMatchObject({ windowId: owner, url: 'chrome://extensions/shortcuts' });
    expect(await worker.evaluate(id => chrome.tabs.get(id), seeded.otherTabId)).toMatchObject({ windowId: seeded.otherWindowId, url: 'chrome://extensions/', active: true });
    expect(await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId })).map(tab => tab.id), seeded.otherWindowId)).toEqual([seeded.otherTabId]);
    // Both windows have this URL. Inspect both WebUIs so a loaded page in the
    // other window cannot mask a failed navigation in the source window.
    await expect.poll(() => context.pages().filter(page => page.url() === 'chrome://extensions/').length).toBe(2);
    for (const page of context.pages().filter(page => page.url() === 'chrome://extensions/')) {
      await expectChromePageLoaded(page, { url: 'chrome://extensions/', root: 'extensions-manager' });
    }
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true, headed: true } });
  test('English palette launch native page aligns a separate window with the content viewport and executes against the source', async () => {
  const { source, palette } = await openNativePalette();
  const bounds = await palette.evaluate(async sourceId => {
    const current = await chrome.windows.getCurrent();
    const owner = await chrome.windows.get(sourceId);
    const reply = await chrome.runtime.sendMessage({ source: 'justonehop', type: 'snapshot' });
    const tab = await chrome.tabs.get(reply.data.currentTabId);
    return { current, owner, tab, snapshot: reply.data, screenX, screenY, outerWidth, outerHeight, innerWidth, innerHeight };
  }, source.windowId);
  expect(bounds.current.type).toBe('popup');
  expect(bounds.snapshot.windowId).toBe(source.windowId);
  expect(bounds.snapshot.currentTabId).toBe(source.tabId);
  const viewportWidth = bounds.tab.width!, viewportHeight = bounds.tab.height!;
  const expectedWidth = Math.min(750, viewportWidth - (viewportWidth <= 520 ? 20 : 48));
  const topInset = viewportWidth <= 520 ? 24 : Math.min(150, Math.max(28, viewportHeight * .16));
  const expectedTop = bounds.owner.top! + bounds.owner.height! - viewportHeight + topInset;
  const contentTop = bounds.screenY + bounds.outerHeight - bounds.innerHeight - (bounds.outerWidth - bounds.innerWidth) / 2;
  expect(Math.abs(contentTop - expectedTop)).toBeLessThan(3);
  expect(Math.abs(bounds.screenX + bounds.outerWidth / 2 - bounds.owner.left! - bounds.owner.width! / 2)).toBeLessThan(3);
  expect(bounds.innerWidth).toBe(expectedWidth);
  expect(Math.abs(bounds.innerHeight - Math.min(516, viewportHeight - topInset - 24))).toBeLessThanOrEqual(1);
  const input = palette.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await input.fill('settings'); await input.press('Enter');
  await expect(palette.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  await palette.keyboard.press('Escape'); await expect(input).toBeFocused();
  await input.fill('pin tab');
  await input.press('Enter');
  await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).pinned, source.tabId)).toBe(true);
  await expect(input).toHaveValue('pin tab');
  await expect(input).toBeFocused();
  await expect(palette.locator('[id="justonehop-command:pin"] .entry-title')).toContainText('Unpin Tab');
  expect((await worker.evaluate(id => chrome.tabs.get(id), source.tabId)).windowId).toBe(source.windowId);
});
});

for (const layer of ['root', 'group'] as const) test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true, headed: true } });
  test(`English source close overlay ${layer} keeps other-tab management open then closes without a new window`, async () => {
    const sourcePage = await context.newPage();
    await sourcePage.goto(`${origin}/SourceClose-member-source`);
    const seeded = await worker.evaluate(async ({ origin, grouped }) => {
      const source = (await chrome.tabs.query({})).find(tab => tab.url === `${origin}/SourceClose-member-source`)!;
      // A native successor must not trigger an automatic standalone panel.
      const successor = await chrome.tabs.create({ windowId: source.windowId, index: source.index + 1, url: 'chrome://version/', active: false });
      const another = await chrome.tabs.create({ windowId: source.windowId, index: source.index + 2, url: `${origin}/SourceClose-member-another`, active: false });
      const last = await chrome.tabs.create({ windowId: source.windowId, index: source.index + 3, url: `${origin}/SourceClose-member-last`, active: false });
      const groupId = grouped ? await chrome.tabs.group({ tabIds: [source.id!, successor.id!, another.id!, last.id!] }) : undefined;
      if (groupId !== undefined) await chrome.tabGroups.update(groupId, { title: 'SourceClose Research', color: 'blue', collapsed: false });
      return { source: source.id!, windowId: source.windowId, successor: successor.id!, another: another.id!, last: last.id!, groupId };
    }, { origin, grouped: layer === 'group' });
    for (const id of [seeded.successor, seeded.another, seeded.last]) {
      await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).status, id)).toBe('complete');
    }
    await sourcePage.bringToFront();
    await expect.poll(() => sourcePage.evaluate(() => document.hasFocus())).toBe(true);
    await worker.evaluate(async () => {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    });
    const surface = sourcePage.frameLocator('.justonehop-frame');
    const root = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await expect(root).toBeFocused();
    await worker.evaluate(() => {
      const created: number[] = [];
      (globalThis as unknown as { __sourceCloseWindows: number[] }).__sourceCloseWindows = created;
      chrome.windows.onCreated.addListener(window => created.push(window.id!));
    });
    if (layer === 'group') {
      await root.fill('SourceClose Research');
      await surface.getByRole('option').filter({ hasText: 'Tab Group: SourceClose Research' }).click();
    }
    const input = layer === 'root' ? root : surface.getByRole('combobox', { name: 'Search tabs in this group…' });
    const query = layer === 'root' ? 'SourceClose member' : 'member';
    await input.fill(query);
    await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
    await surface.locator(`[id="${layer === 'root' ? 'justonehop' : 'group'}-tab:${seeded.another}"]`).click({ button: 'right' });
    await surface.locator(layer === 'root' ? '[id="justonehop-actions-action:close"]' : '#group-actions-close').click();
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(tab => tab.id === id), seeded.another)).toBe(false);
    await expect(input).toHaveValue(query); await expect(input).toBeFocused();
    expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
    await expect(surface.locator('.action-menu')).toHaveCount(0);
    await expect(sourcePage.locator('#justonehop-command-palette')).toBeAttached();
    expect(await worker.evaluate(id => chrome.tabs.get(id), seeded.source)).toMatchObject({ active: true });
    if (layer === 'root') {
      await input.fill('close tab');
      await expect(surface.locator('#justonehop-results [aria-selected="true"]')).toHaveAttribute('id', 'justonehop-command:close');
      await surface.locator('.palette-footer .primary-action').click().catch(error => { if (!sourcePage.isClosed()) throw error; });
    } else {
      await surface.locator(`[id="group-tab:${seeded.source}"]`).click({ button: 'right' });
      await surface.locator('#group-actions-close').click().catch(error => { if (!sourcePage.isClosed()) throw error; });
    }
    await expect.poll(() => sourcePage.isClosed()).toBe(true);
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(tab => tab.id === id), seeded.source)).toBe(false);
    await expect.poll(() => worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0]?.id, seeded.windowId)).toBe(seeded.successor);
    expect(await worker.evaluate(id => chrome.tabs.get(id), seeded.last)).toMatchObject({ windowId: seeded.windowId });
    expect(context.pages().filter(page => page.url().includes('popup.html#window='))).toHaveLength(0);
    expect(await worker.evaluate(() => (globalThis as unknown as { __sourceCloseWindows: number[] }).__sourceCloseWindows)).toEqual([]);
    expect(await worker.evaluate(() => chrome.storage.session.get('justonehopPaletteWindow'))).toEqual({});
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true, headed: true } });
  test('English source close native bound tab closes its panel without rebinding or creating a window', async () => {
    const successor = await worker.evaluate(async () => {
      const tab = await chrome.tabs.create({ url: 'chrome://downloads/', active: false });
      return tab.id!;
    });
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).status, successor)).toBe('complete');
    const { source, palette } = await openNativePalette();
    const input = palette.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    const bound = await palette.evaluate(async () => {
      const reply = await chrome.runtime.sendMessage({ source: 'justonehop', type: 'snapshot' });
      return { currentTabId: reply.data.currentTabId, panelTabId: (await chrome.tabs.getCurrent())!.id };
    });
    expect(bound.currentTabId).toBe(source.tabId);
    expect(bound.panelTabId).not.toBe(source.tabId);
    await worker.evaluate(() => {
      const created: number[] = [];
      (globalThis as unknown as { __sourceCloseWindows: number[] }).__sourceCloseWindows = created;
      chrome.windows.onCreated.addListener(window => created.push(window.id!));
    });
    await input.fill('close tab');
    await expect(palette.locator('#justonehop-results [aria-selected="true"]')).toHaveAttribute('id', 'justonehop-command:close');
    await input.press('Enter').catch(error => { if (!palette.isClosed()) throw error; });
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(tab => tab.id === id), source.tabId)).toBe(false);
    await expect.poll(() => palette.isClosed()).toBe(true);
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).active, successor)).toBe(true);
    await expect.poll(() => worker.evaluate(() => chrome.storage.session.get('justonehopPaletteWindow'))).toEqual({});
    expect(context.pages().filter(page => page.url().includes('popup.html#window='))).toHaveLength(0);
    expect(await worker.evaluate(() => (globalThis as unknown as { __sourceCloseWindows: number[] }).__sourceCloseWindows)).toEqual([]);
    expect(ui.isClosed()).toBe(false);
  });

  test('English keep-open native other-tab close retains its binding and mouse Pin and Mute accept subsequent Enter', async () => {
    const other = await worker.evaluate(async () => (await chrome.tabs.create({ url: 'chrome://downloads/', active: false })).id!);
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).status, other)).toBe('complete');
    const { source, palette } = await openNativePalette();
    const input = palette.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await input.fill('chrome://downloads');
    await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 7));
    await palette.locator(`[id="justonehop-tab:${other}"]`).click({ button: 'right' });
    await palette.locator('[id="justonehop-actions-action:close"]').click();
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(tab => tab.id === id), other)).toBe(false);
    await expect(input).toHaveValue('chrome://downloads'); await expect(input).toBeFocused();
    expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 7]);
    expect(context.pages().filter(page => page.url().includes('popup.html#window='))).toEqual([palette]);
    expect(await palette.evaluate(async () => (await chrome.runtime.sendMessage({ source: 'justonehop', type: 'snapshot' })).data.currentTabId)).toBe(source.tabId);
    expect(await worker.evaluate(id => chrome.tabs.get(id), source.tabId)).toMatchObject({ active: true, pinned: false });
    for (const action of ['pin', 'mute'] as const) {
      await input.fill(action);
      const row = palette.locator(`[id="justonehop-command:${action}"]`);
      await row.click();
      const state = () => worker.evaluate(async ({ id, action }) => {
        const tab = await chrome.tabs.get(id); return action === 'pin' ? tab.pinned : tab.mutedInfo?.muted;
      }, { id: source.tabId, action });
      await expect.poll(state).toBe(true);
      await expect(row).toHaveAttribute('aria-selected', 'true');
      await expect(row.locator('.entry-title')).toContainText(action === 'pin' ? 'Unpin Tab' : 'Unmute Tab');
      await expect(palette.locator('.palette-footer .primary-action')).toBeEnabled();
      await expect(input).toBeFocused(); await expect(input).toHaveValue(action);
      await input.press('Enter');
      await expect.poll(state).toBe(false);
      await expect(row).toHaveAttribute('aria-selected', 'true');
      await expect(input).toBeFocused();
    }
  });

  test('English keep-open native external source close cancels only its own panel', async () => {
    const other = await worker.evaluate(async origin => {
      const window = await chrome.windows.create({ url: `${origin}/External-close-unrelated`, focused: false });
      return { windowId: window!.id!, tabId: window!.tabs![0].id! };
    }, origin);
    await ui.bringToFront();
    const { source, palette } = await openNativePalette();
    await palette.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' }).fill('close tab');
    await worker.evaluate(id => chrome.tabs.remove(id), source.tabId);
    await expect.poll(() => palette.isClosed()).toBe(true);
    await expect.poll(() => context.pages().filter(page => page.url().includes('popup.html#window=')).length).toBe(0);
    expect(ui.isClosed()).toBe(false);
    expect(await worker.evaluate(id => chrome.tabs.get(id), other.tabId)).toMatchObject({ windowId: other.windowId, url: `${origin}/External-close-unrelated` });
    expect((await worker.evaluate(id => chrome.windows.get(id), source.windowId)).type).toBe('normal');
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true, headed: true } });
  test('English source close delayed removal still completes after Escape without reopening a panel', async () => {
    const page = await context.newPage(); await page.goto(`${origin}/Cancelled-continuation-source`);
    const seeded = await worker.evaluate(async origin => {
      const source = (await chrome.tabs.query({})).find(tab => tab.url === `${origin}/Cancelled-continuation-source`)!;
      const successor = await chrome.tabs.create({ windowId: source.windowId, index: source.index + 1, url: 'chrome://version/', active: false });
      return { source: source.id!, successor: successor.id!, windowId: source.windowId };
    }, origin);
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).status, seeded.successor)).toBe('complete');
    await page.bringToFront();
    await worker.evaluate(async sourceId => {
      const original = chrome.tabs.remove.bind(chrome.tabs);
      const state = { release: undefined as (() => void) | undefined, settled: false, popups: [] as number[] };
      (globalThis as unknown as { __cancelledClose: typeof state }).__cancelledClose = state;
      chrome.windows.onCreated.addListener(window => { if (window.type === 'popup') state.popups.push(window.id!); });
      chrome.tabs.remove = (async (ids: number | number[]) => {
        const removesSource = (Array.isArray(ids) ? ids : [ids]).includes(sourceId);
        if (removesSource) await new Promise<void>(resolve => { state.release = resolve; });
        const result = await original(Array.isArray(ids) ? ids : [ids]);
        if (removesSource) state.settled = true;
        return result;
      }) as typeof chrome.tabs.remove;
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    }, seeded.source);
    const input = page.frameLocator('.justonehop-frame').getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await expect(input).toBeFocused(); await input.fill('close tab'); await input.press('Enter');
    await expect.poll(() => worker.evaluate(() => typeof (globalThis as unknown as { __cancelledClose: { release?: () => void } }).__cancelledClose.release)).toBe('function');
    await page.keyboard.press('Escape');
    await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
    expect(await worker.evaluate(async id => (await chrome.tabs.get(id)).active, seeded.source)).toBe(true);
    await worker.evaluate(() => (globalThis as unknown as { __cancelledClose: { release: () => void } }).__cancelledClose.release());
    await expect.poll(() => page.isClosed()).toBe(true);
    await expect.poll(() => worker.evaluate(() => (globalThis as unknown as { __cancelledClose: { settled: boolean } }).__cancelledClose.settled)).toBe(true);
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).active, seeded.successor)).toBe(true);
    expect(context.pages().filter(page => page.url().includes('popup.html#window='))).toHaveLength(0);
    expect(await worker.evaluate(() => (globalThis as unknown as { __cancelledClose: { popups: number[] } }).__cancelledClose.popups)).toEqual([]);
    expect(await worker.evaluate(() => chrome.storage.session.get('justonehopPaletteWindow'))).toEqual({});
    // Only an explicit new command may open a panel on the successor.
    await worker.evaluate(async () => {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    });
    await expect.poll(() => context.pages().filter(page => page.url().includes('popup.html#window=')).length).toBe(1);
    const reopened = context.pages().find(page => page.url().includes('popup.html#window='))!;
    await expect(reopened.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' })).toHaveValue('');
    await expect(reopened.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' })).toBeFocused();
    expect(await worker.evaluate(() => (globalThis as unknown as { __cancelledClose: { popups: number[] } }).__cancelledClose.popups)).toHaveLength(1);
    expect(await worker.evaluate(async () => (await chrome.storage.session.get<{ justonehopPaletteWindow: { sourceTabId: number } }>('justonehopPaletteWindow')).justonehopPaletteWindow.sourceTabId)).toBe(seeded.successor);
  });
});

// Chrome forbids tabs.setZoom on chrome:// pages. Exercise the real standalone
// controllers with a zoomable HTTP source by changing only its launch-time URL
// classification in the test worker; all geometry APIs still read the real tab.
async function launchStandaloneForGeometry(tabId: number, command = 'toggle-palette') {
  await worker.evaluate(async ({ tabId, command }) => {
    const source = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(source.windowId, { focused: true });
    const query = chrome.tabs.query, send = chrome.tabs.sendMessage;
    Object.defineProperty(chrome.tabs, 'query', { configurable: true, value: async (options: chrome.tabs.QueryInfo) =>
      (await query(options)).map(tab => tab.id === tabId ? { ...tab, url: 'chrome://version/', pendingUrl: undefined } : tab) });
    Object.defineProperty(chrome.tabs, 'sendMessage', { configurable: true, value: (id: number, message: { source?: string; type?: string }, options?: chrome.tabs.MessageSendOptions) =>
      id === tabId && message.source === 'justonehop-recent' && message.type === 'arm' ? Promise.resolve({ held: true }) : send(id, message, options) });
    try {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback(command)));
    } finally {
      Object.defineProperty(chrome.tabs, 'query', { configurable: true, value: query });
      Object.defineProperty(chrome.tabs, 'sendMessage', { configurable: true, value: send });
    }
  }, { tabId, command });
}

async function pointerViewport(page: Page, zoom: number) {
  await page.evaluate(zoom => {
    (window as any).__contentOrigin = undefined;
    document.addEventListener('pointermove', event => {
      if (event.isTrusted) (window as any).__contentOrigin = {
        left: event.screenX - event.clientX * zoom, top: event.screenY - event.clientY * zoom,
      };
    }, { once: true });
  }, zoom);
  await page.mouse.move(101, 103);
  await page.waitForFunction(() => Boolean((window as any).__contentOrigin));
  return page.evaluate(() => (window as any).__contentOrigin as { left: number; top: number });
}

for (const layout of ['horizontal tabs', 'vertical tabs']) for (const zoom of [1, 1.25, .8]) test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true, headed: true, verticalTabs: layout === 'vertical tabs' } });
  test(`English palette launch native storage panel matches the overlay screen position with ${layout} at ${zoom * 100}% zoom`, async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Screen-alignment`); await page.bringToFront();
  const source = await worker.evaluate(async ({ url, zoom }) => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
    await chrome.tabs.setZoom(tab.id!, zoom);
    return { tabId: tab.id!, windowId: tab.windowId };
  }, { url: page.url(), zoom });
  const viewport = await pointerViewport(page, zoom);
  if (layout === 'vertical tabs') expect(viewport.left - await page.evaluate(() => screenX)).toBeGreaterThan(200);
  await worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  const surface = page.frameLocator('.justonehop-frame');
  await expect(surface.getByRole('combobox')).toBeFocused();
  // Read CSS geometry from the actual rendered overlay, then convert to screen
  // DIPs. Playwright's cross-frame boundingBox already includes browser zoom.
  const box = await surface.locator('.palette').evaluate(node => {
    const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await page.keyboard.press('Escape');
  // Start with a different extension-origin zoom. Temporary panels must copy
  // their source's zoom without changing this other extension page.
  await ui.evaluate(async () => { const tab = await chrome.tabs.getCurrent(); await chrome.tabs.setZoom(tab!.id!, 1.5); });
  await launchStandaloneForGeometry(source.tabId);
  await expect.poll(() => context.pages().some(page => page.url().includes('popup.html#window='))).toBe(true);
  const popup = context.pages().find(page => page.url().includes('popup.html#window='))!;
  await expect(popup.getByRole('combobox')).toBeFocused();
  const native = await popup.locator('.palette').evaluate(async node => {
    const tab = await chrome.tabs.getCurrent(), own = await chrome.windows.getCurrent(), zoom = await chrome.tabs.getZoom(tab!.id!);
    const rect = node.getBoundingClientRect(), frameWidth = own.width! - tab!.width!, frameHeight = own.height! - tab!.height!;
    return { left: own.left! + frameWidth / 2 + rect.x * zoom,
      top: own.top! + frameHeight - frameWidth / 2 + rect.y * zoom, width: rect.width * zoom, height: rect.height * zoom, zoom };
  });
  expect(native.zoom).toBe(zoom);
  expect(Math.abs(native.left - viewport.left - box.x * zoom)).toBeLessThan(3);
  expect(Math.abs(native.top - viewport.top - box.y * zoom)).toBeLessThan(3);
  expect(Math.abs(native.width - box.width * zoom)).toBeLessThanOrEqual(1);
  expect(Math.abs(native.height - box.height * zoom)).toBeLessThanOrEqual(1);
  expect(await ui.evaluate(async () => chrome.tabs.getZoom((await chrome.tabs.getCurrent())!.id!))).toBe(1.5);
  expect((await worker.evaluate(id => chrome.tabs.get(id), source.tabId)).windowId).toBe(source.windowId);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true, headed: true } });
  test('English wheel back returns and closes the native palette', async () => {
    const { palette, source } = await openNativePalette();
    const search = palette.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await search.fill('settings'); await search.press('Enter');
    await expect(palette.getByRole('textbox', { name: 'Search settings' })).toBeFocused();
    await palette.locator('.palette-footer-title').hover(); await palette.mouse.wheel(-140, 0);
    await expect(search).toBeFocused(); await expect(search).toHaveValue('settings');
    await palette.waitForTimeout(300);
    await palette.locator('.palette-footer-title').hover(); await palette.mouse.wheel(-140, 0);
    await expect.poll(() => palette.isClosed()).toBe(true);
    expect((await worker.evaluate(id => chrome.tabs.get(id), source.tabId)).url).toBe('chrome://version/');
  });
  test('English palette launch native window closes on Escape shortcut and focus loss', async () => {
  let opened = await openNativePalette();
  await opened.palette.keyboard.press('Escape').catch(error => { if (!opened.palette.isClosed()) throw error; });
  await expect.poll(() => opened.palette.isClosed()).toBe(true);
  opened = await openNativePalette();
  await worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  await expect.poll(() => opened.palette.isClosed()).toBe(true);
  opened = await openNativePalette();
  await worker.evaluate(id => chrome.windows.update(id, { focused: true }), opened.source.windowId);
  await expect.poll(() => opened.palette.isClosed()).toBe(true);
});
});

for (const zoom of [1, 1.25, .8]) test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true, headed: true } });
  test(`English palette launch native visual sizing matches the recent switcher at ${zoom * 100}% zoom and stays compact`, async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Switcher-screen-alignment`); await page.bringToFront();
  const source = await worker.evaluate(async ({ url, zoom }) => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)!;
    await chrome.tabs.setZoom(tab.id!, zoom); return { tabId: tab.id!, windowId: tab.windowId };
  }, { url: page.url(), zoom });
  await launchStandaloneForGeometry(source.tabId);
  await expect.poll(() => context.pages().some(page => page.url().includes('popup.html#window='))).toBe(true);
  const palette = context.pages().find(page => page.url().includes('popup.html#window='))!;
  await expect(palette.getByRole('combobox')).toBeFocused();
  const bounds = await palette.evaluate(() => chrome.windows.getCurrent());
  expect(await palette.locator('.search-bar').evaluate(node => node.getBoundingClientRect().height)).toBeCloseTo(56, 1);
  await palette.keyboard.press('Escape').catch(error => { if (!palette.isClosed()) throw error; });
  await expect.poll(() => palette.isClosed()).toBe(true);
  await page.bringToFront();
  await launchStandaloneForGeometry(source.tabId, 'switch-recent');
  await expect.poll(() => context.pages().some(page => page.url().includes('switcher.html?'))).toBe(true);
  const switcher = context.pages().find(page => page.url().includes('switcher.html?'))!;
  await expect(switcher.getByRole('option').first()).toBeVisible();
  await expect(switcher.getByRole('listbox')).toBeFocused();
  await expect(switcher.getByRole('combobox')).toBeDisabled();
  expect(await switcher.evaluate(async () => chrome.tabs.getZoom((await chrome.tabs.getCurrent())!.id!))).toBe(zoom);
  expect(await switcher.locator('.search-bar').evaluate(node => node.getBoundingClientRect().height)).toBeCloseTo(56, 1);
  const actual = await switcher.evaluate(() => chrome.windows.getCurrent());
  for (const key of ['width', 'height', 'left', 'top'] as const) expect(actual[key]).toBe(bounds[key]);
  const rendered = await switcher.evaluate(async () => {
    const tab = (await chrome.tabs.getCurrent())!;
    const rect = (selector: string) => { const box = document.querySelector(selector)!.getBoundingClientRect();
      return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height }; };
    return { innerWidth, innerHeight, tabWidth: tab.width!, tabHeight: tab.height!,
      bodyWidth: document.body.scrollWidth, bodyHeight: document.body.scrollHeight,
      footer: rect('.palette-footer'), close: rect('.close-button') };
  });
  expect(Math.abs(rendered.innerWidth * zoom - rendered.tabWidth)).toBeLessThanOrEqual(zoom);
  expect(Math.abs(rendered.innerHeight * zoom - rendered.tabHeight)).toBeLessThanOrEqual(zoom);
  expect(rendered.bodyWidth).toBeLessThanOrEqual(rendered.innerWidth);
  expect(rendered.bodyHeight).toBeLessThanOrEqual(rendered.innerHeight);
  for (const box of [rendered.footer, rendered.close]) {
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(rendered.innerWidth + 1); expect(box.bottom).toBeLessThanOrEqual(rendered.innerHeight + 1);
  }
  expect(Math.abs(rendered.footer.bottom - rendered.innerHeight)).toBeLessThanOrEqual(1);
  // Capture the native content rectangle in screen DIPs. CSS viewport dimensions
  // crop the image at browser zoom because the capture surface uses native units.
  const capture = await context.newCDPSession(switcher);
  const screenshot = await capture.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: rendered.tabWidth, height: rendered.tabHeight, scale: 1 } });
  await writeFile(test.info().outputPath(`justonehop-switcher-polish-${zoom * 100}.png`), Buffer.from(screenshot.data, 'base64'));
  await capture.detach();
  await switcher.evaluate(async () => chrome.tabs.setZoom((await chrome.tabs.getCurrent())!.id!, 1));
  await switcher.setViewportSize({ width: 390, height: 440 });
  expect(await switcher.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(390);
  const footer = await switcher.locator('.palette-footer').boundingBox();
  expect(footer!.height).toBe(44);
  expect(footer!.y + footer!.height).toBe(440);
  await expect(switcher.locator('.recent-help')).toHaveCount(0);
  expect(await switcher.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(switcher.locator('footer').getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  expect(await worker.evaluate(async id => (await chrome.tabs.get(id)).active, source.tabId)).toBe(true);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English group result actions preserve context and confirm whole-group deletion', async () => {
    const setup = await worker.evaluate(async origin => {
      const a = await chrome.tabs.create({ url: `${origin}/Direct-Alpha`, active: false });
      const b = await chrome.tabs.create({ url: `${origin}/Direct-Beta`, active: false });
      const id = await chrome.tabs.group({ tabIds: [a.id!, b.id!] });
      await chrome.tabGroups.update(id, { title: 'DirectGroup', color: 'blue', collapsed: true });
      return { id, ids: [a.id!, b.id!] };
    }, origin);
    const root = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    const actionSearch = ui.getByRole('combobox', { name: 'Search actions' });
    const groupRow = () => ui.getByRole('option').filter({ hasText: 'Tab Group: DirectGroup' });
    await root.fill('DirectGroup');
    await root.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
    await groupRow().click({ button: 'right' });
    await expect(ui.locator('.action-menu [role="option"]')).toHaveCount(4);
    await expect(ui.locator('.palette-footer .primary-action')).toHaveText(/Expand Group/);
    for (const title of ['Expand Group', 'Rename Group', 'Ungroup (Keep All Tabs)', 'Close Entire Group']) {
      await expect(ui.getByRole('option', { name: title })).toBeVisible();
    }
    await ui.getByRole('option', { name: 'Expand Group' }).click();
    await expect(root).toBeFocused();
    await expect(ui.getByRole('button', { name: 'View Group Tabs', exact: true })).toBeVisible();
    expect(await worker.evaluate(id => chrome.tabGroups.get(id), setup.id)).toMatchObject({ collapsed: false });
    expect(await root.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
    await ui.getByRole('button', { name: 'Open action menu' }).click();
    await ui.getByRole('option', { name: 'Rename Group', exact: true }).click();
    await ui.getByLabel('Group Name', { exact: true }).fill('DirectGroup Renamed');
    await ui.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(root).toBeFocused(); await expect(root).toHaveValue('DirectGroup');
    expect(await root.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
    expect(await worker.evaluate(id => chrome.tabGroups.get(id), setup.id)).toMatchObject({ title: 'DirectGroup Renamed', color: 'blue' });
    await root.press('Meta+k'); await actionSearch.fill('close'); await actionSearch.press('Enter');
    const confirmation = ui.getByRole('alertdialog');
    await expect(confirmation).toContainText('DirectGroup Renamed'); await expect(confirmation).toContainText('2 tabs');
    await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await ui.keyboard.press('Escape'); await expect(actionSearch).toBeFocused();
    await ui.keyboard.press('Escape'); await expect(root).toBeFocused();
    expect(await root.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
    // A new member after confirmation was shown must never be swept into deletion.
    await root.press('Meta+k'); await actionSearch.fill('close'); await actionSearch.press('Enter');
    const extra = await worker.evaluate(async ({ origin, id }) => {
      const tab = await chrome.tabs.create({ url: `${origin}/Direct-Gamma`, active: false });
      await chrome.tabs.group({ groupId: id, tabIds: [tab.id!] }); return tab.id!;
    }, { origin, id: setup.id });
    await confirmation.getByRole('button', { name: 'Close Entire Group', exact: true }).click();
    await expect(ui.getByRole('alert')).toContainText('Group membership changed');
    expect(await worker.evaluate(async ids => Promise.all(ids.map(id => chrome.tabs.get(id))), [...setup.ids, extra])).toHaveLength(3);
    await ui.keyboard.press('Escape');
    await root.press('Enter');
    const members = ui.getByRole('combobox', { name: 'Search tabs in this group…' });
    await expect(members).toBeFocused();
    await ui.getByRole('button', { name: 'Open action menu' }).click();
    await ui.getByRole('option', { name: 'Ungroup (Keep All Tabs)', exact: true }).click();
    await expect(root).toBeFocused(); await expect(root).toHaveValue('DirectGroup');
    expect(await worker.evaluate(async ids => Promise.all(ids.map(async id => (await chrome.tabs.get(id)).groupId)), [...setup.ids, extra])).toEqual([-1, -1, -1]);
    await worker.evaluate(async ids => {
      const id = await chrome.tabs.group({ tabIds: ids as [number, ...number[]] });
      await chrome.tabGroups.update(id, { title: 'DirectGroup' });
    }, setup.ids);
    await ui.evaluate(() => window.dispatchEvent(new Event('focus')));
    await groupRow().click(); await expect(members).toBeFocused();
    await members.fill('Alpha');
    await members.press('Meta+k'); await actionSearch.fill('close entire'); await actionSearch.press('Enter');
    await expect(confirmation).toContainText('2 tabs');
    await ui.keyboard.press('Tab'); await ui.keyboard.press('Enter');
    await expect(root).toBeFocused(); await expect(root).toHaveValue('DirectGroup');
    expect(await worker.evaluate(async ids => Promise.all(ids.map(id => chrome.tabs.get(id).then(() => true, () => false))), setup.ids)).toEqual([false, false]);
    expect(await worker.evaluate(async id => (await chrome.tabs.get(id)).groupId, extra)).toBe(-1);
  });

  test('English Tab Group search management and nested keyboard navigation', async () => {
  const setup = await worker.evaluate(async origin => {
    const a = await chrome.tabs.create({ url: `${origin}/Group-Alpha`, active: false });
    const b = await chrome.tabs.create({ url: `${origin}/Group-Beta`, active: false });
    const id = await chrome.tabs.group({ tabIds: [a.id!, b.id!] });
    await chrome.tabGroups.update(id, { title: 'Research', color: 'blue', collapsed: true });
    return { id, a: a.id!, b: b.id! };
  }, origin);
  await ui.setViewportSize({ width: 750, height: 516 });
  const root = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await root.fill('Research');
  await expect(ui.getByRole('option').filter({ hasText: 'Tab Group: Research' })).toBeVisible();
  const mainPanel = await ui.locator('.palette').boundingBox();
  const mainFooter = await ui.locator('.palette-footer').boundingBox();
  await expect(ui.locator('.tab-group-badge')).toHaveCount(2);
  await ui.getByRole('option').filter({ hasText: 'Tab Group: Research' }).click();
  const search = ui.getByRole('combobox', { name: 'Search tabs in this group…' });
  await expect(search).toBeFocused();
  await expect(ui.getByRole('option')).toHaveCount(2);
  expect(await ui.locator('.palette').boundingBox()).toEqual(mainPanel);
  expect(await ui.locator('.palette-footer').boundingBox()).toEqual(mainFooter);
  expect(mainPanel!.height).toBe(516); expect(mainFooter!.height).toBe(44);
  await search.press('Control+n'); await search.press('Control+p');
  // A lower row must remain visible when the editor remounts the member list.
  const extraTabs = await worker.evaluate(async ({ origin, groupId }) => {
    const ids: number[] = [];
    for (let at = 0; at < 16; at++) ids.push((await chrome.tabs.create({ url: `${origin}/Group-Extra-${at}`, active: false })).id!);
    await chrome.tabs.group({ groupId, tabIds: ids as [number, ...number[]] });
    return ids;
  }, { origin, groupId: setup.id });
  await ui.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(ui.locator('.group-view .result')).toHaveCount(18);
  await search.fill('Group');
  await search.press('Meta+ArrowDown');
  const lowerRow = ui.locator('.group-view .result[aria-selected=true]');
  const lowerId = await lowerRow.getAttribute('id');
  expect(await ui.locator('#justonehop-group-tabs').evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await search.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 3));
  async function action(text: string) {
    await ui.keyboard.press('Meta+k');
    await ui.getByRole('combobox', { name: 'Search actions' }).fill(text);
    await ui.keyboard.press('Enter');
  }
  await action('Rename Group');
  const name = ui.getByLabel('Group Name', { exact: true });
  await expect(name).toBeFocused();
  await name.fill('Reading');
  await ui.keyboard.press('Meta+k'); await ui.keyboard.press('Escape');
  await expect(name).toBeFocused();
  await ui.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(ui.locator('.palette-footer .footer-title-label')).toHaveText('Tab Group: Reading');
  await expect(ui.locator('.operation-feedback')).toContainText('Group renamed');
  await expect(search).toBeFocused(); await expect(search).toHaveValue('Group');
  expect(await search.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 3]);
  await expect(lowerRow).toHaveAttribute('id', lowerId!);
  const lowerRowVisible = () => lowerRow.evaluate(node => {
    const row = node.getBoundingClientRect(), list = node.closest('.results')!.getBoundingClientRect();
    return row.top >= list.top - 1 && row.bottom <= list.bottom + 1;
  });
  expect(await lowerRowVisible()).toBe(true);
  await action('Rename Group');
  await ui.locator('.palette-footer .footer-back').click();
  await expect(search).toBeFocused(); await expect(lowerRow).toHaveAttribute('id', lowerId!);
  expect(await lowerRowVisible()).toBe(true);
  await worker.evaluate(ids => chrome.tabs.remove(ids), extraTabs);
  await ui.evaluate(() => window.dispatchEvent(new Event('focus')));
  await search.fill(''); await expect(ui.locator('.group-view .result')).toHaveCount(2);
  expect(await worker.evaluate(id => chrome.tabGroups.get(id), setup.id)).toMatchObject({ title: 'Reading', color: 'blue' });
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('justonehop-tab-group-en.png') });
  await action('Expand Group');
  expect((await worker.evaluate(id => chrome.tabGroups.get(id), setup.id)).collapsed).toBe(false);
  await search.fill('Beta');
  await action('Remove Tab from Group');
  await expect(ui.getByRole('option')).toHaveCount(0);
  expect((await worker.evaluate(id => chrome.tabs.get(id), setup.b)).groupId).toBe(-1);
  await search.fill('');
  await action('Rename Group');
  await ui.keyboard.press('Escape'); await expect(search).toBeFocused();
  await search.press('Backspace'); await expect(root).toBeFocused();
  await expect(root).toHaveValue('Research');
  await root.fill('Reading'); await ui.getByRole('option').filter({ hasText: 'Tab Group: Reading' }).click();
  // The footer chevron is the mouse path out of a layer: one click returns to the search that opened it.
  await ui.locator('.palette-footer .footer-back').click();
  await expect(root).toBeFocused(); await expect(root).toHaveValue('Reading');
  await root.fill('Reading'); await ui.getByRole('option').filter({ hasText: 'Tab Group: Reading' }).click();
  await action('Close Tab');
  await expect(ui.getByText('This tab group is no longer in this window.')).toBeVisible();
  await ui.keyboard.press('Escape'); await expect(root).toBeFocused();
});
});

test('Chinese Tab Group labels and compact footer stay usable', async () => {
  const group = await worker.evaluate(async origin => {
    const tab = await chrome.tabs.create({ url: `${origin}/中文资料`, active: false });
    const id = await chrome.tabs.group({ tabIds: [tab.id!] });
    await chrome.tabGroups.update(id, { title: '资料', color: 'green' }); return id;
  }, origin);
  const root = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
  await root.fill('资料');
  await ui.getByRole('option').filter({ hasText: '标签组: 资料' }).click();
  await ui.setViewportSize({ width: 750, height: 516 });
  const groupSearch = ui.getByRole('combobox', { name: '搜索组内标签页…' });
  await groupSearch.fill('127');
  await groupSearch.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 2));
  await ui.getByRole('option').first().click({ button: 'right' });
  await ui.getByRole('combobox', { name: '搜索操作' }).fill('close');
  await expect(ui.locator('.palette-footer .primary-action')).toHaveClass(/danger/);
  await ui.getByRole('combobox', { name: '搜索操作' }).fill('rename');
  await ui.keyboard.press('Enter');
  await expect(ui.getByLabel('标签组名称')).toBeFocused();
  await ui.keyboard.press('Escape');
  await expect(groupSearch).toBeFocused();
  expect(await groupSearch.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 2]);
  await groupSearch.fill('');
  await expect(ui.locator('.palette-footer .primary-action')).toBeInViewport();
  await ui.getByRole('button', { name: '打开操作菜单' }).click();
  await ui.getByRole('combobox', { name: '搜索操作' }).fill('重命名');
  await ui.keyboard.press('Enter');
  await expect(ui.getByLabel('标签组名称')).toBeFocused();
  await ui.getByLabel('标签组名称').fill('阅读资料');
  await ui.getByRole('button', { name: '保存', exact: true }).click();
  await expect(ui.locator('.palette-footer .footer-title-label')).toHaveText('标签组: 阅读资料');
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('justonehop-tab-group-zh.png') });
  await worker.evaluate(id => chrome.tabGroups.update(id, { title: '外部改名' }), group);
  // This headless Chrome does not reliably emit tabGroups.onUpdated for API edits.
  // Exercise the existing refresh-on-focus path used when returning to justonehop.
  await ui.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(ui.locator('.palette-footer .footer-title-label')).toHaveText('标签组: 外部改名');
  await ui.keyboard.press('Escape'); await expect(root).toBeFocused();
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English palette launch storage overlay Tab Group fits a narrow viewport', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Group-host`);
  await page.setViewportSize({ width: 390, height: 440 });
  await worker.evaluate(async origin => {
    const a = await chrome.tabs.create({ url: `${origin}/Group-member`, active: false });
    const id = await chrome.tabs.group({ tabIds: [a.id!] });
    await chrome.tabGroups.update(id, { title: 'Narrow', color: 'blue' });
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  }, origin);
  const surface = page.frameLocator('.justonehop-frame');
  await surface.getByRole('combobox').fill('Narrow');
  await surface.getByRole('option').filter({ hasText: 'Tab Group: Narrow' }).click();
  const primary = surface.locator('.palette-footer .primary-action');
  await expect(primary).toBeInViewport();
  expect(await surface.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('justonehop-tab-group-narrow.png') });
  await page.keyboard.press('Meta+k'); await page.keyboard.press('Escape');
  await expect(surface.getByRole('combobox', { name: 'Search tabs in this group…' })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' })).toBeFocused();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English Undo Tuck restores keyboard focus after a command keeps the palette open', async () => {
  const target = await worker.evaluate(async origin => {
    const tab = await chrome.tabs.create({ url: `${origin}/Undo-focus`, active: false });
    return { tabId: tab.id!, windowId: tab.windowId };
  }, origin);
  expect(await ui.evaluate(payload => chrome.runtime.sendMessage({ source: 'justonehop', type: 'execute', payload }), { action: 'tuck', ...target })).toMatchObject({ ok: true });
  const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await input.fill('undo tuck');
  await expect(ui.getByRole('option').first()).toContainText('Undo');
  await input.press('Enter');
  await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).groupId, target.tabId)).toBe(-1);
  await expect(input).toBeEnabled();
  await expect(input).toBeFocused();
  await ui.keyboard.press('Meta+a'); await ui.keyboard.type('settings');
  await expect(input).toHaveValue('settings');
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English palette launch storage overlay Undo Tuck restores typing after footer and menu actions', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Undo-overlay-host`);
  const target = await worker.evaluate(async origin => {
    const tab = await chrome.tabs.create({ url: `${origin}/Undo-overlay-target`, active: false });
    return { tabId: tab.id!, windowId: tab.windowId };
  }, origin);
  await worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  const surface = page.frameLocator('.justonehop-frame');
  const input = surface.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  for (const menu of [false, true]) {
    expect(await ui.evaluate(payload => chrome.runtime.sendMessage({ source: 'justonehop', type: 'execute', payload }), { action: 'tuck', ...target })).toMatchObject({ ok: true });
    await input.fill('undo tuck');
    await expect(surface.getByRole('option').first()).toContainText('Undo');
    if (menu) { await input.press('Meta+k'); await page.keyboard.press('Enter'); }
    else await surface.locator('.palette-footer .primary-action').click();
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).groupId, target.tabId)).toBe(-1);
    await expect(input).toBeFocused();
    await page.keyboard.press('Meta+a'); await page.keyboard.type('settings');
    await expect(input).toHaveValue('settings');
    await page.keyboard.press('Control+n');
    await expect(input).toBeFocused();
  }
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });

  async function seedManagementTabs(groupTitle?: string) {
    const seeded = await worker.evaluate(async ({ origin, groupTitle }) => {
      const first = await chrome.tabs.create({ url: `${origin}/Batch-fixture-Alpha`, active: false });
      const ids: [number, ...number[]] = [first.id!];
      for (const suffix of ['Beta', 'Gamma', 'Delta']) {
        const tab = await chrome.tabs.create({ url: `${origin}/Batch-fixture-${suffix}`, active: false });
        ids.push(tab.id!);
      }
      const groupId = groupTitle ? await chrome.tabs.group({ tabIds: ids }) : undefined;
      if (groupId !== undefined) await chrome.tabGroups.update(groupId, { title: groupTitle, color: 'blue' });
      return { ids, groupId };
    }, { origin, groupTitle });
    for (const id of seeded.ids) await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).status, id)).toBe('complete');
    await ui.reload();
    return seeded;
  }

  async function holdExecution() {
    await ui.evaluate(() => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      const state = { calls: 0, changes: 0, release: undefined as (() => void) | undefined };
      (globalThis as unknown as { __heldExecution: typeof state }).__heldExecution = state;
      const port = chrome.runtime.connect({ name: 'justonehop' });
      port.onMessage.addListener(message => { if (message.source === 'justonehop' && message.type === 'changed') state.changes++; });
      chrome.runtime.sendMessage = (async (request: { type?: string }) => {
        if (request.type === 'execute') {
          state.calls++;
          await new Promise<void>(resolve => { state.release = resolve; });
        }
        return original(request);
      }) as typeof chrome.runtime.sendMessage;
    });
  }
  const heldExecution = () => ui.evaluate(() => {
    const state = (globalThis as unknown as { __heldExecution: { calls: number; changes: number; release?: () => void } }).__heldExecution;
    return { calls: state.calls, changes: state.changes, held: !!state.release };
  });
  const releaseExecution = () => ui.evaluate(() => (globalThis as unknown as { __heldExecution: { release: () => void } }).__heldExecution.release());

  test('English keep-open failed mutation refreshes changes received while execution was pending', async () => {
    await seedManagementTabs();
    const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await input.fill('Batch fixture');
    const rows = ui.locator('#justonehop-results .result');
    await expect(rows).toHaveCount(4);
    const order = await rows.evaluateAll(nodes => nodes.map(node => node.id));
    const target = Number(order[1].split(':')[1]);
    await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 7));
    await ui.clock.install(); await ui.clock.pauseAt(new Date());
    await holdExecution();
    await ui.locator(`[id="${order[1]}"]`).click({ button: 'right' });
    await ui.locator('[id="justonehop-actions-action:close"]').click();
    await expect.poll(heldExecution).toMatchObject({ calls: 1, held: true });
    const changes = (await heldExecution()).changes;
    await worker.evaluate(id => chrome.tabs.remove(id), target);
    await expect.poll(async () => (await heldExecution()).changes).toBeGreaterThan(changes);
    await ui.clock.runFor(150);
    await releaseExecution();
    await expect(ui.getByRole('alert')).toBeVisible();
    await expect(rows).toHaveCount(3);
    await expect(ui.locator(`[id="${order[1]}"]`)).toHaveCount(0);
    await expect(ui.getByRole('dialog')).toHaveCount(0);
    await expect(ui.locator('#justonehop-results [aria-selected="true"]')).toHaveAttribute('id', order[2]);
    await expect(input).toHaveValue('Batch fixture');
    await expect(input).toBeFocused();
    expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 7]);
    await ui.keyboard.type('X'); await expect(input).toHaveValue('BaXixture');
    expect((await heldExecution()).calls).toBe(1);
  });

  test('English keep-open initial Retry cannot replace a newer snapshot with stale tab data', async () => {
    const { ids } = await seedManagementTabs();
    const target = ids[1];
    await ui.addInitScript(() => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      const state = { reads: 0, release: undefined as (() => void) | undefined };
      (globalThis as unknown as { __retrySnapshot: typeof state }).__retrySnapshot = state;
      chrome.runtime.sendMessage = (async (request: { type?: string }) => {
        if (request.type !== 'snapshot') return original(request);
        const read = ++state.reads;
        if (read === 1) return { ok: false, error: 'Initial snapshot fixture failure' };
        const response = await original(request);
        // Read the real old state now, but deliver it after a newer refresh.
        if (read === 2) await new Promise<void>(resolve => { state.release = resolve; });
        return response;
      }) as typeof chrome.runtime.sendMessage;
    });
    await ui.reload();
    await expect(ui.getByRole('alert')).toBeVisible();
    await ui.locator('.error-banner button').click();
    await expect.poll(() => ui.evaluate(() => typeof (globalThis as unknown as { __retrySnapshot: { release?: () => void } }).__retrySnapshot.release)).toBe('function');
    await worker.evaluate(id => chrome.tabs.remove(id), target);
    const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await input.fill('Batch fixture');
    await expect(ui.locator('#justonehop-results .result')).toHaveCount(3);
    await expect(ui.locator(`[id="justonehop-tab:${target}"]`)).toHaveCount(0);
    await ui.evaluate(() => (globalThis as unknown as { __retrySnapshot: { release: () => void } }).__retrySnapshot.release());
    // Flush promise continuations and React's next paint before checking stale delivery.
    await ui.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(ui.locator('#justonehop-results .result')).toHaveCount(3);
    await expect(ui.locator(`[id="justonehop-tab:${target}"]`)).toHaveCount(0);
    await expect(input).toHaveValue('Batch fixture');
    await expect(input).toBeFocused();
    expect(await worker.evaluate(async ids => (await chrome.tabs.query({})).filter(tab => ids.includes(tab.id!)).length, ids)).toBe(3);
  });

  test('English keep-open pending group mutation stays busy after Escape returns to root', async () => {
    const { ids } = await seedManagementTabs('Batch Research');
    const root = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await root.fill('Batch Research');
    await root.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 7));
    await ui.getByRole('option').filter({ hasText: 'Tab Group: Batch Research' }).click();
    await holdExecution();
    await ui.locator(`[id="group-tab:${ids[1]}"]`).click({ button: 'right' });
    await ui.locator('#group-actions-close').click();
    await expect.poll(heldExecution).toMatchObject({ calls: 1, held: true });
    await ui.keyboard.press('Escape'); await ui.keyboard.press('Escape');
    await expect(root).toBeVisible();
    await expect(root).toBeDisabled();
    await expect(ui.locator('.palette-footer .primary-action')).toBeDisabled();
    await expect(ui.getByRole('button', { name: 'Open action menu' })).toBeDisabled();
    await ui.keyboard.press('Enter');
    await ui.locator(`[id="justonehop-tab:${ids[2]}"]`).click();
    expect((await heldExecution()).calls).toBe(1);
    expect(await worker.evaluate(async ids => (await chrome.tabs.query({})).filter(tab => ids.includes(tab.id!)).length, ids)).toBe(4);
    await releaseExecution();
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(tab => tab.id === id), ids[1])).toBe(false);
    await expect(root).toBeEnabled(); await expect(root).toBeFocused();
    await expect(root).toHaveValue('Batch Research');
    expect(await root.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 7]);
    expect((await heldExecution()).calls).toBe(1);
    expect(await worker.evaluate(async ids => (await chrome.tabs.query({})).filter(tab => ids.includes(tab.id!)).length, ids)).toBe(3);
  });

  test('English keep-open root mouse close preserves query and selects next then previous neighbor through empty results', async () => {
    const { ids } = await seedManagementTabs();
    const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    const rows = ui.locator('#justonehop-results .result');
    await input.fill('Batch fixture');
    await expect(rows).toHaveCount(4);
    const order = await rows.evaluateAll(nodes => nodes.map(node => node.id));
    await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 7));
    // Close a middle row, then the last row, then drain the remaining results.
    // The expected neighbors come from the visible list before each mutation.
    const remaining = [...order];
    for (const index of [1, 2, 1, 0]) {
      const target = remaining[index];
      await ui.locator(`[id="${target}"]`).click({ button: 'right' });
      await ui.locator('[id="justonehop-actions-action:close"]').click();
      remaining.splice(index, 1);
      await expect(rows).toHaveCount(remaining.length);
      await expect(ui.getByRole('dialog')).toHaveCount(0);
      await expect(input).toHaveValue('Batch fixture');
      await expect(input).toBeFocused();
      expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 7]);
      await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(tab => tab.id === id), Number(target.split(':')[1]))).toBe(false);
      if (remaining.length) {
        await expect(ui.locator('#justonehop-results [aria-selected="true"]')).toHaveAttribute('id', remaining[Math.min(index, remaining.length - 1)]);
      } else {
        await expect(ui.getByText('No results found', { exact: true })).toBeVisible();
        await expect(ui.locator('.palette-footer .primary-action')).toBeDisabled();
        await expect(ui.getByRole('button', { name: 'Open action menu' })).toBeDisabled();
        await input.press('Enter');
        await expect(input).toBeFocused();
      }
    }
    expect(await worker.evaluate(async ids => (await chrome.tabs.query({})).filter(tab => ids.includes(tab.id!)), ids)).toEqual([]);
  });

  test('English keep-open root keyboard menu close restores caret and accepts continued typing', async () => {
    await seedManagementTabs();
    const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await input.fill('Batch fixture');
    await expect(ui.locator('#justonehop-results .result')).toHaveCount(4);
    const order = await ui.locator('#justonehop-results .result').evaluateAll(nodes => nodes.map(node => node.id));
    await input.press('ArrowDown');
    await expect(ui.locator('#justonehop-results [aria-selected="true"]')).toHaveAttribute('id', order[1]);
    await input.press('ArrowLeft');
    await input.press('Shift+ArrowLeft');
    await input.press('Shift+ArrowLeft');
    const caret = await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd]);
    expect(caret).toEqual([10, 12]);
    await input.press('Meta+k');
    await expect(ui.getByRole('combobox', { name: 'Search actions' })).toBeFocused();
    await ui.keyboard.type('close tab');
    await expect(ui.locator('#justonehop-actions [aria-selected="true"]')).toHaveAttribute('id', 'justonehop-actions-action:close');
    await ui.keyboard.press('Enter');
    await expect(ui.getByRole('dialog')).toHaveCount(0);
    await expect(ui.locator('#justonehop-results .result')).toHaveCount(3);
    await expect(ui.locator('#justonehop-results [aria-selected="true"]')).toHaveAttribute('id', order[2]);
    await expect(input).toHaveValue('Batch fixture');
    await expect(input).toBeFocused();
    expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual(caret);
    await ui.keyboard.type('X');
    await expect(input).toHaveValue('Batch fixture'.slice(0, 10) + 'X' + 'Batch fixture'.slice(12));
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(tab => tab.id === id), Number(order[1].split(':')[1]))).toBe(false);
  });

  test('English keep-open pin and mute refresh selected tab badges and inverse menu labels', async () => {
    const { ids } = await seedManagementTabs();
    const target = ids[1];
    const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    const row = ui.locator(`[id="justonehop-tab:${target}"]`);
    await input.fill('Batch fixture');
    await expect(ui.locator('#justonehop-results .result')).toHaveCount(4);
    for (const operation of [
      { action: 'pin', title: 'Pin Tab', inverse: 'Unpin Tab', badge: 'Pinned', value: true },
      { action: 'pin', title: 'Unpin Tab', inverse: 'Pin Tab', badge: 'Pinned', value: false },
      { action: 'mute', title: 'Mute Tab', inverse: 'Unmute Tab', badge: 'Muted', value: true },
      { action: 'mute', title: 'Unmute Tab', inverse: 'Mute Tab', badge: 'Muted', value: false },
    ]) {
      await row.click({ button: 'right' });
      const action = ui.locator(`[id="justonehop-actions-action:${operation.action}"]`);
      await expect(action).toContainText(operation.title);
      await action.click();
      await expect.poll(() => worker.evaluate(async ({ id, action }) => {
        const tab = await chrome.tabs.get(id); return action === 'pin' ? tab.pinned : tab.mutedInfo?.muted;
      }, { id: target, action: operation.action })).toBe(operation.value);
      await expect(ui.getByRole('dialog')).toHaveCount(0);
      await expect(input).toHaveValue('Batch fixture');
      await expect(input).toBeFocused();
      await expect(row).toHaveAttribute('aria-selected', 'true');
      await expect(row.getByLabel(operation.badge, { exact: true })).toHaveCount(operation.value ? 1 : 0);
      await input.press('Meta+k');
      await expect(action).toContainText(operation.inverse);
      await ui.keyboard.press('Escape');
      await expect(input).toBeFocused();
    }
  });

  test('English keep-open group close and ungroup retain query caret and next or previous neighbor', async () => {
    const { groupId } = await seedManagementTabs('Batch Research');
    const root = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await root.fill('Batch Research');
    await ui.getByRole('option').filter({ hasText: 'Tab Group: Batch Research' }).click();
    const input = ui.getByRole('combobox', { name: 'Search tabs in this group…' });
    await input.fill('Batch fixture');
    const rows = ui.locator('#justonehop-group-tabs .result');
    await expect(rows).toHaveCount(4);
    const order = await rows.evaluateAll(nodes => nodes.map(node => node.id));
    await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 7));
    await ui.locator(`[id="${order[1]}"]`).click({ button: 'right' });
    await ui.locator('#group-actions-close').click();
    await expect(rows).toHaveCount(3);
    await expect(ui.locator('#justonehop-group-tabs [aria-selected="true"]')).toHaveAttribute('id', order[2]);
    await expect(input).toHaveValue('Batch fixture');
    await expect(input).toBeFocused();
    expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 7]);
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(tab => tab.id === id), Number(order[1].split(':')[1]))).toBe(false);
    await input.press('ArrowDown');
    await expect(ui.locator('#justonehop-group-tabs [aria-selected="true"]')).toHaveAttribute('id', order[3]);
    await input.press('Meta+k');
    await ui.keyboard.type('remove tab from group');
    await ui.keyboard.press('Enter');
    await expect(rows).toHaveCount(2);
    await expect(ui.getByRole('dialog')).toHaveCount(0);
    await expect(ui.locator('#justonehop-group-tabs [aria-selected="true"]')).toHaveAttribute('id', order[2]);
    await expect(input).toHaveValue('Batch fixture');
    await expect(input).toBeFocused();
    expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 7]);
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).groupId, Number(order[3].split(':')[1]))).toBe(-1);
    expect(await worker.evaluate(async id => (await chrome.tabs.query({ groupId: id })).length, groupId!)).toBe(2);
    await ui.keyboard.type('X');
    await expect(input).toHaveValue('BaXixture');
    await ui.keyboard.press('Escape');
    await expect(root).toHaveValue('Batch Research');
    await expect(root).toBeFocused();
  });

  test('English human first palette right click targets the clicked result and restores typing', async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Mouse-A`);
  const b = await context.newPage(); await b.goto(`${origin}/Mouse-B`);
  await ui.bringToFront(); await ui.reload();
  const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await input.fill('Mouse');
  const row = ui.getByRole('option').filter({ hasText: 'Mouse A' });
  await row.click({ button: 'right' });
  await expect(ui.getByRole('dialog', { name: 'Actions', exact: true })).toBeVisible();
  await expect(ui.locator('.action-heading')).toContainText('Mouse A');
  await ui.keyboard.press('Escape');
  await expect(input).toBeFocused(); await expect(input).toHaveValue('Mouse');
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await input.press('Control+n');
  await expect(row).toHaveAttribute('aria-selected', 'false');
});
});
