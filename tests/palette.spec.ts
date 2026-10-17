import { test as base, expect, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
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
  headed: boolean;
  verticalTabs: boolean;
  vimium: boolean;
};
const defaults: Environment = { locale: 'zh-CN', shadow: 'closed', pageAccess: false,
  cookieDomains: false, commands: false, headed: false, verticalTabs: false, vimium: false };
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
  if (process.env.ZING_CHROMIUM_PATH) return process.env.ZING_CHROMIUM_PATH;
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
  test.skip(environment.vimium && !process.env.ZING_VIMIUM_PATH, 'Vimium compatibility requires ZING_VIMIUM_PATH pointing to an unpacked extension.');
  if (environment.vimium && environment.shadow === 'open') throw new Error('Vimium compatibility requires production closed shadow roots.');
  profile = await mkdtemp(join(tmpdir(), 'zing-e2e-'));
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
  const vimium = environment.vimium ? resolve(process.env.ZING_VIMIUM_PATH!) : undefined;
  if (vimium) {
    const manifest = JSON.parse(await readFile(join(vimium, 'manifest.json'), 'utf8'));
    expect(JSON.stringify(manifest), 'ZING_VIMIUM_PATH must identify Vimium').toMatch(/vimium/i);
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
  let zingWorker: Worker | undefined;
  await expect.poll(async () => {
    for (const candidate of context.serviceWorkers()) {
      const isZing = await candidate.evaluate(() => Boolean(chrome.runtime.getManifest().commands?.['toggle-palette'])).catch(() => false);
      if (isZing) { zingWorker = candidate; return true; }
    }
    return false;
  }).toBe(true);
  worker = zingWorker!;
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
        session: await chrome.storage.session.get(['zingPaletteWindow']),
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
    const search = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
    await expect(search).toBeFocused();
    await ui.keyboard.type(target.aliases[0]);
    const row = ui.locator(`[id="zing-command:${target.action}"]`);
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
    await expect(ui.locator('#zing-results [role="option"]').first()).toHaveAttribute('id', `zing-command:${target.action}`);
    await ui.locator('.palette-footer .primary-action').click();
    await expect.poll(() => ui.isClosed()).toBe(true);
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).active, first[0].id!)).toBe(true);
    expect(await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId })).map(tab => tab.id!).sort((a, b) => a - b), owner)).toEqual(beforeReuse);
    await expectChromePageLoaded(destination, target);
  });
});

for (const language of ['English', 'Chinese']) test.describe(() => {
  test.use({ environment: { ...defaults, locale: language === 'English' ? 'en-US' : 'zh-CN' } });
  test(`Chrome Pages: ${language} labels aliases and mixed right-click Escape footer flow preserve zing settings`, async () => {
    const en = language === 'English';
    const prefix = en ? 'Chrome Pages' : 'Chrome 内置页面';
    const search = ui.getByRole('combobox', { name: en ? 'Search commands, tabs, and bookmarks' : '搜索命令、标签页和书签' });
    const first = ui.locator('#zing-results [role="option"]').first();
    for (const target of chromePageCases) await expect(ui.locator(`[id="zing-command:${target.action}"]`)).toHaveCount(0);
    for (const category of ['Chrome Pages', 'Chrome 内置页面']) {
      await search.fill(category);
      for (const target of chromePageCases) {
        const row = ui.locator(`[id="zing-command:${target.action}"]`);
        await expect(row.locator('.entry-title')).toHaveText(`${prefix}: ${en ? target.en : target.zh}`);
        await expect(row.locator('.entry-shortcut')).toHaveCount(0);
      }
    }
    for (const target of chromePageCases) for (const alias of target.aliases) {
      await search.fill(alias);
      await expect(first).toHaveAttribute('id', `zing-command:${target.action}`);
      await expect(first.locator('.entry-title')).toHaveText(`${prefix}: ${en ? target.en : target.zh}`);
    }
    for (const query of ['Chrome Pages: downloads', 'Chrome 内置页面：下载']) {
      await search.fill(query);
      await expect(first).toHaveAttribute('id', 'zing-command:openDownloads');
      await expect(first.locator('mark')).not.toHaveCount(0);
    }

    const tabIds = await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => tab.id!).sort((a, b) => a - b));
    for (const query of ['settings', '设置', 'shortcut', '快捷键']) {
      await search.fill(query);
      await expect(first).toHaveAttribute('id', query === 'settings' || query === '设置' ? 'zing-command:settings' : 'zing-command:settings:keyboard');
      await search.press('Enter');
      await expect(ui.getByRole('region', { name: en ? 'Settings' : '设置', exact: true })).toBeVisible();
      await ui.keyboard.press('Escape');
      await expect(search).toBeFocused();
      await expect(search).toHaveValue(query);
    }
    expect(await worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => tab.id!).sort((a, b) => a - b))).toEqual(tabIds);

    await search.fill(prefix);
    await search.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
    const bookmarks = ui.locator('[id="zing-command:openBookmarks"]');
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
    await expect(page.locator('#zing-command-palette')).toBeAttached();
    expect(await page.locator('#zing-command-palette').evaluate(node => node.shadowRoot)).toBeNull();
    await expect.poll(async () => (await ax()).some(node => node.role?.value === 'combobox' && node.properties?.some(property => property.name === 'focused' && property.value.value === true))).toBe(true);
    await page.keyboard.type('downloads');
    await expect.poll(async () => (await ax()).some(node => node.role?.value === 'option' && node.name?.value.includes('Chrome Pages: Downloads'))).toBe(true);
    const created = context.waitForEvent('page');
    await page.keyboard.press('Enter');
    await expectChromePageLoaded(await created, { url: 'chrome://downloads/', root: 'downloads-manager' });
    await expect(page.locator('#zing-command-palette')).not.toBeAttached();
    const tabs = await worker.evaluate(async windowId => chrome.tabs.query({ windowId }), source.windowId);
    expect(tabs.filter(tab => tab.url === 'chrome://downloads/')).toHaveLength(1);
    expect(tabs.find(tab => tab.url === 'chrome://downloads/')).toMatchObject({ active: true, windowId: source.windowId });
    expect(tabs.find(tab => tab.id === source.tabId)).toMatchObject({ url: `${origin}/Chrome-Pages-overlay` });
    await session.detach();
  });
});

test('unified bilingual search, action menu, Esc and empty results', async () => {
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页和书签' });
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
  await expect(ui.locator('#zing-results [aria-selected="true"]')).toContainText('设置');
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
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页和书签' });
  await input.fill('OtherWindowUnique');
  await expect(ui.getByRole('option')).toHaveCount(0);
  await input.fill('Design');
  await expect(ui.getByRole('option')).toHaveCount(2);
  await input.fill('Design Notes');
  await expect(ui.getByRole('option')).toHaveCount(1);
  await input.press('Meta+k');
  const action = ui.getByRole('combobox', { name: '搜索操作' });
  await action.fill('mute');
  await expect(ui.locator('#zing-actions [aria-selected="true"]')).toContainText('静音');
  await action.press('Enter');
  await expect.poll(() => worker.evaluate(id => chrome.tabs.get(id).then(t => t.mutedInfo?.muted), target)).toBe(true);
  await expect(ui.getByRole('dialog')).toHaveCount(0);
  await expect(input).toHaveValue('Design Notes');
  await expect(input).toBeFocused();
});

test('bookmark opens a new tab in the same window', async () => {
  const sourceWindow = await ui.evaluate(async base => {
    await chrome.bookmarks.create({ title: 'BookmarkAcceptance', url: `${base}/Bookmarked` });
    return (await chrome.tabs.getCurrent())!.windowId;
  }, origin);
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页和书签' });
  await input.fill('BookmarkAcceptance');
  await expect(ui.getByRole('option')).toHaveCount(1);
  await input.press('Enter');
  await expect.poll(() => worker.evaluate(async args => {
    const found = await chrome.tabs.query({ windowId: args.id });
    return found.some(t => t.url === `${args.origin}/Bookmarked`);
  }, { id: sourceWindow, origin })).toBe(true);
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
  await ui.getByRole('combobox', { name: '搜索命令、标签页和书签' }).fill('close other');
  await expect(ui.locator('#zing-results [aria-selected="true"]')).toContainText('关闭其他');
  await ui.keyboard.press('Enter');
  await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(t => t.id === id), seed.disposable)).toBe(false);
  const survivors = await worker.evaluate(async () => (await chrome.tabs.query({})).map(t => t.id));
  expect(survivors).toContain(seed.pinned); expect(survivors).toContain(seed.other);
  await expect(ui.getByRole('combobox', { name: '搜索命令、标签页和书签' })).toHaveValue('close other');
  await expect(ui.getByRole('combobox', { name: '搜索命令、标签页和书签' })).toBeFocused();
  await expect(ui.getByRole('dialog')).toHaveCount(0);
  const restorable = await ui.evaluate(async base => (await chrome.tabs.create({ url: `${base}/Restore-Target`, active: false })).id!, origin);
  await expect.poll(() => worker.evaluate(id => chrome.tabs.get(id).then(tab => tab.status), restorable)).toBe('complete');
  await ui.evaluate(id => chrome.tabs.remove(id), restorable);
  await ui.getByRole('combobox', { name: '搜索命令、标签页和书签' }).fill('restore');
  await expect(ui.locator('#zing-results [aria-selected="true"]')).toContainText('恢复');
  await ui.keyboard.press('Enter');
  await expect.poll(() => worker.evaluate(async base => (await chrome.tabs.query({})).some(t => t.url === `${base}/Restore-Target`), origin)).toBe(true);
});

test('IME Enter does not execute and the popup has no horizontal overflow', async () => {
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页和书签' });
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
    await chrome.tabs.sendMessage(id, { source: 'zing', type: 'toggle' });
  }, tabId);
  await expect(page.locator('#zing-command-palette')).toBeAttached();
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
  await expect(page.locator('#zing-command-palette')).not.toBeAttached();
  await expect(page.getByRole('textbox', { name: 'Page input' })).toBeFocused();
  await page.keyboard.type('-after');
  await expect(page.getByRole('textbox', { name: 'Page input' })).toHaveValue('before-after');
  const tabCount = await worker.evaluate(() => chrome.tabs.query({}).then(tabs => tabs.length));
  await worker.evaluate(id => chrome.tabs.sendMessage(id, { source: 'zing', type: 'toggle' }), tabId);
  await expect.poll(comboValue).toBe('');
  await page.keyboard.type('new');
  await expect.poll(comboValue).toBe('new');
  await page.keyboard.press('Enter');
  await expect.poll(() => worker.evaluate(() => chrome.tabs.query({}).then(tabs => tabs.length))).toBe(tabCount + 1);
  await expect(page.locator('#zing-command-palette')).not.toBeAttached();
});
});

test('Raycast navigation pages, jumps sections and restores caret when actions close', async () => {
  await ui.evaluate(async base => {
    for (let i = 0; i < 12; i++) await chrome.tabs.create({ url: `${base}/Navigation-${i}`, active: false });
    await chrome.bookmarks.create({ title: 'Navigation Bookmark', url: `${base}/Navigation-Bookmark` });
  }, origin);
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页和书签' });
  await input.fill('');
  await expect(ui.locator('.section-start')).toHaveCount(1);
  await input.press('Meta+ArrowUp');
  await expect(ui.locator('.result').first()).toHaveAttribute('aria-selected', 'true');
  await input.press('Meta+ArrowDown');
  await expect(ui.locator('#zing-results [aria-selected="true"]')).toContainText('新建');
  await input.press('Meta+ArrowUp');
  await expect(ui.locator('#zing-results [aria-selected="true"]')).toHaveAttribute('id', await ui.locator('.result').first().getAttribute('id') as string);
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
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页和书签' });
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
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页和书签' });
  await ui.evaluate(async base => {
    await chrome.tabs.create({ url: `${base}/Design-System`, active: false });
    await chrome.bookmarks.create({ title: 'Raycast Manual', url: 'https://manual.raycast.com' });
  }, origin);
  await ui.setViewportSize({ width: 750, height: 516 });
  for (const theme of ['light', 'dark'] as const) {
    await ui.emulateMedia({ colorScheme: theme });
    await input.fill('');
    expect((await ui.locator('.result').first().boundingBox())!.height).toBe(40);
    await expect(ui.locator('.section-start')).toHaveCount(1);
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
    const input = ui.getByRole('combobox', { name: chinese ? '搜索命令、标签页和书签' : 'Search commands, tabs, and bookmarks' });
    await expect(input).toBeFocused();
    expect(await ui.evaluate(() => chrome.runtime.getManifest().name)).toBe('zing');
    await expect(ui.locator('.navigation-label')).toHaveText(chinese ? ['上一个', '下一个'] : ['Previous', 'Next']);
    if (!chinese) expect(await ui.locator('.zing-app').innerText()).not.toMatch(/[\p{Script=Han}]/u);
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
    await ui.locator('.zing-app').evaluate(node => { node.classList.replace('popup', 'overlay'); document.body.style.width = '390px'; });
    const footer = await ui.locator('.footer').boundingBox();
    const button = await ui.getByRole('button', { name: chinese ? '打开操作菜单' : 'Open action menu' }).boundingBox();
    expect(button!.x + button!.width).toBeLessThanOrEqual(footer!.x + footer!.width);
    await ui.locator('.palette').screenshot({ path: test.info().outputPath(`i18n-${variant.toLowerCase()}.png`) });
  });
  });
}

test('settings language and theme persist, synchronize, and preserve search focus', async () => {
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页和书签' });
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
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ preferences: { language: string } }>('preferences')).preferences.language)).toBe('en');
  await ui.emulateMedia({ colorScheme: 'light' });
  const theme = ui.getByRole('combobox', { name: 'Theme', exact: true });
  await theme.click();
  await ui.getByRole('option', { name: 'Dark', exact: true }).click();
  await expect(ui.locator('.zing-app')).toHaveAttribute('data-theme', 'dark');
  await expect(ui.locator('.palette')).toHaveCSS('background-color', 'rgb(41, 42, 45)');
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('settings-dark.png') });
  await theme.press('Escape');
  const englishInput = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
  await expect(englishInput).toHaveValue('reload');
  await expect(englishInput).toBeFocused();
  expect(await englishInput.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 5]);
  await expect(ui.locator('.result[aria-selected="true"]')).toContainText('Reload Current Tab');
  // A fresh UI reads stored preferences before its first paint.
  const second = await context.newPage(); await second.goto(popupUrl);
  await expect(second.locator('.zing-app')).toHaveAttribute('lang', 'en');
  await expect(second.locator('.zing-app')).toHaveAttribute('data-theme', 'dark');
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
  await second.reload();
  await expect(second.locator('.zing-app')).toHaveAttribute('lang', 'zh-CN');
  await expect(second.locator('.zing-app')).toHaveAttribute('data-theme', 'system');
  await second.close();
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English settings entries, narrow layout and Chrome hotkey settings', async () => {
  const input = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
  const mainFooter = await ui.locator('.palette-footer').boundingBox();
  const mainHeader = await ui.locator('.search-bar').boundingBox();
  await input.fill('设置');
  await expect(ui.locator('.result').first()).toContainText('Settings');
  await input.press('Enter');
  await expect(ui.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  await expect(ui.locator('[data-setting="keyboard"] .hotkey-value')).toHaveText(await worker.evaluate(async () => (await chrome.commands.getAll()).find(c => c.name === 'toggle-palette')!.shortcut!));
  await expect(ui.locator('[data-setting="binding"] .hotkey-value')).toHaveText('⌃Tab');
  await expect(ui.locator('[data-setting="binding"] p')).toContainText('Ctrl+Tab');
  await expect(ui.locator('[data-setting="keyboard"] .hotkey-value')).toHaveAttribute('title', /(?:Shift \+ Command|Command \+ Shift) \+ P — Open \/ Close zing/);
  await expect(ui.locator('[data-setting="binding"] .hotkey-value')).toHaveAttribute('title', 'Control + Tab (Ctrl+Tab) — Set up Ctrl+Tab to switch recent tabs with a one-time snippet.');
  await expect(ui.locator('[data-setting="binding"] .hotkey-value')).toHaveAttribute('aria-label', /Control \+ Tab.*Set up Ctrl\+Tab/);
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
  await expect(experiments.getByRole('switch')).toHaveCount(1);
  await expect(experiments.getByRole('button')).toHaveText(['Reset Ranking', 'Manage Scripts']);
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
  const controls = [header.locator('.search-dismiss'), language, theme, ui.getByRole('button', { name: 'Change in Chrome' }),
    ui.getByRole('button', { name: 'Set Up', exact: true }), experiments.getByRole('switch'),
    experiments.getByRole('button', { name: 'Reset Ranking' }), experiments.getByRole('button', { name: 'Manage Scripts' }),
    ui.locator('.footer-back'), settingsSearch];
  for (const control of controls) { await ui.keyboard.press('Tab'); await expect(control).toBeFocused(); }
  await ui.keyboard.press('Shift+Tab');
  await expect(ui.locator('.footer-back')).toBeFocused();
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
  await settingsSearch.fill('scripts');
  await ui.getByRole('button', { name: 'Manage Scripts' }).click();
  await expect(ui.getByRole('combobox', { name: 'Search scripts' })).toBeVisible();
  await ui.keyboard.press('Escape');
  await expect(settingsSearch).toHaveValue('scripts');
  await expect(ui.getByRole('button', { name: 'Manage Scripts' })).toBeFocused();
  await header.getByRole('button', { name: 'Clear search' }).click();
  await ui.keyboard.press('Escape');
  for (const [query, role, name] of [
    ['language', 'combobox', 'Language'], ['theme', 'combobox', 'Theme'],
    ['hotkey', 'button', 'Change in Chrome'], ['search ranking', 'button', 'Reset Ranking'],
    ['auto tuck', 'switch', 'Auto Tuck Idle Tabs'],
  ] as const) {
    await input.fill(query); await input.press('Enter');
    await expect(ui.getByRole(role, { name, exact: true })).toBeFocused();
    await ui.keyboard.press('Escape');
    await expect(input).toHaveValue(query);
  }
  await ui.locator('.settings-button').click();
  await ui.setViewportSize({ width: 390, height: 400 });
  await ui.locator('.zing-app').evaluate(node => { node.classList.replace('popup', 'overlay'); document.body.style.width = '390px'; });
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
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页和书签' });
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
    await chrome.tabs.sendMessage(id, { source: 'zing', type: 'toggle' });
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
  await page.keyboard.press('Shift+Tab');
  await expect.poll(async () => (await ax()).some(n => n.role?.value === 'button' && n.name?.value === '返回' && n.properties?.some(p => p.name === 'focused' && p.value.value === true))).toBe(true);
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
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('preferences')).preferences)).toEqual({ language: 'en', theme: 'dark', autoTuck: false });
  await page.screenshot({ path: test.info().outputPath('settings-overlay.png') });
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await ax()).find(n => n.role?.value === 'combobox')?.value?.value).toBe('reload');
  await page.keyboard.press('Escape');
  await expect(page.locator('#zing-command-palette')).not.toBeAttached();
  await expect(page.getByRole('textbox', { name: 'Page input' })).toBeFocused();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English settings report failed saves and allow retry without losing current preferences', async () => {
  await ui.getByRole('button', { name: 'Settings', exact: true }).click();
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
  await language.click();
  await ui.getByRole('option', { name: '简体中文', exact: true }).click();
  await expect(ui.getByRole('region', { name: '设置', exact: true })).toBeVisible();
  await expect(ui.getByRole('alert')).toHaveCount(0);
});
});

test('unified results mix tabs bookmarks and commands; recent tabs switch with Enter', async () => {
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
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页和书签' });
  await expect(input).toHaveValue('');
  await expect(ui.locator('.result').first()).toHaveAttribute('id', `zing-tab:${seed.newer}`);
  await expect(ui.locator('.result.danger')).toHaveCount(0);
  await input.fill('new tab');
  await expect(ui.locator('.result.tab')).toHaveCount(2);
  await expect(ui.locator('.result.bookmark')).toHaveCount(1);
  await expect(ui.locator('.result.command')).toContainText('新建标签页');
  await expect(ui.locator('.result').first()).toHaveAttribute('id', 'zing-command:newTab');
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
  await input.fill('');
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
  const input = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
  await input.fill('new tab');
  await expect(ui.locator('.result.tab')).toHaveCount(1);
  await expect(ui.locator('.result.bookmark')).toHaveCount(1);
  await expect(ui.locator('.result').first()).toHaveAttribute('id', 'zing-command:newTab');
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
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页和书签' });
  await input.fill('new tab');
  const command = ui.locator('.result.command').first();
  await expect(command.locator('.entry-title')).toHaveText('标签页: 新建标签页');
  await expect(command.locator('.entry-subtitle mark')).toHaveText(['new', 'tab']);
  await expect(ui.locator('.result.tab .entry-title mark')).toHaveText(['New', 'Tab']);
  await expect(ui.locator('.result').first()).toHaveAttribute('aria-selected', 'true');
  for (const theme of ['light', 'dark']) {
    await ui.evaluate(async theme => { await chrome.storage.local.set({ preferences: { language: 'zh', theme } }); }, theme);
    await expect(ui.locator('.zing-app')).toHaveAttribute('data-theme', theme);
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
  await expect(ui.locator('.action-row mark')).toHaveText(['关闭', '关闭', '关闭']);
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
  const input = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
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
  const input = ui.getByRole('combobox', { name: chinese ? '搜索命令、标签页和书签' : 'Search commands, tabs, and bookmarks' });
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
  await expect(ui.locator('.result').first()).toHaveAttribute('id', 'zing-command:newTab');
  await input.fill('reloda');
  await expect(ui.locator('.result').first()).toHaveAttribute('id', 'zing-command:reload');
  if (chinese) {
    await expect(ui.locator('.result').first().locator('.entry-subtitle')).toHaveText('reload');
    await expect(ui.locator('.result').first().locator('.entry-subtitle mark').first()).toBeVisible();
  }
  await input.fill('cl');
  await expect(ui.locator('.result.danger')).toHaveCount(0);
  await input.pressSequentially('o');
  await expect(ui.locator('.result').first()).toHaveAttribute('id', 'zing-command:close');
  await expect(ui.locator('.result.danger')).toHaveCount(3);
  await expect(ui.locator('.result').first().locator('mark').first()).toHaveText(chinese ? 'clo' : 'Clo');
  for (const [query, action] of [['tab clo', 'close'], ['clo oth', 'closeOthers'], ['tab clo ri', 'closeRight'], ['guan', 'close'], ['关闭', 'close'], ['reload ext', 'reloadExtension']]) {
    await input.fill(query);
    await expect(ui.locator('.result').first()).toHaveAttribute('id', `zing-command:${action}`);
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
    const input = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
    await expect(input).toBeFocused();
    await input.fill('iam');
    return input;
  };
  const input = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
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
  const input = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
  await input.fill('new tab');
  await input.press('ArrowDown'); // Highlighting alone is not a selection.
  // window.close() can destroy the target between Escape keydown and keyup.
  await ui.keyboard.press('Escape').catch(error => { if (!ui.isClosed()) throw error; });
  await expect.poll(() => ui.isClosed()).toBe(true);
  expect(await worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage)).toBeUndefined();
  ui = await context.newPage(); await ui.goto(popupUrl);
  const response = await ui.evaluate(async () => {
    const self = (await chrome.tabs.getCurrent())!;
    return chrome.runtime.sendMessage({ source: 'zing', type: 'execute', payload: { action: 'switch', windowId: self.windowId, tabId: 999999, query: 'iam' } });
  });
  expect(response.ok).toBe(false);
  expect(await worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage)).toBeUndefined();
  await ui.getByRole('combobox').fill('language');
  await ui.getByRole('combobox').press('Enter');
  await expect(ui.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage?.[0]?.target)).toBe('command:settings');
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
    await chrome.tabs.sendMessage(id, { source: 'zing', type: 'toggle' });
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
  await expect(page.locator('#zing-command-palette')).not.toBeAttached();
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
    await expect(page.locator('#zing-command-palette')).toBeAttached();
    expect(await page.locator('#zing-command-palette').evaluate(node => node.shadowRoot)).toBeNull();
    const cdp = await context.newCDPSession(page);
    const ax = async () => {
      const { frameTree } = await cdp.send('Page.getFrameTree');
      const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
      return (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes;
    };
    const combo = async (name: string) => (await ax()).find(node => node.role?.value === 'combobox' && node.name?.value === name);
    const rootName = 'Search commands, tabs, and bookmarks';
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
      await expect(page.locator('#zing-command-palette')).toBeAttached();
      expect(await worker.evaluate(id => chrome.tabs.get(id), seeded.host)).toMatchObject({ active: true, url: `${origin}/Closed-keyboard-host` });
      await page.keyboard.press('Meta+a');
      await page.keyboard.type(target === seeded.first ? 'Closed target Beta' : 'settings');
    }
    await expect.poll(async () => (await combo(rootName))?.value?.value).toBe('settings');
    expect(page.isClosed()).toBe(false);
    await cdp.detach();
  });
});

for (const language of ['Chinese', 'English']) test.describe(() => {
  test.use({ environment: { ...defaults, locale: language === 'English' ? 'en-US' : 'zh-CN' } });
  test(`${language} home commands learn from search, home and actions while preserving recent tabs`, async () => {
  const chinese = language === 'Chinese';
  const target = await context.newPage(); await target.goto(`${origin}/Home-fixture`);
  await ui.bringToFront();
  const commandIds = () => ui.locator('.result.command').evaluateAll(nodes => nodes.map(node => node.id));
  const tabIds = () => ui.locator('.result.tab').evaluateAll(nodes => nodes.map(node => node.id));
  await expect(ui.locator('.result.tab .entry-title')).toContainText(['Home fixture']);
  const recentTabs = await tabIds();
  const defaultCommands = await commandIds();
  // Searched commands contribute to home ranking without a separate training copy.
  await ui.getByRole('combobox').fill('language');
  await ui.getByRole('combobox').press('Enter');
  await expect(ui.getByRole('region', { name: chinese ? '设置' : 'Settings', exact: true })).toBeVisible();
  await ui.keyboard.press('Escape');
  await ui.getByRole('combobox').fill('');
  await expect(ui.locator('.result.command').first()).toHaveAttribute('id', 'zing-command:settings');
  expect(await tabIds()).toEqual(recentTabs);
  // Executing from the home list itself keeps learning, even with an empty query.
  await ui.locator('#zing-command\\:settings').click();
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage'))
    .searchUsage?.find(record => record.query === '' && record.target === 'command:settings')?.weight)).toBe(1);
  await ui.keyboard.press('Escape');
  await ui.getByRole('combobox').fill('Home fixture');
  await ui.getByRole('combobox').press('Meta+k');
  const actions = ui.getByRole('combobox', { name: chinese ? '搜索操作' : 'Search actions' });
  await actions.fill('mute');
  await expect(ui.locator('.action-row').first()).toContainText(chinese ? '静音' : 'Mute');
  await actions.press('Enter');
  await expect(ui.getByRole('dialog')).toHaveCount(0);
  await expect(ui.getByRole('combobox')).toHaveValue('Home fixture');
  await expect(ui.getByRole('combobox')).toBeFocused();
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage'))
    .searchUsage?.find(record => record.target === 'command:mute')?.query)).toBe('');
  // A secondary action must not train a result for the original page-title query.
  expect(await worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage'))
    .searchUsage?.some(record => record.query === 'home fixture'))).toBe(false);
  await ui.getByRole('combobox').fill('');
  await expect(ui.locator('.result.command').first()).toHaveAttribute('id', 'zing-command:settings');
  await expect(ui.locator('.result.command').nth(1)).toHaveAttribute('id', 'zing-command:mute');
  await expect(ui.locator('.result').first()).toHaveClass(/tab/);
  const beforeReload = await commandIds();
  await ui.reload();
  await expect(ui.locator('.result.command')).toHaveCount(9);
  expect(await commandIds()).toEqual(beforeReload);
  await ui.locator('.palette').screenshot({ path: test.info().outputPath(`home-habits-${language.toLowerCase()}.png`) });
  const beforeReset = await tabIds();
  await ui.getByRole('button', { name: chinese ? '设置' : 'Settings', exact: true }).click();
  await ui.getByRole('button', { name: chinese ? '重置搜索排序' : 'Reset Ranking', exact: true }).click();
  await expect(ui.getByRole('status')).toBeVisible();
  await expect(ui.getByRole('button', { name: chinese ? '重置搜索排序' : 'Reset Ranking', exact: true })).toBeFocused();
  await ui.keyboard.press('Escape');
  await expect.poll(commandIds).toEqual(defaultCommands);
  expect(await tabIds()).toEqual(beforeReset);
});
});

for (const language of ['Chinese', 'English']) test.describe(() => {
  test.use({ environment: { ...defaults, locale: language === 'English' ? 'en-US' : 'zh-CN' } });
  test(`${language} quiet layout exposes Ctrl P N navigation in results and actions at narrow widths`, async () => {
  const chinese = language === 'Chinese';
  const page = await context.newPage(); await page.goto(`${origin}/Navigation-fixture`);
  await ui.bringToFront();
  const input = ui.getByRole('combobox');
  await expect(ui.locator('.result.tab .entry-title')).toContainText(['Navigation fixture']);
  await expect(ui.locator('.list-heading, .section-heading, .context-hint, .kind-label')).toHaveCount(0);
  await expect(ui.locator('.section-start')).toHaveCount(1);
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
  await input.fill('');
  for (const theme of ['light', 'dark'] as const) {
    await ui.emulateMedia({ colorScheme: theme });
    await ui.locator('.palette').screenshot({ path: test.info().outputPath(`quiet-${language.toLowerCase()}-${theme}.png`) });
  }
  await ui.setViewportSize({ width: 390, height: 600 });
  await ui.locator('.zing-app').evaluate(node => { node.classList.replace('popup', 'overlay'); document.body.style.width = '390px'; });
  await expect(ui.locator('.navigation-hint')).toBeHidden();
  await expect(ui.locator('.palette-footer-title')).toHaveText('zing');
  await expect(ui.locator('.footer-navigation')).toHaveAccessibleName(chinese ? '设置' : 'Settings');
  expect(await ui.locator('.footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  const locationBox = await ui.locator('.palette-footer-location').boundingBox(), actionsBox = await ui.locator('.footer-actions').boundingBox();
  expect(locationBox!.x + locationBox!.width).toBeLessThanOrEqual(actionsBox!.x);
  await input.press('Control+n');
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
  await ui.locator('.palette').screenshot({ path: test.info().outputPath(`quiet-${language.toLowerCase()}-narrow.png`) });
});
});

async function openStorageOverlay(page: Page) {
  await page.bringToFront();
  const id = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, page.url());
  await worker.evaluate(async tabId => {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, { source: 'zing', type: 'toggle' });
  }, id);
  const surface = page.frameLocator('.zing-frame');
  await expect(surface.locator('.result.command')).toHaveCount(9);
  return surface;
}

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
  await expect(surface.locator('.result.tab')).toHaveCount(6);
  await expect(surface.locator(`[id="zing-tab:${sourceId}"] .current-badge`)).toHaveText(language === 'English' ? 'Current' : '当前');
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
    expect(main.row.height).toBe(40);
    expect(main.panel.height).toBeLessThanOrEqual(516);
    await root.press('Enter');
    await expect(surface.locator('.storage-row')).toHaveCount(1);
    const storage = await geometry();
    await surface.locator('.palette-footer').screenshot({ path: test.info().outputPath(`footer-storage-${language}-${size.width}x${size.height}.png`) });
    for (const key of ['panel', 'footer', 'search', 'row', 'icon', 'title', 'navigation', 'footerTitle', 'footerType', 'contextType'] as const) expect(storage[key]).toEqual(main[key]);
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
  await expect(input).toBeFocused();
  await input.press('Control+n');
  await expect(surface.locator('.storage-row[aria-selected="true"]')).toContainText('empty');
  await input.press('Enter');
  await expect(surface.locator('.storage-notice')).toContainText(chinese ? '已复制值' : 'Value copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('');
  await input.press('Control+p');
  await input.fill('config');
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
  await rootInput.fill('session storage'); await rootInput.press('Enter');
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
  await expect(surface.locator('.storage-row')).toContainText('updated-value');
  await expect(input).toBeFocused();
  await input.press('Enter'); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('updated-value');
  await input.press('Escape'); await rootInput.fill('session storage'); await rootInput.press('Enter');
  await expect(surface.locator('.storage-row')).toHaveCount(1);
  await expect(surface.locator('.storage-row')).toContainText('source-session');
  await input.press('Enter'); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('source-session');
  await input.press('Escape'); await rootInput.press('Escape');
  await expect(page.locator('#zing-command-palette')).not.toBeAttached();
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
    await chrome.tabs.sendMessage(tabId, { source: 'zing', type: 'toggle' });
  }, id);
  const cdp = await context.newCDPSession(page);
  const ax = async () => {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
    return (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes;
  };
  const combo = async () => (await ax()).find(node => node.role?.value === 'combobox');
  await expect.poll(async () => (await combo())?.name?.value).toBe('Search commands, tabs, and bookmarks');
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
  await expect.poll(async () => (await combo())?.name?.value).toBe('Search commands, tabs, and bookmarks');
  await expect.poll(async () => (await combo())?.value?.value).toBe('local storage');
  await page.keyboard.press('Escape');
  await expect(page.locator('#zing-command-palette')).not.toBeAttached();
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
  const denied = await ui.evaluate(payload => chrome.runtime.sendMessage({ source: 'zing', type: 'read-page-storage', payload: { ...payload, kind: 'cookies', query: 'cookie' } }), target);
  expect(denied).toEqual({ ok: false, error: 'Allow access to this website to view its cookies.' });
  const opened = context.waitForEvent('page');
  await ui.evaluate(payload => chrome.runtime.sendMessage({ source: 'zing', type: 'open-cookie-access', payload }), target);
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
  await ui.evaluate(payload => chrome.runtime.sendMessage({ source: 'zing', type: 'open-cookie-access', payload }), target);
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
  const reply = await ui.evaluate(payload => chrome.runtime.sendMessage({ source: 'zing', type: 'read-page-storage', payload }), target);
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
  await expect(popup.page.locator('.palette-footer-title')).toHaveText('Switch Recent Tabs');
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
  await expect(popup.locator('.palette-footer-title')).toHaveText('Switch Recent Tabs');
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

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English script library preview selects without activation and copies exact code', async () => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const alpha = 'globalThis.__zingPreviewExecuted = true;\nconst text = "<script> & 中文";\n\n';
  const beta = 'globalThis.__zingPreviewExecuted = true;\n  "Beta keeps indentation";\n\n';
  await worker.evaluate(({ alpha, beta }) => chrome.storage.local.set({
    'saved-script:preview-alpha': { title: 'Preview alpha', code: alpha },
    'saved-script:preview-beta': { title: 'Preview beta', code: beta },
  }), { alpha, beta });
  await ui.evaluate(async () => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    const scope = window as unknown as { previewRunRequests: number };
    scope.previewRunRequests = 0;
    chrome.runtime.sendMessage = ((request: { type?: string }) => {
      if (request.type === 'run-saved-script') scope.previewRunRequests++;
      return send(request);
    }) as typeof chrome.runtime.sendMessage;
    await navigator.clipboard.writeText('clipboard before preview');
  });
  await ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' }).fill('manage scripts');
  await ui.keyboard.press('Enter');
  const search = ui.getByRole('combobox', { name: 'Search scripts' });
  const preview = ui.getByRole('region', { name: 'Code Preview', exact: true });
  const code = preview.locator('.script-preview-code');
  const primary = ui.locator('.palette-footer .primary-action');
  const first = ui.getByRole('option', { name: 'Preview alpha', exact: true });
  const second = ui.getByRole('option', { name: 'Preview beta', exact: true });
  await search.fill('Preview');
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(code).toHaveValue(alpha);
  await expect(code).toHaveAttribute('readonly', '');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAccessibleName('Code Preview');
  await expect(primary).toHaveAccessibleName('Copy Code');

  // A click changes the preview only; pointer motion must not steal its target.
  await second.click();
  await expect(second).toHaveAttribute('aria-selected', 'true');
  await expect(code).toHaveValue(beta);
  await expect(preview.locator('.script-preview-info')).toContainText('Name');
  await expect(preview.locator('.script-preview-info')).toContainText('Preview beta');
  await expect(preview.locator('.script-preview-info')).toContainText('Content Type');
  await expect(preview.locator('.script-preview-info')).toContainText('JavaScript');
  await first.hover(); await second.hover(); await first.hover();
  await expect(second).toHaveAttribute('aria-selected', 'true');
  await expect(code).toHaveValue(beta);
  await expect(ui.locator('.script-editor-body, .script-run-status, .script-output')).toHaveCount(0);
  expect(await ui.evaluate(() => navigator.clipboard.readText())).toBe('clipboard before preview');
  await search.press('ArrowUp');
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(code).toHaveValue(alpha);
  await search.press('ArrowDown');
  await expect(second).toHaveAttribute('aria-selected', 'true');
  await search.press('Control+p');
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await search.press('Control+n');
  await expect(second).toHaveAttribute('aria-selected', 'true');
  await expect(search).toHaveAttribute('aria-activedescendant', (await second.getAttribute('id'))!);
  await search.press('Shift+Enter'); await search.press('Meta+Enter');
  expect(await ui.evaluate(() => navigator.clipboard.readText())).toBe('clipboard before preview');
  await search.press('Enter');
  await expect(ui.getByRole('status')).toContainText('Code copied');
  expect(await ui.evaluate(() => navigator.clipboard.readText())).toBe(beta);
  await expect(search).toBeFocused();
  await first.click(); await primary.click();
  expect(await ui.evaluate(() => navigator.clipboard.readText())).toBe(alpha);
  await code.focus(); await expect(code).toBeFocused();
  expect(await code.evaluate(node => getComputedStyle(node).userSelect)).not.toBe('none');
  await expect(ui.locator('.script-editor-body')).toHaveCount(0);

  // Menu editing returns to the same filtered target and input selection.
  await search.focus();
  await search.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
  await ui.locator('.palette-footer .actions-button').click();
  await ui.getByRole('option', { name: 'Edit Script', exact: true }).click();
  await expect(ui.getByLabel('Name', { exact: true })).toHaveValue('Preview alpha');
  await expect(ui.getByLabel('JavaScript code')).toHaveValue(alpha);
  await ui.keyboard.press('Escape');
  await expect(search).toBeFocused(); await expect(search).toHaveValue('Preview');
  expect(await search.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(code).toHaveValue(alpha);
  await search.fill('no matching script');
  await expect(ui.locator('.script-item')).toHaveCount(0);
  await expect(code).toHaveCount(0);
  await expect(ui.locator('.script-preview-info')).toHaveCount(0);
  await expect(primary).toBeDisabled();
  await expect(search).not.toHaveAttribute('aria-activedescendant', /.+/);
  await search.press('Enter');
  expect(await ui.evaluate(() => navigator.clipboard.readText())).toBe(alpha);

  // Built-in setup is previewable and reaches its read-only instructions via Actions.
  await search.fill('Ctrl+Tab');
  await expect(code).toBeVisible();
  await ui.locator('.palette-footer .actions-button').click();
  await expect(ui.getByRole('dialog').getByRole('option', { name: 'Edit Script', exact: true })).toHaveCount(0);
  await ui.getByRole('option', { name: 'View Setup Instructions', exact: true }).click();
  await expect(ui.getByLabel('JavaScript code')).toHaveAttribute('readonly', '');
  await ui.keyboard.press('Escape');
  await expect(search).toHaveValue('Ctrl+Tab');
  expect(await ui.evaluate(() => (window as unknown as { previewRunRequests: number }).previewRunRequests)).toBe(0);
  expect(await ui.evaluate(() => '__zingPreviewExecuted' in globalThis)).toBe(false);
  expect(await worker.evaluate(() => '__zingPreviewExecuted' in globalThis)).toBe(false);
  expect(await worker.evaluate(async () => (await chrome.storage.local.get('saved-script:preview-alpha'))['saved-script:preview-alpha'])).toEqual({ title: 'Preview alpha', code: alpha });
});

  test('English script library saves edits searches copies and deletes without executing code', async () => {
  await context.grantPermissions(['clipboard-read']);
  const code = 'globalThis.__zingSavedScriptExecuted = true;\nconst text = "<script> & Unicode 中文";\n\n';
  await ui.getByRole('button', { name: 'Settings', exact: true }).click();
  await ui.getByRole('button', { name: 'Manage Scripts' }).click();
  await ui.getByRole('button', { name: 'New Script', exact: true }).click();
  await ui.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(ui.getByRole('alert')).toContainText('Enter a name and code');
  await ui.getByLabel('Name', { exact: true }).fill('Storage helper');
  await ui.getByLabel('JavaScript code').fill(code);
  await ui.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(ui.getByRole('option', { name: 'Storage helper', exact: true })).toBeVisible();
  await ui.reload();
  await ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' }).fill('Storage helper');
  await expect(ui.getByRole('option').first()).toContainText('Storage helper');
  await expect(ui.locator('.primary-action')).toContainText('Run Script');
  await ui.keyboard.press('Meta+k'); await ui.getByRole('combobox', { name: 'Search actions' }).fill('copy code'); await ui.keyboard.press('Enter');
  await expect(ui.getByText('Code copied. Paste it into the intended execution environment.', { exact: true })).toBeVisible();
  expect(await ui.evaluate(() => navigator.clipboard.readText())).toBe(code);
  expect(await ui.evaluate(() => '__zingSavedScriptExecuted' in globalThis)).toBe(false);
  expect(await worker.evaluate(() => '__zingSavedScriptExecuted' in globalThis)).toBe(false);
  // Code is not part of the search index.
  await ui.getByRole('combobox').fill('__zingSavedScriptExecuted');
  await expect(ui.getByRole('option')).toHaveCount(0);
  await ui.getByRole('button', { name: 'Settings', exact: true }).click();
  await ui.getByRole('button', { name: 'Manage Scripts' }).click();
  const scripts = ui.getByRole('combobox', { name: 'Search scripts' });
  await worker.evaluate(() => chrome.storage.local.set({ 'saved-script:decoy': { title: 'Storage alpha', code: '"Do not copy this script"' } }));
  await scripts.fill('Storage');
  await expect(ui.locator('.script-item')).toHaveCount(2);
  await scripts.press('Meta+ArrowUp');
  await expect(ui.locator('.script-item.selected')).toHaveText('Storage alpha');
  await scripts.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
  const helper = ui.getByRole('option', { name: 'Storage helper', exact: true });
  const helperId = await helper.getAttribute('id');
  // Right-click must choose the clicked script, even when another row was selected.
  await helper.click({ button: 'right' });
  const actions = ui.getByRole('combobox', { name: 'Search actions' });
  await expect(actions).toBeFocused();
  await expect(ui.locator('.action-heading')).toContainText('Storage helper');
  await expect(ui.locator('.action-row')).toContainText(['Copy Code', 'Edit Script', 'New Script', 'Delete']);
  await actions.fill('copy'); await actions.press('Enter');
  expect(await ui.evaluate(() => navigator.clipboard.readText())).toBe(code);
  await expect(scripts).toBeFocused();
  expect(await scripts.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
  await helper.click({ button: 'right' });
  await actions.fill('delete'); await actions.press('Enter');
  const confirmation = ui.getByRole('alertdialog');
  await expect(confirmation).toContainText('Storage helper');
  await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await ui.keyboard.press('Enter');
  await expect(confirmation).toHaveCount(0);
  await expect(scripts).toBeFocused();
  await expect(helper).toHaveAttribute('aria-selected', 'true');
  expect(await worker.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter(key => key.startsWith('saved-script:')).length)).toBe(2);
  await helper.click({ button: 'right' });
  await actions.fill('edit'); await ui.locator('.palette-footer .primary-action').click();
  await expect(ui.getByLabel('JavaScript code')).toHaveValue(code);
  // Rename across the sort order: restoration follows identity, not the old index.
  await ui.getByLabel('Name', { exact: true }).fill('Storage 0 renamed');
  await ui.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(scripts).toBeFocused(); await expect(scripts).toHaveValue('Storage');
  expect(await scripts.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
  const renamed = ui.getByRole('option', { name: 'Storage 0 renamed', exact: true });
  await expect(renamed).toHaveAttribute('id', helperId!);
  await expect(renamed).toHaveAttribute('aria-selected', 'true');
  await renamed.click({ button: 'right' });
  await actions.fill('new'); await actions.press('Enter');
  await expect(ui.locator('.palette-footer-title')).toHaveText('New Script');
  await expect(ui.getByLabel('Name', { exact: true })).toBeFocused();
  await expect(ui.getByLabel('Name', { exact: true })).toHaveValue('');
  await ui.keyboard.press('Escape');
  await expect(renamed).toHaveAttribute('aria-selected', 'true');
  await renamed.click({ button: 'right' });
  await actions.fill('delete'); await actions.press('Enter');
  await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(renamed).toHaveCount(0);
  await expect(ui.getByRole('option', { name: 'Storage alpha', exact: true })).toBeVisible();
  expect(await worker.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter(key => key.startsWith('saved-script:')))).toEqual(['saved-script:decoy']);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English script binding guide copies this installation ID and opens Chrome shortcuts', async () => {
  await context.grantPermissions(['clipboard-read']);
  const before = await worker.evaluate(() => chrome.commands.getAll());
  await ui.getByRole('button', { name: 'Settings', exact: true }).click();
  await ui.getByRole('button', { name: 'Set Up', exact: true }).click();
  await expect(ui.locator('.palette-footer-title').filter({ hasText: 'Set Up Ctrl+Tab' })).toBeVisible();
  await expect(ui.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await expect(ui.getByRole('textbox', { name: 'JavaScript code' })).toHaveAttribute('readonly', '');
  await expect(ui.locator('.script-library .settings-header')).toHaveCount(0);
  const copy = ui.locator('.palette-footer .primary-action');
  await expect(copy).toHaveAccessibleName('Copy Code');
  await expect(copy).toBeFocused();
  await expect(ui.locator('.script-editor-body')).toBeVisible();
  await ui.keyboard.press('Enter');
  await expect(ui.getByRole('status')).toContainText('Code copied');
  await expect(copy).toBeFocused();
  const code = await ui.evaluate(() => navigator.clipboard.readText());
  await ui.keyboard.press('Enter');
  await expect(copy).toBeFocused();
  await expect(ui.locator('.palette-footer-title')).toHaveText('Set Up Ctrl+Tab');
  expect(await ui.evaluate(() => navigator.clipboard.readText())).toBe(code);
  const calls: unknown[] = [];
  new Function('chrome', code)({ developerPrivate: { updateExtensionCommand: (value: unknown) => calls.push(value) } });
  expect(calls).toEqual([
    { extensionId: new URL(worker.url()).hostname, commandName: 'switch-recent', keybinding: 'Ctrl+Tab' },
    { extensionId: new URL(worker.url()).hostname, commandName: 'switch-recent-back', keybinding: 'Ctrl+Shift+Tab' },
  ]);
  expect(await worker.evaluate(() => chrome.commands.getAll())).toEqual(before);
  await ui.setViewportSize({ width: 390, height: 500 });
  await ui.locator('.zing-app').evaluate(node => { node.classList.replace('popup', 'overlay'); document.body.style.width = '390px'; });
  expect(await ui.locator('.script-editor-body').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(ui.locator('.palette-footer .primary-action')).toBeInViewport({ ratio: 1 });
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('script-binding-guide.png') });
  await ui.locator('.palette-footer .actions-button').click();
  await expect(ui.getByRole('dialog').getByRole('option', { name: 'Delete', exact: true })).toHaveCount(0);
  await ui.locator('.palette-footer .footer-back').click();
  await expect(ui.locator('.action-menu')).toHaveCount(0);
  await expect(ui.locator('.palette-footer-title')).toHaveText('Set Up Ctrl+Tab');
  await ui.locator('.palette-footer .actions-button').click();
  const created = context.waitForEvent('page');
  await ui.getByRole('dialog').getByRole('option', { name: /Open Chrome Shortcuts/ }).click();
  await expect(await created).toHaveURL('chrome://extensions/shortcuts');
});
});

test('Chinese script library supports keyboard editing and nested Escape', async () => {
  await ui.getByRole('button', { name: '设置', exact: true }).click();
  await ui.getByRole('button', { name: '管理脚本' }).click();
  await ui.getByRole('button', { name: '新建脚本', exact: true }).click();
  await expect(ui.getByLabel('名称', { exact: true })).toBeFocused();
  await ui.keyboard.type('Keyboard script');
  await ui.keyboard.press('Tab');
  await expect(ui.getByLabel('JavaScript 代码')).toBeFocused();
  await ui.keyboard.type('const value = 42;');
  await ui.keyboard.press('Tab');
  await expect(ui.locator('.palette-footer .footer-back')).toBeFocused();
  await ui.keyboard.press('Tab');
  await expect(ui.getByRole('button', { name: '保存', exact: true })).toBeFocused();
  await ui.keyboard.press('Enter');
  await expect(ui.getByRole('combobox', { name: '搜索脚本' })).toBeFocused();
  await ui.getByRole('combobox', { name: '搜索脚本' }).fill('Keyboard');
  await ui.keyboard.press('Meta+k');
  await ui.locator('.action-search input').fill('编辑');
  await ui.keyboard.press('Enter');
  await expect(ui.getByLabel('JavaScript 代码')).toHaveValue('const value = 42;');
  await ui.keyboard.press('Escape');
  await expect(ui.locator('.palette-footer-title').filter({ hasText: '脚本收藏' })).toBeVisible();
  await ui.keyboard.press('Escape');
  await expect(ui.getByRole('region', { name: '设置', exact: true })).toBeVisible();
  await ui.keyboard.press('Escape');
  await expect(ui.getByRole('combobox', { name: '搜索命令、标签页和书签' })).toBeFocused();
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true } });
  test('English script overlay copies from unified search inside the closed keyboard frame', async () => {
  await context.grantPermissions(['clipboard-read']);
  const page = await context.newPage(); await page.goto(`${origin}/Script-overlay`);
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, page.url());
  await worker.evaluate(async id => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(id, { source: 'zing', type: 'toggle' });
  }, tabId);
  const cdp = await context.newCDPSession(page);
  await expect.poll(async () => {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
    return (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes.some(node => node.role?.value === 'combobox');
  }).toBe(true);
  await page.keyboard.type('ctrl tab');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('chrome.developerPrivate.updateExtensionCommand');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(new URL(worker.url()).hostname);
  await page.keyboard.press('Escape');
  await expect(page.locator('#zing-command-palette')).not.toBeAttached();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English script actions edit in place, preserve selection and caret, and confirm deletion', async () => {
  await context.grantPermissions(['clipboard-read']);
  const code = 'const value = "中文";\n\n';
  await worker.evaluate(async code => chrome.storage.local.set({
    'saved-script:alpha': { title: 'Action alpha', code },
    'saved-script:beta': { title: 'Action beta', code },
  }), code);
  const search = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
  await search.fill('Action');
  await expect(ui.locator('.result.script')).toHaveCount(2);
  await ui.keyboard.press('ArrowDown');
  await expect(ui.locator('.result[aria-selected=true]')).toContainText('Action beta');
  await search.evaluate(node => (node as HTMLInputElement).setSelectionRange(2, 4));
  await ui.keyboard.press('Meta+k');
  const actions = ui.getByRole('combobox', { name: 'Search actions' });
  await expect(actions).toBeFocused();
  await expect(ui.locator('.action-row')).toHaveCount(5);
  await actions.fill('edit');
  await expect(ui.locator('.primary-action')).toContainText('Edit Script');
  await ui.keyboard.press('Enter');
  await expect(ui.getByLabel('Name', { exact: true })).toBeFocused();
  await expect(ui.getByLabel('JavaScript code')).toHaveValue(code);
  await ui.getByLabel('Name', { exact: true }).fill('Action beta edited');
  await ui.getByLabel('JavaScript code').fill(code + '42;');
  // Newlines and arrows remain normal editing keys, not palette commands.
  await ui.keyboard.press('End'); await ui.keyboard.press('Enter');
  await ui.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('Action');
  expect(await search.evaluate(node => [(node as HTMLInputElement).selectionStart, (node as HTMLInputElement).selectionEnd])).toEqual([2, 4]);
  await expect(ui.locator('.result[aria-selected=true]')).toContainText('Action beta edited');
  await ui.keyboard.press('Meta+k'); await actions.fill('copy code'); await ui.keyboard.press('Enter');
  expect(await ui.evaluate(() => navigator.clipboard.readText())).toBe(code + '42;\n');
  await ui.keyboard.press('Meta+k'); await actions.fill('edit'); await ui.keyboard.press('Enter');
  await ui.getByLabel('Name', { exact: true }).fill('Unsaved draft');
  await ui.keyboard.press('Escape');
  await expect(search).toBeFocused();
  await expect(ui.locator('.result[aria-selected=true]')).toContainText('Action beta edited');
  await ui.keyboard.press('Meta+k'); await actions.fill('delete'); await ui.keyboard.press('Enter');
  const confirm = ui.getByRole('alertdialog');
  await expect(confirm).toContainText('Action beta edited');
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await ui.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0); await expect(actions).toBeFocused();
  await expect(actions).toHaveValue('delete');
  await ui.keyboard.press('Enter');
  await ui.keyboard.press('Enter'); // Default focused action is Cancel, never Delete.
  await expect(confirm).toHaveCount(0);
  await ui.keyboard.press('Enter');
  await ui.keyboard.press('Tab');
  await expect(confirm.getByRole('button', { name: 'Delete', exact: true })).toBeFocused();
  await ui.keyboard.press('Enter');
  await expect(search).toBeFocused();
  await expect(ui.locator('.result.script')).toHaveCount(1);
  expect(await worker.evaluate(async () => (await chrome.storage.local.get('saved-script:beta'))['saved-script:beta'])).toBeUndefined();
  await ui.reload(); await search.fill('Action');
  await expect(ui.locator('.result.script')).toHaveCount(1);
  await ui.keyboard.press('Meta+k');
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('zing-script-actions.png') });
});
});

test('Chinese script actions protect built-in setup and return directly to search', async () => {
  const search = ui.getByRole('combobox', { name: '搜索命令、标签页和书签' });
  await search.fill('ctrl tab'); await ui.keyboard.press('Meta+k');
  await expect(ui.locator('.action-row')).toHaveCount(2);
  await expect(ui.locator('.action-row')).toContainText(['复制代码', '查看设置说明']);
  await ui.keyboard.press('Control+n'); await ui.keyboard.press('Enter');
  await expect(ui.locator('.palette-footer-title').filter({ hasText: '设置 Ctrl+Tab' })).toBeVisible();
  await expect(ui.getByLabel('JavaScript 代码')).toHaveAttribute('readonly', '');
  await expect(ui.getByRole('button', { name: '删除', exact: true })).toHaveCount(0);
  await ui.keyboard.press('Escape');
  await expect(search).toBeFocused(); await expect(search).toHaveValue('ctrl tab');
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true } });
  test('English script overlay actions edit and delete through the closed keyboard frame', async () => {
  await worker.evaluate(() => chrome.storage.local.set({ 'saved-script:overlay-menu': { title: 'Overlay helper', code: '42;' } }));
  const page = await context.newPage(); await page.goto(`${origin}/Script-menu-overlay`);
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, page.url());
  await worker.evaluate(async id => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(id, { source: 'zing', type: 'toggle' });
  }, tabId);
  const cdp = await context.newCDPSession(page);
  const ax = async () => {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
    return (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes;
  };
  await expect.poll(async () => (await ax()).some(node => node.role?.value === 'combobox')).toBe(true);
  await page.keyboard.type('Overlay helper');
  await expect.poll(async () => (await ax()).some(node => node.role?.value === 'option' && node.name?.value?.includes('Overlay helper'))).toBe(true);
  await page.keyboard.press('Meta+k');
  await expect.poll(async () => (await ax()).some(node => node.role?.value === 'combobox' && node.name?.value === 'Search actions')).toBe(true);
  await page.keyboard.type('edit'); await page.keyboard.press('Enter');
  await expect.poll(async () => (await ax()).some(node => node.role?.value === 'textbox' && node.name?.value === 'Name')).toBe(true);
  await page.keyboard.press('Meta+a'); await page.keyboard.type('Overlay helper edited');
  await page.keyboard.press('Tab'); await page.keyboard.press('Meta+a'); await page.keyboard.type('43;');
  await page.keyboard.press('Meta+k');
  await expect.poll(async () => (await ax()).some(node => node.role?.value === 'combobox' && node.name?.value === 'Search actions')).toBe(true);
  await page.keyboard.type('copy'); await page.keyboard.press('Enter');
  await expect.poll(async () => (await ax()).some(node => node.role?.value === 'textbox' && node.name?.value === 'JavaScript code' && node.properties?.some(prop => prop.name === 'focused' && prop.value.value === true))).toBe(true);
  await page.keyboard.press('Meta+Enter');
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('saved-script:overlay-menu'))['saved-script:overlay-menu'])).toEqual({ title: 'Overlay helper edited', code: '43;' });
  await expect.poll(async () => (await ax()).some(node => node.role?.value === 'combobox' && node.name?.value === 'Search commands, tabs, and bookmarks')).toBe(true);
  await page.keyboard.press('Meta+k'); await page.keyboard.type('delete'); await page.keyboard.press('Enter');
  await expect.poll(async () => (await ax()).some(node => node.role?.value === 'alertdialog')).toBe(true);
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('saved-script:overlay-menu'))['saved-script:overlay-menu'])).toBeUndefined();
  await expect.poll(async () => (await ax()).some(node => node.role?.value === 'combobox' && node.name?.value === 'Search commands, tabs, and bookmarks')).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#zing-command-palette')).not.toBeAttached();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English command discovery completes the script lifecycle entirely from search and keyboard', async () => {
  await context.grantPermissions(['clipboard-read']);
  const search = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
  await search.fill('new script');
  await expect(ui.locator('.result[aria-selected=true]')).toContainText('New Script');
  await ui.keyboard.press('Enter');
  await expect(ui.locator('.palette-footer-title').filter({ hasText: 'New Script' })).toBeVisible();
  await expect(ui.getByLabel('Name', { exact: true })).toBeFocused();
  await ui.keyboard.type('Clipboard helper'); await ui.keyboard.press('Tab');
  await ui.keyboard.type('localStorage.getItem("demo");');
  await ui.keyboard.press('Meta+Enter');
  await expect(search).toBeFocused();
  await ui.keyboard.press('Meta+a'); await ui.keyboard.type('Clipboard helper');
  await expect(ui.locator('.result[aria-selected=true]')).toContainText('Clipboard helper');
  await ui.keyboard.press('Meta+k'); await ui.keyboard.type('copy code'); await ui.keyboard.press('Enter');
  expect(await ui.evaluate(() => navigator.clipboard.readText())).toBe('localStorage.getItem("demo");');
  await ui.keyboard.press('Meta+k'); await ui.keyboard.type('edit'); await ui.keyboard.press('Enter');
  await expect(ui.getByLabel('Name', { exact: true })).toBeFocused();
  await ui.keyboard.press('Meta+a'); await ui.keyboard.type('Clipboard helper edited');
  await ui.keyboard.press('Meta+Enter');
  await expect(search).toBeFocused();
  await expect(ui.locator('.result[aria-selected=true]')).toContainText('Clipboard helper edited');
  await ui.keyboard.press('Meta+k'); await ui.keyboard.type('delete'); await ui.keyboard.press('Enter');
  await expect(ui.getByRole('alertdialog')).toBeVisible();
  await ui.keyboard.press('Tab'); await ui.keyboard.press('Enter');
  await expect(search).toBeFocused();
  await expect(ui.locator('.result.script')).toHaveCount(0);
  await ui.keyboard.press('Meta+a'); await ui.keyboard.type('scripts'); await ui.keyboard.press('Enter');
  await expect(ui.locator('.palette-footer-title').filter({ hasText: 'Script Library' })).toBeVisible();
  await expect(ui.getByRole('combobox', { name: 'Search scripts' })).toBeFocused();
  await ui.keyboard.press('Escape'); await expect(search).toBeFocused(); await expect(search).toHaveValue('scripts');
  await search.fill('new script'); await ui.keyboard.press('Enter');
  await ui.keyboard.type('Unsaved'); await ui.keyboard.press('Escape');
  await expect(search).toBeFocused();
  expect(await worker.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter(key => key.startsWith('saved-script:')))).toEqual([]);
});
});

test('Chinese command discovery opens each preference at its keyboard control', async () => {
  const search = ui.getByRole('combobox', { name: '搜索命令、标签页和书签' });
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
  await search.fill('脚本'); await ui.keyboard.press('Enter');
  await expect(ui.locator('.palette-footer-title').filter({ hasText: '脚本收藏' })).toBeVisible();
  await ui.keyboard.press('Escape'); await expect(search).toBeFocused();
  await search.fill('新建脚本'); await ui.keyboard.press('Enter');
  await expect(ui.locator('.palette-footer-title').filter({ hasText: '新建脚本' })).toBeVisible();
});

async function enableScriptExecution() {
  const settings = await context.newPage();
  await settings.goto(`chrome://extensions/?id=${new URL(worker.url()).hostname}`);
  const toggle = settings.locator('#allow-user-scripts cr-toggle');
  await expect(toggle).toBeVisible(); await toggle.click();
  await settings.close();
}
async function scriptExecutionFixture(code: string, enable = true) {
  await worker.evaluate(code => chrome.storage.local.set({ 'saved-script:runner': { title: 'Execution helper', code } }), code);
  if (enable) await enableScriptExecution();
  const page = await context.newPage(); await page.goto(`${origin}/Execution-fixture`);
  await page.evaluate(() => localStorage.setItem('demo', '中文\n\n'));
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, page.url());
  await worker.evaluate(async id => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(id, { source: 'zing', type: 'toggle' });
  }, tabId);
  const surface = page.frameLocator('.zing-frame');
  await expect(surface.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' })).toBeVisible();
  return { page, surface, tabId };
}

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test('English script execution storage overlay runs once, copies exact results and restores search', async () => {
  await context.grantPermissions(['clipboard-read']);
  const { page, surface } = await scriptExecutionFixture('localStorage.setItem("runs", String(Number(localStorage.getItem("runs") || 0) + 1)); localStorage.getItem("demo")');
  const search = surface.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
  await search.fill('Execution helper'); await expect(surface.locator('.result.script')).toHaveCount(1);
  await page.keyboard.press('Meta+k'); await surface.getByRole('combobox', { name: 'Search actions' }).fill('run and copy'); await page.keyboard.press('Enter');
  await expect(surface.getByLabel('Result', { exact: true })).toHaveValue('中文\n\n');
  await expect(surface.getByText('Result copied', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('中文\n\n');
  expect(await page.evaluate(() => localStorage.getItem('runs'))).toBe('1');
  await page.keyboard.press('Enter'); // Copy Result has focus; must not rerun.
  expect(await page.evaluate(() => localStorage.getItem('runs'))).toBe('1');
  await page.keyboard.press('Escape'); await expect(search).toBeFocused(); await expect(search).toHaveValue('Execution helper');
  expect(await worker.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter(key => /result|execution/i.test(key)))).toEqual([]);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test('English script execution storage searches the run command and handles async objects and errors', async () => {
  const { page, surface } = await scriptExecutionFixture('Promise.resolve({ answer: 42, markup: "<script>not HTML</script>" })');
  const search = surface.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
  await search.fill('run script'); await page.keyboard.press('Enter');
  await expect(surface.getByRole('combobox', { name: 'Search scripts' })).toBeFocused();
  await page.keyboard.type('Execution helper'); await page.keyboard.press('Enter');
  await expect(surface.getByLabel('Result', { exact: true })).toHaveValue('{\n  "answer": 42,\n  "markup": "<script>not HTML</script>"\n}');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
  await worker.evaluate(() => chrome.storage.local.set({ 'saved-script:runner': { title: 'Execution helper', code: 'throw new Error("Expected failure")' } }));
  await search.fill('Execution helper'); await page.keyboard.press('Enter');
  await expect(surface.getByLabel('Result', { exact: true })).toHaveValue('Error: Expected failure');
  await expect(surface.getByRole('button', { name: 'Copy Result', exact: true })).toHaveCount(0);
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('zing-script-run-error.png') });
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test('English script execution storage explains disabled permission and never runs before enabling', async () => {
  const { page, surface } = await scriptExecutionFixture('localStorage.setItem("ran", "yes"); 42', false);
  await surface.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' }).fill('Execution helper'); await page.keyboard.press('Enter');
  await expect(surface.getByRole('alert')).toContainText('Enable user scripts');
  expect(await page.evaluate(() => localStorage.getItem('ran'))).toBeNull();
  await expect(surface.getByRole('button', { name: 'Open Extension Details' })).toBeVisible();
  const created = context.waitForEvent('page'); await surface.getByRole('button', { name: 'Open Extension Details' }).click();
  const detail = await created; await expect(detail).toHaveURL(`chrome://extensions/?id=${new URL(worker.url()).hostname}`);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test('English script execution storage leaves the clipboard alone after returning from a pending run', async () => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { page, surface } = await scriptExecutionFixture('new Promise(resolve => setTimeout(() => { localStorage.setItem("done", "yes"); resolve("late result"); }, 700))');
  await page.evaluate(() => navigator.clipboard.writeText('unchanged'));
  const search = surface.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
  await search.fill('Execution helper'); await page.keyboard.press('Meta+k');
  await surface.getByRole('combobox', { name: 'Search actions' }).fill('run and copy'); await page.keyboard.press('Enter');
  await expect(surface.locator('.script-run-status')).toContainText('Running script…');
  await page.keyboard.press('Escape'); await expect(search).toBeFocused();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('done'))).toBe('yes');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('unchanged');
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English script execution refuses a Chrome internal page and keeps built-in setup copy-only', async () => {
  await worker.evaluate(() => chrome.storage.local.set({ 'saved-script:runner': { title: 'Execution helper', code: '42' } }));
  await ui.getByRole('combobox').fill('Execution helper'); await ui.keyboard.press('Enter');
  await expect(ui.getByRole('alert')).toContainText('ordinary HTTP or HTTPS');
  await ui.keyboard.press('Escape');
  await ui.getByRole('combobox').fill('ctrl tab'); await ui.keyboard.press('Meta+k');
  await expect(ui.locator('.action-row')).toHaveCount(2);
  await expect(ui.locator('.action-row')).toContainText(['Copy Code', 'View Setup Instructions']);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English script save stays visible without scrolling the editor', async () => {
  await ui.setViewportSize({ width: 750, height: 516 });
  await ui.getByRole('combobox').fill('new script');
  await ui.keyboard.press('Enter');
  await expect(ui.locator('.palette-footer-title').filter({ hasText: 'New Script' })).toBeVisible();
  await ui.getByLabel('Name', { exact: true }).fill('Visible save regression');
  await ui.getByLabel('JavaScript code').fill('localStorage.getItem("demo")');
  await expect(ui.getByRole('button', { name: 'Save', exact: true })).toBeInViewport({ ratio: 1 });
  await ui.screenshot({ path: test.info().outputPath('zing-save-visible.png') });
  await ui.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(ui.getByRole('combobox')).toHaveValue('new script');
  expect(await worker.evaluate(async () => Object.values(await chrome.storage.local.get(null)).some((value: any) => value?.title === 'Visible save regression'))).toBe(true);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, pageAccess: true, shadow: 'open' } });
  test('Chinese script save storage overlay remains visible in a short viewport and enlarged editor', async () => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 400 });
  await page.goto(`${origin}/Script-save-short`);
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, page.url());
  await worker.evaluate(async id => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(id, { source: 'zing', type: 'toggle' });
  }, tabId);
  const surface = page.frameLocator('.zing-frame');
  await surface.getByRole('combobox').fill('新建脚本');
  await page.keyboard.press('Enter');
  const save = surface.getByRole('button', { name: '保存', exact: true });
  await expect(save).toBeInViewport({ ratio: 1 });
  await save.click();
  await expect(surface.getByRole('alert')).toBeInViewport({ ratio: 1 });
  await surface.getByLabel('名称', { exact: true }).fill('短窗口验收');
  const code = surface.getByLabel('JavaScript 代码');
  await code.fill('42');
  await code.evaluate(el => (el as HTMLElement).style.height = '650px');
  await expect(save).toBeInViewport({ ratio: 1 });
  await surface.locator('.script-editor-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(save).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: test.info().outputPath('zing-save-short.png') });
  await save.click();
  await expect(surface.getByRole('combobox')).toHaveValue('新建脚本');
  expect(await worker.evaluate(async () => Object.values(await chrome.storage.local.get(null)).some((value: any) => value?.title === '短窗口验收' && value?.code === '42'))).toBe(true);
});
});


test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English palette launch storage overlay opens centered on a fresh ordinary page', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Fresh-launch`);
  // The ordinary page already has the lightweight recent-key listener, but not the palette.
  const id = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, page.url());
  await expect.poll(() => worker.evaluate(async tabId => {
    try { return await chrome.tabs.sendMessage(tabId, { source: 'zing-recent', type: 'arm', session: 'launch-check', modifier: 'Control' }, { frameId: 0 }); }
    catch { return null; }
  }, id)).not.toBeNull();
  await worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  await expect(page.locator('#zing-command-palette')).toBeAttached();
  expect(await worker.evaluate(tabId => chrome.action.getPopup({ tabId }), id)).toBe('');
  const surface = page.frameLocator('.zing-frame');
  await expect(surface.getByRole('combobox')).toBeFocused();
  const bounds = await surface.locator('.palette').boundingBox();
  expect(Math.abs(bounds!.x + bounds!.width / 2 - 550)).toBeLessThan(1);
  await surface.getByRole('combobox').fill('new script'); await page.keyboard.press('Enter');
  await expect(surface.locator('.palette-footer-title').filter({ hasText: 'New Script' })).toBeVisible();
  const editor = await surface.locator('.palette').boundingBox();
  expect(editor!.x).toBe(bounds!.x); expect(editor!.y).toBe(bounds!.y);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await expect(page.locator('#zing-command-palette')).not.toBeAttached();
  // A successful launch must also recover any per-tab popup left by an earlier failure.
  await worker.evaluate(async tabId => {
    await chrome.action.setPopup({ tabId, popup: 'popup.html' });
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  }, id);
  await expect(page.locator('#zing-command-palette')).toBeAttached();
  expect(await worker.evaluate(tabId => chrome.action.getPopup({ tabId }), id)).toBe('');
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English script editor shares the footer and action menu while preserving code editing', async () => {
  await context.grantPermissions(['clipboard-read']);
  const search = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
  await expect(ui.locator('.palette-footer .actions-button')).toBeVisible();
  await search.fill('new script'); await ui.keyboard.press('Enter');
  const name = ui.getByLabel('Name', { exact: true });
  const code = ui.getByLabel('JavaScript code');
  await name.fill('Shared actions helper'); await code.fill('const value = 42;');
  await ui.keyboard.press('End'); await ui.keyboard.press('Enter');
  await expect(code).toHaveValue('const value = 42;\n');
  await expect(ui.locator('.palette-footer .primary-action')).toHaveText('Save⌘↵');
  await expect(ui.getByRole('button', { name: 'Copy Code', exact: true })).toHaveCount(0);
  await code.evaluate(el => (el as HTMLTextAreaElement).setSelectionRange(6, 11));
  await ui.keyboard.press('Meta+k');
  const actionSearch = ui.getByRole('combobox', { name: 'Search actions' });
  await expect(actionSearch).toBeFocused();
  await expect(ui.locator('.action-row')).toHaveCount(2);
  await ui.keyboard.press('Control+n');
  await expect(ui.locator('.action-row[aria-selected=true]')).toContainText('Copy Code');
  await ui.keyboard.press('Control+p');
  await expect(ui.locator('.action-row[aria-selected=true]')).toContainText('Save');
  await ui.keyboard.press('Escape'); await expect(code).toBeFocused();
  expect(await code.evaluate(el => [(el as HTMLTextAreaElement).selectionStart, (el as HTMLTextAreaElement).selectionEnd])).toEqual([6, 11]);
  await ui.keyboard.press('Meta+k'); await actionSearch.fill('copy'); await ui.keyboard.press('Enter');
  await expect(code).toBeFocused();
  expect(await ui.evaluate(() => navigator.clipboard.readText())).toBe('const value = 42;\n');
  await ui.keyboard.press('Meta+k'); await actionSearch.fill('save');
  await ui.locator('.palette-footer .primary-action').click();
  await expect(search).toBeFocused();
  await search.fill('Shared actions'); await ui.keyboard.press('Meta+k');
  await actionSearch.fill('edit'); await ui.keyboard.press('Enter');
  await expect(name).toBeFocused(); await name.fill('Shared actions updated');
  await ui.keyboard.press('Meta+Enter'); await expect(search).toBeFocused();
  await expect(ui.locator('.result.script')).toContainText('Shared actions updated');
  await ui.keyboard.press('Meta+k'); await actionSearch.fill('edit'); await ui.keyboard.press('Enter');
  await ui.keyboard.press('Meta+k'); await actionSearch.fill('delete'); await ui.keyboard.press('Enter');
  await expect(ui.getByRole('alertdialog').getByRole('button', { name: 'Cancel' })).toBeFocused();
  await ui.keyboard.press('Escape'); await expect(name).toBeFocused();
  await expect(name).toHaveValue('Shared actions updated');
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('zing-shared-editor.png') });
  await ui.keyboard.press('Meta+k'); await ui.locator('.palette').screenshot({ path: test.info().outputPath('zing-shared-editor-menu.png') });
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, commands: true } });
  test('English palette launch overlay Escape returns one level from script management', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Escape-management`);
  const open = () => worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  await open();
  const cdp = await context.newCDPSession(page);
  const ax = async () => {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const frameId = frameTree.childFrames?.find(child => child.frame.url === 'about:blank')?.frame.id;
    return (await cdp.send('Accessibility.getFullAXTree', { frameId })).nodes;
  };
  const focused = async (name: string) => (await ax()).some(node => node.name?.value === name && node.properties?.some(prop => prop.name === 'focused' && prop.value.value === true));
  await expect.poll(() => focused('Search commands, tabs, and bookmarks')).toBe(true);
  await page.keyboard.type('manage scripts'); await page.keyboard.press('Enter');
  await expect.poll(() => focused('Search scripts')).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => focused('Search commands, tabs, and bookmarks')).toBe(true);
  await expect(page.locator('#zing-command-palette')).toBeAttached();
  await page.keyboard.press('Meta+a'); await page.keyboard.type('settings'); await page.keyboard.press('Enter');
  await expect.poll(() => focused('Back')).toBe(true);
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => focused('Manage Scripts')).toBe(true);
  await page.keyboard.press('Enter');
  await expect.poll(() => focused('Search scripts')).toBe(true);
  await expect.poll(async () => (await ax()).some(node => node.role?.value === 'button' && node.name?.value === 'New Script' && !node.properties?.some(prop => prop.name === 'disabled' && prop.value.value === true))).toBe(true);
  await page.keyboard.press('Meta+Shift+n');
  await expect.poll(() => focused('Name')).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => focused('Search scripts')).toBe(true);
  // Search dismiss, footer back, primary Edit, then secondary New; rows are not Tab stops.
  for (let at = 0; at < 4; at++) await page.keyboard.press('Tab');
  await expect.poll(() => focused('New Script')).toBe(true);
  await page.keyboard.press('Enter');
  await expect.poll(() => focused('Name')).toBe(true);
  await page.keyboard.press('Meta+k');
  await expect.poll(() => focused('Search actions')).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => focused('Name')).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => focused('Search scripts')).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => focused('Language')).toBe(true);
  await expect.poll(async () => (await ax()).some(node => node.role?.value === 'region' && node.name?.value === 'Settings')).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => focused('Search commands, tabs, and bookmarks')).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#zing-command-palette')).not.toBeAttached();
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
  const surface = page.frameLocator('.zing-frame');
  const search = surface.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
  await search.fill('manage scripts'); await page.keyboard.press('Enter');
  await expect(surface.getByRole('combobox', { name: 'Search scripts' })).toBeFocused();
  await surface.locator('.palette-footer-title').filter({ hasText: 'Script Library' }).click();
  await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('manage scripts');
  // Central routing handles each page, including clicks on non-input content.
  for (const [query, heading] of [['settings', 'Settings'], ['new script', 'New Script'], ['run script', 'Run Script']]) {
    await search.fill(query); await page.keyboard.press('Enter');
    await surface.locator('.palette-footer-title').filter({ hasText: heading }).click();
    await page.keyboard.press('Escape'); await expect(search).toBeFocused();
    await expect(search).toHaveValue(query);
  }
  await search.fill('new script'); await page.keyboard.press('Enter');
  await page.keyboard.press('Meta+k');
  await surface.locator('.action-heading').click(); await page.keyboard.press('Escape');
  await expect(surface.locator('.palette-footer-title').filter({ hasText: 'New Script' })).toBeVisible();
  await expect(surface.getByLabel('Name', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(search).toBeFocused();
  await search.fill('local storage'); await page.keyboard.press('Enter');
  await surface.locator('.palette-footer-context').click(); await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
  await search.fill('settings'); await page.keyboard.press('Enter');
  await surface.getByRole('button', { name: 'Manage Scripts', exact: true }).click();
  await surface.locator('.palette-footer-title').filter({ hasText: 'Script Library' }).click();
  await page.keyboard.press('Escape');
  await expect(surface.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  await surface.locator('.settings-view .palette-footer-title').click();
  await page.keyboard.press('Escape'); await expect(search).toBeFocused();
  await search.fill('no-such-command'); await surface.getByText('No results found', { exact: true }).click();
  await page.keyboard.press('Escape'); await expect(page.locator('#zing-command-palette')).not.toBeAttached();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English Escape routing survives lost control focus through every script and settings layer', async () => {
  await worker.evaluate(() => chrome.storage.local.set({ 'saved-script:escape-fixture': { title: 'Escape fixture', code: 'return "fixture";' } }));
  const search = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
  const escapeWithoutControlFocus = async () => {
    await ui.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await ui.keyboard.press('Escape');
  };
  await search.fill('manage scripts'); await search.press('Enter');
  await expect(ui.getByRole('combobox', { name: 'Search scripts' })).toBeFocused();
  await escapeWithoutControlFocus();
  await expect(search).toBeFocused();
  await search.fill('settings'); await search.press('Enter');
  await ui.getByRole('combobox', { name: 'Language', exact: true }).press('Enter');
  await escapeWithoutControlFocus();
  await expect(ui.getByRole('combobox', { name: 'Language', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(ui.getByRole('combobox', { name: 'Language', exact: true })).toBeFocused();
  await ui.getByRole('button', { name: 'Manage Scripts', exact: true }).click();
  const scripts = ui.getByRole('combobox', { name: 'Search scripts' });
  await scripts.fill('Escape fixture'); await scripts.press('Meta+k');
  await ui.getByRole('combobox', { name: 'Search actions' }).fill('edit');
  await ui.keyboard.press('Enter');
  await expect(ui.getByLabel('Name', { exact: true })).toBeFocused();
  await ui.keyboard.press('Meta+k');
  await escapeWithoutControlFocus();
  await expect(ui.getByLabel('Name', { exact: true })).toBeFocused();
  await ui.keyboard.press('Meta+k');
  await ui.getByRole('combobox', { name: 'Search actions' }).fill('delete');
  await ui.keyboard.press('Enter');
  await expect(ui.getByRole('alertdialog')).toBeVisible();
  await escapeWithoutControlFocus();
  await expect(ui.getByRole('alertdialog')).toHaveCount(0);
  await expect(ui.getByLabel('Name', { exact: true })).toBeFocused();
  await escapeWithoutControlFocus(); await expect(scripts).toBeFocused();
  await expect(scripts).toHaveValue('Escape fixture');
  await escapeWithoutControlFocus(); await expect(ui.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  await escapeWithoutControlFocus(); await expect(search).toBeFocused();
  await expect(search).toHaveValue('settings');
  await search.fill('run script'); await search.press('Enter');
  await scripts.fill('Escape fixture'); await scripts.press('Enter');
  // The popup is a restricted target; the error result is still a navigation layer.
  await expect(ui.getByRole('alert')).toBeVisible();
  await escapeWithoutControlFocus(); await expect(scripts).toBeFocused();
  await escapeWithoutControlFocus(); await expect(search).toBeFocused();
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
  const surface = page.frameLocator('.zing-frame');
  const search = surface.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
  const blur = () => surface.locator('.zing-app').evaluate(node => {
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
  await search.fill('manage scripts'); await page.keyboard.press('Enter');
  // Composition owns Escape until committed; repeated keydown must not pop again.
  await surface.locator('.zing-app').evaluate(node => {
    const doc = node.ownerDocument;
    doc.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true }));
    doc.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, repeat: true }));
  });
  await expect(surface.getByRole('combobox', { name: 'Search scripts' })).toBeVisible();
  await escape(); await expect(search).toBeFocused();
  await escape(); await expect(page.locator('#zing-command-palette')).not.toBeAttached();
  // Reopen to catch stale registrations/listeners left behind by the prior mount.
  await open(); await expect(search).toBeFocused();
  await search.fill('manage scripts'); await page.keyboard.press('Enter');
  await escape(); await expect(search).toBeFocused();
  await escape(); await expect(page.locator('#zing-command-palette')).not.toBeAttached();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English Escape returns from pending and completed script results without stale updates', async () => {
  await worker.evaluate(() => chrome.storage.local.set({ 'saved-script:pending-fixture': { title: 'Pending fixture', code: '42' } }));
  // Defer only execution transport in this isolated popup to control completion
  // order. Navigation, selection and rendering use the production components.
  await ui.evaluate(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    const scope = window as unknown as { finishRun?: (value: unknown) => void };
    chrome.runtime.sendMessage = ((request: { type?: string }) => request.type === 'run-saved-script'
      ? new Promise<unknown>(resolve => { scope.finishRun = resolve; }) : send(request)) as typeof chrome.runtime.sendMessage;
  });
  const search = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
  await search.fill('run script'); await search.press('Enter');
  const picker = ui.getByRole('combobox', { name: 'Search scripts' });
  await picker.fill('Pending fixture'); await picker.press('Enter');
  await expect(ui.locator('.script-run-status')).toBeVisible();
  await ui.keyboard.press('Escape'); await expect(picker).toBeFocused();
  await ui.evaluate(() => (window as unknown as { finishRun: (value: unknown) => void }).finishRun({ ok: true, data: { success: true, text: 'stale result' } }));
  await expect(picker).toBeFocused(); await expect(ui.locator('.script-output')).toHaveCount(0);
  await picker.press('Enter'); await expect(ui.locator('.script-run-status')).toBeVisible();
  await ui.evaluate(() => (window as unknown as { finishRun: (value: unknown) => void }).finishRun({ ok: true, data: { success: true, text: 'current result' } }));
  await expect(ui.locator('.script-output')).toHaveValue('current result');
  await ui.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await ui.keyboard.press('Escape'); await expect(picker).toBeFocused();
  await ui.keyboard.press('Escape'); await expect(search).toBeFocused();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English Backspace returns from empty searches while preserving text editing and the root', async () => {
  const search = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
  await search.fill('settings'); await search.press('Enter');
  await ui.getByRole('button', { name: 'Manage Scripts', exact: true }).click();
  const scripts = ui.getByRole('combobox', { name: 'Search scripts' });
  await scripts.fill('test'); await scripts.press('Backspace');
  await expect(scripts).toHaveValue('tes');
  await scripts.press('Meta+a'); await scripts.press('Backspace');
  await expect(scripts).toHaveValue('');
  await ui.getByRole('button', { name: 'New Script', exact: true }).click();
  const name = ui.getByLabel('Name', { exact: true });
  await name.press('Backspace'); await expect(name).toBeFocused();
  const code = ui.getByLabel('JavaScript code');
  await code.fill('x'); await code.press('Backspace'); await code.press('Backspace');
  await expect(code).toBeFocused(); await expect(code).toHaveValue('');
  await code.press('Meta+k');
  const actions = ui.getByRole('combobox', { name: 'Search actions' });
  await actions.fill('save'); await actions.press('Backspace'); await expect(actions).toHaveValue('sav');
  await actions.fill(''); await actions.press('Backspace'); await expect(code).toBeFocused();
  await ui.locator('.footer-back').first().focus();
  await ui.keyboard.press('Backspace'); await expect(scripts).toBeFocused();
  await scripts.press('Backspace');
  await expect(ui.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  const language = ui.getByRole('combobox', { name: 'Language', exact: true });
  await language.press('Enter'); await language.press('Backspace');
  await expect(language).toHaveAttribute('aria-expanded', 'false');
  await language.press('Backspace'); await expect(search).toBeFocused();
  await search.fill(''); await search.press('Backspace');
  await expect(search).toBeFocused();
  await search.press('Meta+k'); await ui.keyboard.press('Backspace');
  await expect(search).toBeFocused();
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
  await expect.poll(() => focused('Search commands, tabs, and bookmarks')).toBe(true);
  await page.keyboard.type('manage scripts'); await page.keyboard.press('Enter');
  await expect.poll(() => focused('Search scripts')).toBe(true);
  await page.keyboard.type('x'); await page.keyboard.press('Backspace');
  await expect.poll(() => focused('Search scripts')).toBe(true);
  await page.keyboard.press('Backspace');
  await expect.poll(() => focused('Search commands, tabs, and bookmarks')).toBe(true);
  await page.keyboard.press('Meta+a'); await page.keyboard.type('new script'); await page.keyboard.press('Enter');
  await expect.poll(() => focused('Name')).toBe(true);
  await page.keyboard.press('Backspace'); await expect.poll(() => focused('Name')).toBe(true);
  await page.keyboard.press('Meta+k'); await expect.poll(() => focused('Search actions')).toBe(true);
  await page.keyboard.press('Backspace'); await expect.poll(() => focused('Name')).toBe(true);
  await page.keyboard.press('Shift+Tab'); await expect.poll(() => focused('Back')).toBe(true);
  await page.keyboard.press('Backspace'); await expect.poll(() => focused('Search commands, tabs, and bookmarks')).toBe(true);
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
  await page.keyboard.press('Backspace'); await expect.poll(() => focused('Search commands, tabs, and bookmarks')).toBe(true);
  await page.keyboard.press('Meta+a'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
  await expect.poll(() => focused('Search commands, tabs, and bookmarks')).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.locator('#zing-command-palette')).not.toBeAttached();
});
});

for (const language of ['English', 'Chinese']) test.describe(() => {
  test.use({ environment: { ...defaults, locale: language === 'English' ? 'en-US' : 'zh-CN' } });
  test(`${language} categorized candidates show real shortcuts and keep search matching and save binding`, async () => {
  const en = language === 'English';
  const search = ui.locator('.search-bar input');
  await search.fill('script:new');
  const first = ui.locator('#zing-results [role="option"]').first();
  await expect(first.locator('.entry-title')).toHaveText(en ? 'Script: New Script' : '脚本: 新建脚本');
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
  await search.fill('script: new'); await search.press('Enter');
  await ui.locator('.script-field input').fill('Prefix fixture');
  await ui.locator('.script-field textarea').fill('42');
  await ui.keyboard.press('Meta+k');
  await expect(ui.locator('.action-row .entry-shortcut kbd')).toHaveText(['⌘↵']);
  await ui.keyboard.press('Meta+Enter');
  await expect(search).toBeFocused();
  await expect.poll(() => worker.evaluate(async () => Object.values(await chrome.storage.local.get(null)).some(value => (value as { title?: string })?.title === 'Prefix fixture'))).toBe(true);
  for (const theme of ['light', 'dark']) {
    await worker.evaluate(preferences => chrome.storage.local.set({ preferences }), { language: en ? 'en' : 'zh', theme });
    await search.fill('new tab'); await ui.setViewportSize({ width: 390, height: 516 });
    await ui.evaluate(() => { document.body.style.width = '390px'; });
    await expect(ui.locator('.zing-app')).toHaveAttribute('data-theme', theme);
    const row = ui.locator('#zing-command\\:newTab');
    await expect(row.locator('.entry-shortcut')).toBeInViewport();
    expect(await ui.locator('.palette').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await ui.locator('.palette').screenshot({ path: test.info().outputPath(`zing-categories-${language}-${theme}.png`) });
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
  const surface = website.frameLocator('.zing-frame');
  const search = surface.locator('.search-bar input'); await search.fill('Favicon site');
  const icon = surface.locator('.result.tab img.entry-favicon.loaded').first();
  await expect(icon).toBeVisible();
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('zing-favicon-overlay.png') });
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
  const surface = page.frameLocator('.zing-frame');
  const start = performance.now(); await launch();
  await expect(surface.locator('.result.command')).toHaveCount(9);
  const coldMs = Math.round(performance.now() - start);
  const input = surface.locator('.search-bar input');
  const searchMs: number[] = [];
  for (const query of ['ref', 'refer', 'reference', 'reference 42', 'new tab', 'iam']) {
    const start = performance.now(); await input.fill(query);
    if (query === 'iam') await expect(surface.locator('.result')).toHaveCount(0);
    else if (query === 'new tab') await expect(surface.locator('.result').first()).toHaveAttribute('id', 'zing-command:newTab');
    else await expect(surface.locator('.result.bookmark').first().locator('.entry-title mark').first()).toHaveText(query.split(' ')[0], { ignoreCase: true });
    searchMs.push(Math.round(performance.now() - start));
  }
  await page.keyboard.press('Escape'); await expect(page.locator('#zing-command-palette')).not.toBeAttached();
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
      await expect(ui.locator('.result').first()).toHaveAttribute('id', 'zing-command:newTab');
      await expect(input).toHaveValue('new tab');
      await expect(input).toBeFocused();
      await expect(ui.locator('.results .spinner')).toHaveCount(0);
      // Refreshes keep the existing list, with no new loading indicator.
      await ui.evaluate(() => window.dispatchEvent(new Event('focus')));
      await ui.clock.runFor(200);
      await expect(ui.locator('.result').first()).toHaveAttribute('id', 'zing-command:newTab');
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
  test('English interaction polish script navigation scrolls and returns to the same selection and caret', async () => {
  await worker.evaluate(() => chrome.storage.local.set(Object.fromEntries(Array.from({ length: 35 }, (_, i) => [
    `saved-script:polish-${i}`, { title: `Polish ${String(i).padStart(2, '0')}`, code: '42' },
  ]))));
  await ui.locator('.search-bar input').fill('manage scripts'); await ui.keyboard.press('Enter');
  const search = ui.getByRole('combobox', { name: 'Search scripts' });
  await search.fill('Polish');
  await expect(ui.locator('.script-item')).toHaveCount(35);
  await expect(ui.locator('.script-item mark').first()).toHaveText('Polish');
  expect(await ui.locator('.script-list [role=option]').evaluateAll(rows => rows.every(row => (row as HTMLElement).tabIndex === -1))).toBe(true);
  await search.press('Tab'); await expect(ui.locator('.script-search .search-dismiss')).toBeFocused();
  await ui.keyboard.press('Tab'); await expect(ui.locator('.script-preview-code')).toBeFocused();
  await ui.keyboard.press('Tab'); await expect(ui.locator('.palette-footer .footer-back')).toBeFocused();
  await search.click();
  await ui.getByRole('option', { name: 'Polish 03', exact: true }).hover();
  await ui.getByRole('option', { name: 'Polish 04', exact: true }).hover();
  await expect(ui.locator('.script-item.selected')).toHaveText('Polish 00');
  await ui.getByRole('option', { name: 'Polish 04', exact: true }).click();
  await expect(ui.locator('.script-item.selected')).toHaveText('Polish 04');
  await ui.keyboard.press('Control+n'); await expect(ui.locator('.script-item.selected')).toHaveText('Polish 05');
  await ui.keyboard.press('Control+p'); await expect(ui.locator('.script-item.selected')).toHaveText('Polish 04');
  await search.press('Meta+ArrowUp');
  await search.press('Shift+Enter'); await expect(search).toBeVisible();
  await search.press('Control+Shift+n');
  await expect(ui.locator('.script-item.selected')).toContainText('Polish 00');
  await search.press('Meta+ArrowDown');
  await expect(ui.locator('.script-item.selected')).toContainText('Polish 34');
  await search.press('PageUp');
  await expect(ui.locator('.script-item.selected')).not.toContainText('Polish 34');
  await search.press('Meta+ArrowUp');
  for (let i = 0; i < 28; i++) await search.press('Control+n');
  await expect(ui.locator('.script-item.selected')).toContainText('Polish 28');
  expect(await ui.locator('.script-item.selected').evaluate(node => {
    const row = node.getBoundingClientRect(); const body = node.closest('.script-list')!.getBoundingClientRect();
    return row.top >= body.top - 1 && row.bottom <= body.bottom + 1;
  })).toBe(true);
  await search.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 4));
  await expect(ui.locator('.script-search .search-dismiss')).toHaveText('esc');
  await ui.locator('.palette-footer .actions-button').click();
  await ui.getByRole('combobox', { name: 'Search actions' }).fill('edit');
  await ui.locator('.palette-footer .primary-action').click();
  await expect(ui.getByLabel('Name', { exact: true })).toHaveValue('Polish 28');
  await ui.keyboard.press('Escape');
  await expect(search).toBeFocused(); await expect(search).toHaveValue('Polish');
  expect(await search.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 4]);
  await expect(ui.locator('.script-item.selected')).toContainText('Polish 28');
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English interaction polish settings choices accept Control navigation without accidental confirmation', async () => {
  await ui.locator('.search-bar input').fill('theme'); await ui.keyboard.press('Enter');
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
  await page.evaluate(() => localStorage.setItem('polish.key', 'value'));
  const surface = await openStorageOverlay(page);
  await surface.locator('.search-bar input').fill('local storage'); await page.keyboard.press('Enter');
  const search = surface.locator('.storage-search input');
  // A secondary list names its layer at the left of the footer and spends nothing on the ↑↓ hint.
  await expect(surface.locator('.palette-footer .navigation-hint')).toHaveCount(0);
  await expect(surface.locator('.palette-footer-title')).toHaveText('Local Storage');
  await expect(surface.locator('.storage-row')).toHaveCount(1);
  const locationTitle = await surface.locator('.palette-footer-title').boundingBox();
  const contextBox = await surface.locator('.palette-footer-context').boundingBox();
  await surface.locator('.storage-row').first().click();
  await expect(surface.locator('.storage-notice')).toContainText('Value copied');
  await expect(surface.locator('.palette-footer-context')).toHaveCount(0);
  expect(await surface.locator('.palette-footer-title').boundingBox()).toEqual(locationTitle);
  expect((await surface.locator('.palette-footer-status').boundingBox())!.x).toBe(contextBox!.x);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('value');
  await search.fill('polish');
  await search.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 3));
  await surface.locator('.storage-row').first().click({ button: 'right' });
  const actions = surface.getByRole('combobox', { name: 'Search actions' });
  await expect(actions).toBeFocused(); await actions.fill('copy');
  await expect(surface.locator('.action-row mark')).toHaveCount(2);
  await actions.press('Control+n');
  await expect(surface.locator('.palette-footer .primary-action')).toHaveText(/Copy Name/);
  await actions.press('Tab'); await expect(actions).toBeFocused();
  await actions.press('Escape'); await expect(search).toBeFocused();
  expect(await search.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 3]);
  await page.setViewportSize({ width: 390, height: 600 });
  expect(await surface.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test('English shared script lists preserve main geometry at normal and narrow widths', async () => {
  const longCode = Array.from({ length: 100 }, (_, index) => `// Preview line ${index}: ${'long code '.repeat(16)}`).join('\n');
  const { page, surface } = await scriptExecutionFixture(longCode, false);
  await worker.evaluate(() => chrome.storage.local.set(Object.fromEntries(Array.from({ length: 24 }, (_, index) => [
    `saved-script:geometry-${index}`, { title: `Geometry ${String(index).padStart(2, '0')}`, code: `// Script ${index}\n43` },
  ]))));
  const root = surface.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
  const geometry = () => surface.locator('.palette').evaluate(panel => {
    const box = (node: Element) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const first = (selector: string) => box(panel.querySelector(selector)!);
    return { panel: box(panel), search: first('.search-bar'), input: first('.search-bar input'),
      row: first('.result'), icon: first('.result .entry-icon'), footer: first('.palette-footer'),
      navigation: first('.footer-navigation') };
  });
  for (const size of [{ width: 1100, height: 760 }, { width: 390, height: 440 }]) {
    await page.setViewportSize(size);
    await root.fill('manage scripts');
    await expect(surface.getByRole('option').first()).toBeVisible();
    const main = await geometry();
    expect(main.search.height).toBe(56); expect(main.row.height).toBe(40);
    expect(main.icon.width).toBe(26); expect(main.icon.height).toBe(26);
    expect(main.footer.height).toBe(44);
    for (const [command, title] of [['manage scripts', 'Script Library'], ['run script', 'Run Script']]) {
      await root.fill(command); await root.press('Enter');
      const picker = surface.getByRole('combobox', { name: 'Search scripts' });
      await expect(picker).toBeFocused();
      await expect(surface.locator('.palette-footer-title')).toHaveText(title);
      await expect(surface.locator('.settings-header')).toHaveCount(0);
      const current = await geometry();
      for (const key of ['panel', 'search', 'input', 'footer', 'navigation'] as const) expect(current[key]).toEqual(main[key]);
      expect(current.row.height).toBe(main.row.height);
      expect(current.icon.width).toBe(main.icon.width); expect(current.icon.height).toBe(main.icon.height);
      expect(current.row.y).toBe(main.row.y);
      expect(await surface.locator('.script-item').evaluateAll(rows => rows.every(row => (row as HTMLElement).tabIndex === -1))).toBe(true);
      if (command === 'run script') {
        expect(current.row).toEqual(main.row);
        expect(current.icon).toEqual(main.icon);
        await expect(surface.locator('.script-list-detail, .script-preview')).toHaveCount(0);
      }
      await picker.press('Tab'); await expect(surface.locator('.script-search .search-dismiss')).toBeFocused();
      if (command === 'manage scripts') {
        await page.keyboard.press('Tab'); await expect(surface.locator('.script-preview-code')).toBeFocused();
      }
      await page.keyboard.press('Tab'); await expect(surface.locator('.palette-footer .footer-back')).toBeFocused();
      await picker.click();
      await picker.press('Meta+ArrowUp');
      const firstId = await surface.locator('.script-item.selected').getAttribute('id');
      await picker.press('Control+n'); await expect(surface.locator('.script-item.selected')).not.toHaveAttribute('id', firstId!);
      await picker.press('Control+p'); await expect(surface.locator('.script-item.selected')).toHaveAttribute('id', firstId!);
      await expect(surface.locator('.palette-footer .primary-action')).toBeInViewport({ ratio: 1 });
      if (command === 'manage scripts') {
        const list = surface.locator('.script-list');
        const detail = surface.locator('.script-list-detail');
        const preview = surface.getByRole('region', { name: 'Code Preview', exact: true });
        const code = preview.locator('.script-preview-code');
        await surface.getByRole('option', { name: 'Execution helper', exact: true }).click();
        await expect(code).toHaveValue(longCode);
        await expect(list).toBeInViewport({ ratio: 1 });
        await expect(preview).toBeInViewport({ ratio: 1 });
        const listBox = (await list.boundingBox())!;
        const detailBox = (await detail.boundingBox())!;
        if (size.width > 520) {
          expect(listBox.x + listBox.width).toBeLessThanOrEqual(detailBox.x + 1);
          expect(Math.abs(listBox.y - detailBox.y)).toBeLessThanOrEqual(1);
          expect(current.row.width).toBeLessThan(main.row.width);
        } else {
          expect(listBox.y + listBox.height).toBeLessThanOrEqual(detailBox.y + 1);
          expect(Math.abs(listBox.x - detailBox.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(listBox.width - detailBox.width)).toBeLessThanOrEqual(1);
        }
        expect(listBox.height).toBeGreaterThanOrEqual(40);
        expect(detailBox.height).toBeGreaterThan(60);
        await expect(preview.locator('.script-preview-info')).toContainText('Execution helper');
        await expect(preview.locator('.script-preview-info')).toContainText('JavaScript');
        await expect(code).toHaveAttribute('readonly', '');
        await code.focus();
        await expect(code).toBeFocused();
        await code.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(0, 20));
        const selectedId = await picker.getAttribute('aria-activedescendant');
        await code.press('ArrowDown');
        await expect(picker).toHaveAttribute('aria-activedescendant', selectedId!);
        await expect(code).toHaveValue(longCode);
        const fixedGeometry = await geometry();
        const listScroll = await list.evaluate(node => node.scrollTop);
        expect(await code.evaluate(node => node.scrollHeight > node.clientHeight && node.scrollWidth > node.clientWidth)).toBe(true);
        await code.evaluate(node => { node.scrollTop = node.scrollHeight; node.scrollLeft = node.scrollWidth; });
        expect(await code.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
        expect(await code.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
        expect(await list.evaluate(node => node.scrollTop)).toBe(listScroll);
        for (const key of ['panel', 'search', 'footer'] as const) expect((await geometry())[key]).toEqual(fixedGeometry[key]);
        const previewScroll = await code.evaluate(node => ({ top: node.scrollTop, left: node.scrollLeft }));
        await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
        expect(await list.evaluate(node => node.scrollTop)).toBeGreaterThan(listScroll);
        expect(await code.evaluate(node => ({ top: node.scrollTop, left: node.scrollLeft }))).toEqual(previewScroll);
        await list.evaluate(node => { node.scrollTop = 0; });
        await code.evaluate(node => { node.scrollTop = 0; node.scrollLeft = 0; });
        await picker.focus();
        for (const theme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme: theme });
          await surface.locator('.palette').screenshot({ path: test.info().outputPath(`script-preview-${theme}-${size.width}.png`) });
        }
        await expect(surface.locator('.script-item .kind-label')).toHaveText('Built-in');
        await expect(surface.locator('.palette-footer .secondary-action')).toHaveAccessibleName('New Script');
        await expect(surface.locator('.palette-footer .secondary-action')).toBeInViewport({ ratio: 1 });
        if (size.width <= 520) {
          await expect(surface.locator('.secondary-compact-icon')).toBeVisible();
          expect((await surface.locator('.palette-footer-title').boundingBox())!.width).toBeGreaterThan(50);
        }
        await picker.press('Meta+Shift+n');
        await expect(surface.getByLabel('Name', { exact: true })).toBeFocused();
        await expect(surface.locator('.palette-footer-title')).toHaveText('New Script');
        await surface.locator('.palette').screenshot({ path: test.info().outputPath(`script-editor-${size.width}.png`) });
        await surface.locator('.palette-footer .footer-back').click();
        await expect(picker).toBeFocused();
      }
      expect(await surface.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await surface.locator('.palette-footer .footer-back').click();
      await expect(root).toBeFocused(); await expect(root).toHaveValue(command);
    }
  }
});

  test('English interaction polish storage script picker ignores modified Enter before execution', async () => {
  const { page, surface } = await scriptExecutionFixture('42', false);
  await surface.locator('.search-bar input').fill('run script'); await page.keyboard.press('Enter');
  const search = surface.getByRole('combobox', { name: 'Search scripts' });
  await expect(search).toBeFocused();
  await search.press('Shift+Enter'); await expect(search).toBeFocused();
  await search.press('Meta+Enter'); await expect(search).toBeFocused();
  await expect(surface.locator('.script-run-status')).toHaveCount(0);
  await expect(surface.getByRole('alert')).toHaveCount(0);
  await search.press('Enter');
  await expect(surface.getByRole('alert')).toContainText('Enable user scripts');
  await page.keyboard.press('Escape');
  await worker.evaluate(() => chrome.storage.local.set(Object.fromEntries(Array.from({ length: 20 }, (_, at) => [
    `saved-script:context-${at}`, { title: `Context ${String(at).padStart(2, '0')}`, code: '42' },
  ]))));
  await search.fill('Context');
  await expect(surface.locator('.script-item')).toHaveCount(20);
  await search.press('Meta+ArrowDown');
  await expect(surface.locator('.script-item.selected')).toContainText('Context 19');
  await search.press('PageUp');
  await expect(surface.locator('.script-item.selected')).not.toContainText('Context 19');
  await search.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
  await surface.getByRole('option', { name: 'Context 18' }).click();
  await expect(surface.getByRole('alert')).toContainText('Enable user scripts');
  await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
  await expect(surface.locator('.script-item.selected')).toContainText('Context 18');
  expect(await search.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
  await expect(surface.locator('.script-search .search-dismiss')).toHaveText('esc');
  await surface.locator('.script-search .search-dismiss').click();
  await expect(surface.locator('.script-runner')).toHaveCount(0);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test('English result footer storage overlay copies reruns and restores output selection through the shared menu', async () => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { page, surface } = await scriptExecutionFixture('localStorage.setItem("runs", String(Number(localStorage.getItem("runs") || 0) + 1)); "Exact result\\n\\n"');
  const search = surface.locator('.search-bar input');
  await search.fill('Execution helper'); await search.press('Enter');
  const output = surface.getByLabel('Result', { exact: true });
  const primary = surface.locator('.palette-footer .primary-action');
  await expect(output).toHaveValue('Exact result\n\n');
  await expect(primary).toHaveAccessibleName('Copy Result'); await expect(primary).toBeFocused();
  await expect(surface.locator('.script-result-body')).toBeVisible();
  await expect(surface.locator('.script-runner .settings-header')).toHaveCount(0);
  await expect(surface.locator('.palette-footer-title')).toHaveText('Result');
  await expect(surface.locator('.script-result-body .script-controls')).toHaveCount(0);
  await output.focus(); await output.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(2, 8));
  await output.press('Meta+k');
  const menu = surface.getByRole('combobox', { name: 'Search actions' });
  await expect(menu).toBeFocused();
  await expect(surface.locator('.action-row')).toContainText(['Copy Result', 'Run Again']);
  await menu.press('Control+n'); await expect(primary).toHaveAccessibleName('Run Again');
  await menu.press('Control+p'); await expect(primary).toHaveAccessibleName('Copy Result');
  await menu.press('Tab'); await expect(surface.locator('.action-search .search-dismiss')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(menu).toBeFocused();
  await surface.locator('.palette-footer .footer-back').click();
  await expect(menu).toHaveCount(0); await expect(output).toBeFocused();
  await expect(surface.locator('.palette-footer-title')).toHaveText('Result');
  expect(await output.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 8]);
  await output.press('Meta+k'); await menu.fill('copy');
  await expect(surface.locator('.action-row mark')).toHaveText('Copy');
  await menu.press('Enter');
  await expect(surface.getByText('Result copied', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Exact result\n\n');
  await expect(output).toBeFocused();
  expect(await output.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 8]);
  expect(await page.evaluate(() => localStorage.getItem('runs'))).toBe('1');
  await output.press('Meta+k'); await menu.fill('run again');
  await primary.click();
  await expect(output).toHaveValue('Exact result\n\n');
  await expect(primary).toHaveAccessibleName('Copy Result'); await expect(primary).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('runs'))).toBe('2');
  await page.setViewportSize({ width: 390, height: 440 });
  await expect(primary).toBeInViewport();
  expect(await surface.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await primary.locator('.primary-label').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('zing-result-footer-narrow.png') });
  await primary.click(); expect(await page.evaluate(() => localStorage.getItem('runs'))).toBe('2');
  await page.keyboard.press('Escape'); await expect(search).toBeFocused(); await expect(search).toHaveValue('Execution helper');
});
});

test('Chinese result footer guards busy and failed runs and supports retry and menu back navigation', async () => {
  await worker.evaluate(() => chrome.storage.local.set({ 'saved-script:result-fixture': { title: 'Result fixture', code: '42' } }));
  await ui.evaluate(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    const scope = window as unknown as { finishRun?: (value: unknown) => void; runCount: number };
    scope.runCount = 0;
    chrome.runtime.sendMessage = ((request: { type?: string }) => {
      if (request.type !== 'run-saved-script') return send(request);
      scope.runCount++;
      return new Promise<unknown>(resolve => { scope.finishRun = resolve; });
    }) as typeof chrome.runtime.sendMessage;
  });
  const finish = (success: boolean, text: string) => ui.evaluate(({ success, text }) => (window as unknown as { finishRun: (value: unknown) => void }).finishRun({ ok: true, data: { success, text } }), { success, text });
  const root = ui.locator('.search-bar input'); await root.fill('run script'); await root.press('Enter');
  const picker = ui.locator('.script-search input'); await picker.fill('Result fixture');
  await picker.press('Enter');
  const primary = ui.locator('.palette-footer .primary-action');
  await expect(primary).toBeDisabled(); await expect(ui.locator('.actions-button')).toBeDisabled();
  await ui.keyboard.press('Meta+k'); await expect(ui.locator('.action-menu')).toHaveCount(0);
  await finish(false, 'Expected failure');
  await expect(primary).toHaveAccessibleName('重新运行'); await expect(primary).toBeFocused();
  await primary.press('Meta+k');
  await expect(ui.locator('.action-row')).toHaveCount(1); await expect(ui.locator('.action-row')).toContainText('重新运行');
  const menu = ui.locator('.action-search input');
  await menu.fill('copy'); await expect(primary).toBeDisabled();
  await menu.fill(''); await menu.press('Backspace'); await expect(primary).toBeFocused();
  await primary.dispatchEvent('keydown', { key: 'Enter', repeat: true });
  await primary.press('Shift+Enter');
  expect(await ui.evaluate(() => (window as unknown as { runCount: number }).runCount)).toBe(1);
  await primary.press('Enter'); await expect(primary).toBeDisabled();
  expect(await ui.evaluate(() => (window as unknown as { runCount: number }).runCount)).toBe(2);
  await finish(true, '');
  await expect(ui.locator('.script-output')).toHaveValue('');
  await expect(primary).toHaveAccessibleName('复制结果'); await expect(primary).toBeEnabled();
  await ui.evaluate(() => {
    document.execCommand = () => false;
    navigator.clipboard.writeText = async () => { throw new Error('Clipboard fixture unavailable'); };
  });
  await primary.click();
  await expect(ui.getByRole('alert')).toContainText('复制失败');
  await expect(primary).toBeEnabled(); await expect(ui.locator('.script-output')).toHaveValue('');
  // Native popup uses its declared 750×516 surface; the overlay case above covers small viewports.
  await ui.setViewportSize({ width: 750, height: 516 });
  await expect(primary).toBeInViewport();
  expect(await primary.locator('.primary-label').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('zing-result-footer-chinese.png') });
  await primary.press('Meta+k'); await menu.press('Control+n'); await menu.press('Enter');
  await expect(primary).toBeDisabled();
  await ui.keyboard.press('Escape'); await expect(picker).toBeFocused(); await expect(picker).toHaveValue('Result fixture');
  await finish(true, 'Late result');
  await expect(picker).toBeFocused(); await expect(ui.locator('.script-output')).toHaveCount(0);
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English recent bridge storage overlay shares palette geometry and focuses its capsule only after search activation', async () => {
  const f = await bridgeFixture();
  await worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  const surface = f.a.frameLocator('.zing-frame');
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
  await expect(f.a.locator('#zing-command-palette')).toBeAttached();
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
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('zing-switcher-shared-footer.png') });
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
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('zing-switcher-activated.png') });
  await f.a.keyboard.up('Control');
  await expect(surface.getByRole('combobox')).toBeFocused();
  expect(await f.active()).toBe(f.ids.source);
  await surface.locator('.primary-action').click();
  await expect.poll(f.active).toBe(Number(initial!.replace('recent-', '')));
  await expect(f.a.locator('#zing-command-palette')).not.toBeAttached();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English recent bridge storage overlay held search activation ignores release and confirms filtered results with Enter', async () => {
  const f = await bridgeFixture();
  const extra = await context.newPage(); await extra.goto(`${origin}/Bridge-C`);
  await f.a.bringToFront();
  await f.a.keyboard.down('Control'); await f.open();
  const surface = f.a.frameLocator('.zing-frame');
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
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('zing-switcher-filtered.png') });
  const target = Number((await input.getAttribute('aria-activedescendant'))!.replace('recent-', ''));
  await f.a.keyboard.up('Control');
  await expect(input).toBeFocused(); await expect(input).toHaveValue('Bridge C');
  await expect(f.a.locator('#zing-command-palette')).toBeAttached();
  expect(await f.active()).toBe(f.ids.source);
  await f.a.keyboard.press('Enter');
  await expect.poll(f.active).toBe(target);
  await expect(f.a.locator('#zing-command-palette')).not.toBeAttached();
});
});

for (const method of ['wrapper', 'icon', 'keyboard'] as const) test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test(`English recent bridge storage overlay search accepts typing after ${method} and release`, async () => {
  const f = await bridgeFixture();
  await f.a.keyboard.down('Control'); await f.open();
  const surface = f.a.frameLocator('.zing-frame');
  const input = surface.getByRole('combobox');
  await expect(surface.getByRole('listbox')).toBeFocused(); await expect(input).toBeDisabled();
  if (method === 'wrapper') await surface.locator('.recent-search-field').click();
  else if (method === 'icon') await surface.locator('button.search-icon.recent-search-activate').click();
  else await f.a.keyboard.press('f');
  await expect(input).toBeEnabled();
  await expect(surface.locator('.palette-footer-title')).toHaveText('Switch Recent Tabs');
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
  await surface.locator('.palette').screenshot({ path: test.info().outputPath(`zing-switcher-search-${method}.png`) });
  await f.a.keyboard.press('Enter');
  await expect.poll(f.active).toBe(f.ids.previous);
  await expect(f.a.locator('#zing-command-palette')).not.toBeAttached();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English recent bridge storage overlay search with no matches stays open until a visible choice', async () => {
  const f = await bridgeFixture();
  await f.a.keyboard.down('Control'); await f.open();
  const surface = f.a.frameLocator('.zing-frame');
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
    await expect(page.locator('#zing-command-palette')).not.toBeAttached();
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
  await expect(f.a.locator('#zing-command-palette')).not.toBeAttached();
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
      const surface = f.a.frameLocator('.zing-frame');
      await expect(surface.getByRole('listbox')).toBeFocused();
      if (reason === 'Escape') await f.a.keyboard.press('Escape');
      if (reason === 'outside click') await surface.locator('.recent-overlay').click({ position: { x: 5, y: 5 } });
      if (reason === 'another window') await worker.evaluate(() => chrome.windows.create({ url: 'about:blank', focused: true }));
      if (reason === 'another tab') await worker.evaluate(id => chrome.tabs.update(id, { active: true }), f.ids.previous);
    }
    await expect(f.a.locator('#zing-command-palette')).not.toBeAttached();
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
  const surface = f.a.frameLocator('.zing-frame');
  await expect(surface.getByRole('listbox')).toBeFocused();
  await worker.evaluate(id => chrome.tabs.remove(id), f.ids.previous);
  await expect(surface.locator('[aria-selected=true]')).toHaveAttribute('id', `recent-${f.ids.source}`);
  await f.a.keyboard.up('Control');
  await expect(f.a.locator('#zing-command-palette')).not.toBeAttached();
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
  await expect(f.a.locator('#zing-command-palette')).not.toBeAttached();
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
  const surface = f.a.frameLocator('.zing-frame');
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
  await surface.locator('.palette').screenshot({ path: test.info().outputPath(`zing-switcher-shared-footer-narrow-${language}.png`) });
  await surface.getByRole('option').filter({ hasText: 'Bridge B' }).click();
  await expect.poll(f.active).toBe(f.ids.previous);
  await expect(f.a.locator('#zing-command-palette')).not.toBeAttached();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true } });
  test('English recent bridge storage overlay closes safely when its worker stops', async () => {
  const f = await bridgeFixture(); await f.a.keyboard.down('Control'); await f.open();
  await expect(f.a.frameLocator('.zing-frame').getByRole('listbox')).toBeFocused();
  const monitor = await context.newCDPSession(f.a);
  await monitor.send('ServiceWorker.enable'); await monitor.send('ServiceWorker.stopAllWorkers');
  await expect(f.a.locator('#zing-command-palette')).not.toBeAttached();
});
});

for (const action of ['header cancel', 'footer cancel', 'search', 'switch'] as const) test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, commands: true } });
  test(`English recent bridge closed storage overlay Enter belongs to focused ${action} button`, async () => {
  const f = await bridgeFixture(); await f.a.keyboard.down('Control'); await f.open();
  await expect(f.a.locator('#zing-command-palette')).toBeAttached();
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
  await expect(f.a.locator('#zing-command-palette')).not.toBeAttached();
  expect(await f.active()).toBe(action === 'switch' ? f.ids.previous : f.ids.source);
});
});

for (const vimium of [false, true]) test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, commands: true, vimium } });
  test(`English recent bridge closed storage overlay preserves ${vimium ? 'Vimium' : 'production'} navigation and release`, async () => {
  const f = await bridgeFixture(); await f.a.keyboard.down('Control'); await f.open();
  await expect(f.a.locator('#zing-command-palette')).toBeAttached();
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
  await expect(f.a.locator('#zing-command-palette')).not.toBeAttached();
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
      const dialog = document.querySelector('#zing-command-palette')?.shadowRoot?.querySelector('dialog');
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
  const surface = f.a.frameLocator('.zing-frame');
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
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('zing-switcher-disabled.png') });
  await f.a.keyboard.up('Control');
  await expect.poll(f.active).toBe(f.ids.previous);
  await expect(f.a.locator('#zing-command-palette')).not.toBeAttached();
  await f.a.bringToFront();
  await f.a.keyboard.down('Control'); await f.open();
  await expect(surface.locator('.current-badge')).toHaveText('Current');
  await expect(surface.locator('.search-dismiss')).toHaveAttribute('title', 'Escape — Cancel');
  await surface.getByRole('button', { name: 'Search recent tabs…' }).click();
  await expect(surface.getByRole('combobox')).toBeEnabled();
  await f.a.keyboard.up('Control');
  await expect(f.a.locator('#zing-command-palette')).toBeAttached();
  expect(await f.active()).toBe(f.ids.source);
  await surface.locator('.search-dismiss').click();
  await expect(f.a.locator('#zing-command-palette')).not.toBeAttached();
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
    test(`English reload zing extension via ${method} preserves pages and reopens the palette`, async () => {
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
        await expect(page.locator('#zing-command-palette')).toBeAttached();
      };
      await launch();
      await page.keyboard.type(method === 'mouse' ? 'Zing: Reload' : 'Zing：重新加载');
      const nextWorker = context.waitForEvent('serviceworker', candidate => candidate.url() === worker.url());
      const oldWorker = worker;
      const stopped = oldWorker.waitForEvent('close');
      if (method === 'mouse') {
        const frame = page.frameLocator('.zing-frame');
        await expect(frame.getByRole('option').first().locator('.entry-title')).toHaveText('Zing: Reload');
        await frame.getByRole('option').first().click();
      } else {
        await page.keyboard.press('Shift+Enter');
        await expect(page.locator('#zing-command-palette')).toBeAttached();
        await page.keyboard.press('Enter');
      }
      await expect(page.locator('#zing-command-palette')).not.toBeAttached();
      await stopped;
      worker = await nextWorker;
      await expect(page.getByRole('textbox', { name: 'Page input' })).toHaveValue('keep this text');
      await expect(page.getByRole('textbox', { name: 'Page input' })).toBeFocused();
      expect(await worker.evaluate(async () => (await chrome.storage.local.get('reloadFixture')).reloadFixture)).toBe('kept');
      await expect.poll(() => ui.isClosed()).toBe(true);
      await launch();
      await page.keyboard.type('settings');
      await page.keyboard.press('Enter');
      if (method === 'mouse') await expect(page.frameLocator('.zing-frame').getByRole('textbox', { name: 'Search settings' })).toBeFocused();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(page.locator('#zing-command-palette')).not.toBeAttached();
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
    const reply = await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'zing', type: 'snapshot' }));
    expect(reply.ok, `wake ${round}: ${JSON.stringify(errors)}`).toBe(true);
    if (round % 5 === 4) {
      await ui.evaluate(() => chrome.runtime.reload()).catch(() => {});
      ui = await context.newPage();
      await expect.poll(async () => {
        try { await ui.goto(popupUrl); return await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'zing', type: 'snapshot' })).then(reply => reply.ok); }
        catch { return false; }
      }, { message: JSON.stringify(errors) }).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open' } });
  test('English storage overlay refuses an unfocused page and opens after focus returns', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Focus-boundary`);
  const id = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, page.url());
  await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }), id);
  // Headless Chrome emulates tab focus, so inject the observed native failure
  // at the isolated-world boundary. Native omnibox acceptance is separate.
  await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false });
  } }), id);
  expect(await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { source: 'zing', type: 'toggle' }, { frameId: 0 }), id)).toBe(false);
  await expect(page.locator('#zing-command-palette')).not.toBeAttached();
  await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
    Reflect.deleteProperty(document, 'hasFocus');
    window.focus();
  } }), id);
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
  expect(await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { source: 'zing', type: 'toggle' }, { frameId: 0 }), id)).toBe(true);
  const search = page.frameLocator('.zing-frame').getByRole('combobox');
  await expect(search).toBeFocused();
  await page.keyboard.type('settings');
  await expect(search).toHaveValue('settings');
  await page.keyboard.press('Escape');
  await expect(page.locator('#zing-command-palette')).not.toBeAttached();
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
  await expect(palette.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' })).toBeFocused();
  return { source, palette };
}

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
    const search = palette.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
    await search.fill('extensions');
    await expect(palette.locator('#zing-results [role="option"]').first()).toHaveAttribute('id', 'zing-command:openExtensions');
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
    const reply = await chrome.runtime.sendMessage({ source: 'zing', type: 'snapshot' });
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
  const input = palette.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
  await input.fill('settings'); await input.press('Enter');
  await expect(palette.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  await palette.keyboard.press('Escape'); await expect(input).toBeFocused();
  await input.fill('pin tab');
  await input.press('Enter');
  await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).pinned, source.tabId)).toBe(true);
  await expect(input).toHaveValue('pin tab');
  await expect(input).toBeFocused();
  await expect(palette.locator('[id="zing-command:pin"] .entry-title')).toContainText('Unpin Tab');
  expect((await worker.evaluate(id => chrome.tabs.get(id), source.tabId)).windowId).toBe(source.windowId);
});
});

for (const layer of ['root', 'group'] as const) test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true, headed: true } });
  test(`English keep-open overlay source close continues ${layer} search in a native window with explicit reselection`, async () => {
    const sourcePage = await context.newPage();
    await sourcePage.goto(`${origin}/Continuation-member-source`);
    const seeded = await worker.evaluate(async ({ origin, grouped }) => {
      const source = (await chrome.tabs.query({})).find(tab => tab.url === `${origin}/Continuation-member-source`)!;
      // Put a non-injectable native page immediately to the right of the source.
      // The fixture grants loopback access only; the handoff must use a window.
      const successor = await chrome.tabs.create({ windowId: source.windowId, index: source.index + 1, url: 'chrome://version/', active: false });
      const another = await chrome.tabs.create({ windowId: source.windowId, index: source.index + 2, url: `${origin}/Continuation-member-another`, active: false });
      const last = await chrome.tabs.create({ windowId: source.windowId, index: source.index + 3, url: `${origin}/Continuation-member-last`, active: false });
      const groupId = grouped ? await chrome.tabs.group({ tabIds: [source.id!, successor.id!, another.id!, last.id!] }) : undefined;
      if (groupId !== undefined) await chrome.tabGroups.update(groupId, { title: 'Continuation Research', color: 'blue', collapsed: false });
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
    const surface = sourcePage.frameLocator('.zing-frame');
    const root = surface.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
    await expect(root).toBeFocused();
    if (layer === 'root') {
      await root.fill('close tab');
      await expect(surface.locator('#zing-results [aria-selected="true"]')).toHaveAttribute('id', 'zing-command:close');
      await surface.locator('.palette-footer .primary-action').click().catch(error => { if (!sourcePage.isClosed()) throw error; });
    } else {
      await root.fill('Continuation Research');
      await surface.getByRole('option').filter({ hasText: 'Tab Group: Continuation Research' }).click();
      await surface.getByRole('combobox', { name: 'Search tabs in this group…' }).fill('member');
      await surface.locator(`[id="group-tab:${seeded.source}"]`).click({ button: 'right' });
      await surface.locator('#group-actions-close').click().catch(error => { if (!sourcePage.isClosed()) throw error; });
    }
    await expect.poll(() => sourcePage.isClosed()).toBe(true);
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(tab => tab.id === id), seeded.source)).toBe(false);
    await expect.poll(() => context.pages().filter(page => page.url().includes('popup.html#window=')).length).toBe(1);
    const palette = context.pages().find(page => page.url().includes('popup.html#window='))!;
    const input = palette.getByRole('combobox', { name: layer === 'root' ? 'Search commands, tabs, and bookmarks' : 'Search tabs in this group…' });
    await expect(input).toHaveValue(layer === 'root' ? 'close tab' : 'member');
    await expect(input).toBeFocused();
    const ownWindow = await palette.evaluate(() => chrome.windows.getCurrent());
    expect(ownWindow.type).toBe('popup');
    expect(ownWindow.id).not.toBe(seeded.windowId);
    await expect.poll(() => worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0]?.id, seeded.windowId)).toBe(seeded.successor);
    const list = palette.locator(layer === 'root' ? '#zing-results' : '#zing-group-tabs');
    await expect(list.locator('[aria-selected="true"]')).toHaveCount(0);
    if (layer === 'root') await expect(palette.locator('.palette-footer .primary-action')).toBeDisabled();
    else await expect(palette.locator('.palette-footer .primary-action:enabled')).toHaveCount(0);
    const before = await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId })).map(tab => tab.id!).sort((a, b) => a - b), seeded.windowId);
    await input.press('Enter');
    await input.press('Enter');
    await expect(input).toBeFocused();
    await expect(list.locator('[aria-selected="true"]')).toHaveCount(0);
    expect(await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId })).map(tab => tab.id!).sort((a, b) => a - b), seeded.windowId)).toEqual(before);
    expect(await worker.evaluate(id => chrome.tabs.get(id), seeded.successor)).toMatchObject({ active: true, url: 'chrome://version/' });
    if (layer === 'root') await input.fill('Continuation member');
    await palette.locator(`[id="${layer === 'root' ? 'zing' : 'group'}-tab:${seeded.another}"]`).click({ button: 'right' });
    await palette.locator(layer === 'root' ? '[id="zing-actions-action:close"]' : '#group-actions-close').click();
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(tab => tab.id === id), seeded.another)).toBe(false);
    await expect(input).toHaveValue(layer === 'root' ? 'Continuation member' : 'member');
    await expect(input).toBeFocused();
    await expect(palette.getByRole('dialog')).toHaveCount(0);
    expect(await worker.evaluate(id => chrome.tabs.get(id), seeded.successor)).toMatchObject({ active: true, windowId: seeded.windowId });
    expect(await worker.evaluate(id => chrome.tabs.get(id), seeded.last)).toMatchObject({ windowId: seeded.windowId });
    if (layer === 'group') {
      await expect(palette.locator('.palette-footer .footer-title-label')).toHaveText('Tab Group: Continuation Research');
      await palette.keyboard.press('Escape');
      const restored = palette.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
      await expect(restored).toHaveValue('Continuation Research');
      await expect(restored).toBeFocused();
    }
  });
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US', commands: true, headed: true } });
  test('English keep-open native source close preserves query and requires keyboard reselection', async () => {
    const successor = await worker.evaluate(async () => {
      const tab = await chrome.tabs.create({ url: 'chrome://downloads/', active: false });
      return tab.id!;
    });
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).status, successor)).toBe('complete');
    const { source, palette } = await openNativePalette();
    const input = palette.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
    await input.fill('close tab');
    await expect(palette.locator('#zing-results [aria-selected="true"]')).toHaveAttribute('id', 'zing-command:close');
    await input.press('Enter').catch(error => { if (!palette.isClosed()) throw error; });
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(tab => tab.id === id), source.tabId)).toBe(false);
    await expect.poll(() => context.pages().filter(page => page.url().includes('popup.html#window=')).length).toBe(1);
    const continued = context.pages().find(page => page.url().includes('popup.html#window='))!;
    const search = continued.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
    await expect(search).toHaveValue('close tab');
    await expect(search).toBeFocused();
    await expect(continued.locator('#zing-results [aria-selected="true"]')).toHaveCount(0);
    await expect(continued.locator('.palette-footer .primary-action')).toBeDisabled();
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).active, successor)).toBe(true);
    const before = await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId })).map(tab => tab.id!).sort((a, b) => a - b), source.windowId);
    await search.press('Enter');
    await expect(search).toBeFocused();
    expect(await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId })).map(tab => tab.id!).sort((a, b) => a - b), source.windowId)).toEqual(before);
    await search.press('ArrowDown');
    await expect(continued.locator('#zing-results [aria-selected="true"]')).toHaveAttribute('id', 'zing-command:close');
    await expect(continued.locator('.palette-footer .primary-action')).toBeEnabled();
    // Changing the query also explicitly selects a result and allows normal navigation.
    await continued.keyboard.press('Meta+a'); await continued.keyboard.type('settings');
    await expect(search).toHaveValue('settings');
    await continued.keyboard.press('Enter');
    await expect(continued.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  });

  test('English keep-open neutral native handoff accepts mouse Pin and Mute selection for subsequent Enter', async () => {
    const successor = await worker.evaluate(async () => (await chrome.tabs.create({ url: 'chrome://downloads/', active: false })).id!);
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).status, successor)).toBe('complete');
    const { source, palette } = await openNativePalette();
    await palette.locator(`[id="zing-tab:${source.tabId}"]`).click({ button: 'right' });
    await palette.locator('[id="zing-actions-action:close"]').click();
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(tab => tab.id === id), source.tabId)).toBe(false);
    const input = palette.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
    await expect(input).toHaveValue(''); await expect(input).toBeFocused();
    await expect(palette.locator('#zing-results [aria-selected="true"]')).toHaveCount(0);
    await expect(palette.locator('.palette-footer .primary-action')).toBeDisabled();
    await input.press('Enter');
    expect(await worker.evaluate(id => chrome.tabs.get(id), successor)).toMatchObject({ active: true, pinned: false });
    for (const action of ['pin', 'mute'] as const) {
      const row = palette.locator(`[id="zing-command:${action}"]`);
      await row.click();
      const state = () => worker.evaluate(async ({ id, action }) => {
        const tab = await chrome.tabs.get(id); return action === 'pin' ? tab.pinned : tab.mutedInfo?.muted;
      }, { id: successor, action });
      await expect.poll(state).toBe(true);
      await expect(row).toHaveAttribute('aria-selected', 'true');
      await expect(row.locator('.entry-title')).toContainText(action === 'pin' ? 'Unpin Tab' : 'Unmute Tab');
      await expect(palette.locator('.palette-footer .primary-action')).toBeEnabled();
      await expect(input).toBeFocused(); await expect(input).toHaveValue('');
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
    await palette.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' }).fill('close tab');
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
  test('English keep-open explicit Escape cancels a pending source-close continuation', async () => {
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
      const state = { release: undefined as (() => void) | undefined, cancelled: false, settled: false, popups: [] as number[] };
      (globalThis as unknown as { __cancelledClose: typeof state }).__cancelledClose = state;
      chrome.windows.onCreated.addListener(window => { if (window.type === 'popup') state.popups.push(window.id!); });
      chrome.runtime.onMessage.addListener(message => { if (message.type === 'cancel-palette-continuation') state.cancelled = true; });
      chrome.tabs.remove = (async (ids: number | number[]) => {
        if ((Array.isArray(ids) ? ids : [ids]).includes(sourceId)) {
          await new Promise<void>(resolve => { state.release = resolve; });
        }
        return original(Array.isArray(ids) ? ids : [ids]);
      }) as typeof chrome.tabs.remove;
      // A cancelled handoff clears its session before releasing pending.done.
      // Observe that real cleanup so reopening cannot race the held operation.
      const removeSession = chrome.storage.session.remove.bind(chrome.storage.session);
      chrome.storage.session.remove = (async (keys: string | string[]) => {
        const result = await removeSession(keys);
        if ((Array.isArray(keys) ? keys : [keys]).includes('zingPaletteWindow') && state.release &&
            !(await chrome.tabs.query({})).some(tab => tab.id === sourceId)) state.settled = true;
        return result;
      }) as typeof chrome.storage.session.remove;
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    }, seeded.source);
    const input = page.frameLocator('.zing-frame').getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
    await expect(input).toBeFocused(); await input.fill('close tab'); await input.press('Enter');
    await expect.poll(() => worker.evaluate(() => typeof (globalThis as unknown as { __cancelledClose: { release?: () => void } }).__cancelledClose.release)).toBe('function');
    await page.keyboard.press('Escape');
    await expect(page.locator('#zing-command-palette')).not.toBeAttached();
    await expect.poll(() => worker.evaluate(() => (globalThis as unknown as { __cancelledClose: { cancelled: boolean } }).__cancelledClose.cancelled)).toBe(true);
    expect(await worker.evaluate(async id => (await chrome.tabs.get(id)).active, seeded.source)).toBe(true);
    await worker.evaluate(() => (globalThis as unknown as { __cancelledClose: { release: () => void } }).__cancelledClose.release());
    await expect.poll(() => page.isClosed()).toBe(true);
    await expect.poll(() => worker.evaluate(() => (globalThis as unknown as { __cancelledClose: { settled: boolean } }).__cancelledClose.settled)).toBe(true);
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).active, seeded.successor)).toBe(true);
    // A fresh real command proves the pending close has drained. The only
    // popup ever created must belong to this explicit new launch.
    await worker.evaluate(async () => {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    });
    await expect.poll(() => context.pages().filter(page => page.url().includes('popup.html#window=')).length).toBe(1);
    const reopened = context.pages().find(page => page.url().includes('popup.html#window='))!;
    await expect(reopened.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' })).toHaveValue('');
    await expect(reopened.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' })).toBeFocused();
    expect(await worker.evaluate(() => (globalThis as unknown as { __cancelledClose: { popups: number[] } }).__cancelledClose.popups)).toHaveLength(1);
    expect(await worker.evaluate(async () => (await chrome.storage.session.get<{ zingPaletteWindow: { sourceTabId: number } }>('zingPaletteWindow')).zingPaletteWindow.sourceTabId)).toBe(seeded.successor);
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
      id === tabId && message.source === 'zing-recent' && message.type === 'arm' ? Promise.resolve({ held: true }) : send(id, message, options) });
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
  const surface = page.frameLocator('.zing-frame');
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
  await writeFile(test.info().outputPath(`zing-switcher-polish-${zoom * 100}.png`), Buffer.from(screenshot.data, 'base64'));
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
  test('English Tab Group search management and nested keyboard navigation', async () => {
  const setup = await worker.evaluate(async origin => {
    const a = await chrome.tabs.create({ url: `${origin}/Group-Alpha`, active: false });
    const b = await chrome.tabs.create({ url: `${origin}/Group-Beta`, active: false });
    const id = await chrome.tabs.group({ tabIds: [a.id!, b.id!] });
    await chrome.tabGroups.update(id, { title: 'Research', color: 'blue', collapsed: true });
    return { id, a: a.id!, b: b.id! };
  }, origin);
  await ui.setViewportSize({ width: 750, height: 516 });
  const root = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
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
  expect(await ui.locator('#zing-group-tabs').evaluate(node => node.scrollTop)).toBeGreaterThan(0);
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
  await action('Change Group Color');
  await ui.getByLabel('Change Group Color', { exact: true }).selectOption('purple');
  await ui.getByRole('button', { name: 'Save', exact: true }).click();
  expect(await worker.evaluate(id => chrome.tabGroups.get(id), setup.id)).toMatchObject({ title: 'Reading', color: 'purple' });
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('zing-tab-group-en.png') });
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
  const root = ui.getByRole('combobox', { name: '搜索命令、标签页和书签' });
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
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('zing-tab-group-zh.png') });
  await worker.evaluate(id => chrome.tabGroups.update(id, { title: '外部改名' }), group);
  // This headless Chrome does not reliably emit tabGroups.onUpdated for API edits.
  // Exercise the existing refresh-on-focus path used when returning to zing.
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
  const surface = page.frameLocator('.zing-frame');
  await surface.getByRole('combobox').fill('Narrow');
  await surface.getByRole('option').filter({ hasText: 'Tab Group: Narrow' }).click();
  const primary = surface.locator('.palette-footer .primary-action');
  await expect(primary).toBeInViewport();
  expect(await surface.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('zing-tab-group-narrow.png') });
  await page.keyboard.press('Meta+k'); await page.keyboard.press('Escape');
  await expect(surface.getByRole('combobox', { name: 'Search tabs in this group…' })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(surface.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' })).toBeFocused();
});
});

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English Undo Tuck restores keyboard focus after a command keeps the palette open', async () => {
  const target = await worker.evaluate(async origin => {
    const tab = await chrome.tabs.create({ url: `${origin}/Undo-focus`, active: false });
    return { tabId: tab.id!, windowId: tab.windowId };
  }, origin);
  expect(await ui.evaluate(payload => chrome.runtime.sendMessage({ source: 'zing', type: 'execute', payload }), { action: 'tuck', ...target })).toMatchObject({ ok: true });
  const input = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
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
  const surface = page.frameLocator('.zing-frame');
  const input = surface.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
  for (const menu of [false, true]) {
    expect(await ui.evaluate(payload => chrome.runtime.sendMessage({ source: 'zing', type: 'execute', payload }), { action: 'tuck', ...target })).toMatchObject({ ok: true });
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
      const port = chrome.runtime.connect({ name: 'zing' });
      port.onMessage.addListener(message => { if (message.source === 'zing' && message.type === 'changed') state.changes++; });
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
    const input = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
    await input.fill('Batch fixture');
    const rows = ui.locator('#zing-results .result');
    await expect(rows).toHaveCount(4);
    const order = await rows.evaluateAll(nodes => nodes.map(node => node.id));
    const target = Number(order[1].split(':')[1]);
    await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 7));
    await ui.clock.install(); await ui.clock.pauseAt(new Date());
    await holdExecution();
    await ui.locator(`[id="${order[1]}"]`).click({ button: 'right' });
    await ui.locator('[id="zing-actions-action:close"]').click();
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
    await expect(ui.locator('#zing-results [aria-selected="true"]')).toHaveAttribute('id', order[2]);
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
    const input = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
    await input.fill('Batch fixture');
    await expect(ui.locator('#zing-results .result')).toHaveCount(3);
    await expect(ui.locator(`[id="zing-tab:${target}"]`)).toHaveCount(0);
    await ui.evaluate(() => (globalThis as unknown as { __retrySnapshot: { release: () => void } }).__retrySnapshot.release());
    // Flush promise continuations and React's next paint before checking stale delivery.
    await ui.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(ui.locator('#zing-results .result')).toHaveCount(3);
    await expect(ui.locator(`[id="zing-tab:${target}"]`)).toHaveCount(0);
    await expect(input).toHaveValue('Batch fixture');
    await expect(input).toBeFocused();
    expect(await worker.evaluate(async ids => (await chrome.tabs.query({})).filter(tab => ids.includes(tab.id!)).length, ids)).toBe(3);
  });

  test('English keep-open pending group mutation stays busy after Escape returns to root', async () => {
    const { ids } = await seedManagementTabs('Batch Research');
    const root = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
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
    await ui.locator(`[id="zing-tab:${ids[2]}"]`).click();
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
    const input = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
    const rows = ui.locator('#zing-results .result');
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
      await ui.locator('[id="zing-actions-action:close"]').click();
      remaining.splice(index, 1);
      await expect(rows).toHaveCount(remaining.length);
      await expect(ui.getByRole('dialog')).toHaveCount(0);
      await expect(input).toHaveValue('Batch fixture');
      await expect(input).toBeFocused();
      expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 7]);
      await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(tab => tab.id === id), Number(target.split(':')[1]))).toBe(false);
      if (remaining.length) {
        await expect(ui.locator('#zing-results [aria-selected="true"]')).toHaveAttribute('id', remaining[Math.min(index, remaining.length - 1)]);
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
    const input = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
    await input.fill('Batch fixture');
    await expect(ui.locator('#zing-results .result')).toHaveCount(4);
    const order = await ui.locator('#zing-results .result').evaluateAll(nodes => nodes.map(node => node.id));
    await input.press('ArrowDown');
    await expect(ui.locator('#zing-results [aria-selected="true"]')).toHaveAttribute('id', order[1]);
    await input.press('ArrowLeft');
    await input.press('Shift+ArrowLeft');
    await input.press('Shift+ArrowLeft');
    const caret = await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd]);
    expect(caret).toEqual([10, 12]);
    await input.press('Meta+k');
    await expect(ui.getByRole('combobox', { name: 'Search actions' })).toBeFocused();
    await ui.keyboard.type('close tab');
    await expect(ui.locator('#zing-actions [aria-selected="true"]')).toHaveAttribute('id', 'zing-actions-action:close');
    await ui.keyboard.press('Enter');
    await expect(ui.getByRole('dialog')).toHaveCount(0);
    await expect(ui.locator('#zing-results .result')).toHaveCount(3);
    await expect(ui.locator('#zing-results [aria-selected="true"]')).toHaveAttribute('id', order[2]);
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
    const input = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
    const row = ui.locator(`[id="zing-tab:${target}"]`);
    await input.fill('Batch fixture');
    await expect(ui.locator('#zing-results .result')).toHaveCount(4);
    for (const operation of [
      { action: 'pin', title: 'Pin Tab', inverse: 'Unpin Tab', badge: 'Pinned', value: true },
      { action: 'pin', title: 'Unpin Tab', inverse: 'Pin Tab', badge: 'Pinned', value: false },
      { action: 'mute', title: 'Mute Tab', inverse: 'Unmute Tab', badge: 'Muted', value: true },
      { action: 'mute', title: 'Unmute Tab', inverse: 'Mute Tab', badge: 'Muted', value: false },
    ]) {
      await row.click({ button: 'right' });
      const action = ui.locator(`[id="zing-actions-action:${operation.action}"]`);
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
    const root = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
    await root.fill('Batch Research');
    await ui.getByRole('option').filter({ hasText: 'Tab Group: Batch Research' }).click();
    const input = ui.getByRole('combobox', { name: 'Search tabs in this group…' });
    await input.fill('Batch fixture');
    const rows = ui.locator('#zing-group-tabs .result');
    await expect(rows).toHaveCount(4);
    const order = await rows.evaluateAll(nodes => nodes.map(node => node.id));
    await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 7));
    await ui.locator(`[id="${order[1]}"]`).click({ button: 'right' });
    await ui.locator('#group-actions-close').click();
    await expect(rows).toHaveCount(3);
    await expect(ui.locator('#zing-group-tabs [aria-selected="true"]')).toHaveAttribute('id', order[2]);
    await expect(input).toHaveValue('Batch fixture');
    await expect(input).toBeFocused();
    expect(await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 7]);
    await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.query({})).some(tab => tab.id === id), Number(order[1].split(':')[1]))).toBe(false);
    await input.press('ArrowDown');
    await expect(ui.locator('#zing-group-tabs [aria-selected="true"]')).toHaveAttribute('id', order[3]);
    await input.press('Meta+k');
    await ui.keyboard.type('remove tab from group');
    await ui.keyboard.press('Enter');
    await expect(rows).toHaveCount(2);
    await expect(ui.getByRole('dialog')).toHaveCount(0);
    await expect(ui.locator('#zing-group-tabs [aria-selected="true"]')).toHaveAttribute('id', order[2]);
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
  const input = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
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
