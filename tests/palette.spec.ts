import { test, expect, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm, readdir, access, cp, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { UsageRecord } from '../src/usage';

let server: Server;
let origin: string;
let context: BrowserContext;
let ui: Page;
let worker: Worker;
let profile: string;
let popupUrl: string;
let testExtension: string | undefined;

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
test.beforeEach(async ({}, testInfo) => {
  profile = await mkdtemp(join(tmpdir(), 'zing-e2e-'));
  let extension = resolve('dist');
  testExtension = undefined;
  if ((testInfo.title.includes('overlay') || testInfo.title.includes('storage'))) {
    testExtension = `${profile}-extension`;
    await cp(extension, testExtension, { recursive: true });
    const manifest = JSON.parse(await readFile(join(testExtension, 'manifest.json'), 'utf8'));
    // Headless Chrome cannot press the toolbar accelerator that grants activeTab.
    // Grant only the loopback fixture in this temporary test copy; production is unchanged.
    manifest.host_permissions = ['*://127.0.0.1/*'];
    if (testInfo.title.includes('cookie domains')) manifest.host_permissions.push('*://app.example.test/*', '*://example.test/*');
    await writeFile(join(testExtension, 'manifest.json'), JSON.stringify(manifest));
    if (testInfo.title.includes('storage') && !testInfo.title.includes('closed storage')) {
      // Open only the test copy's shadow roots so Playwright can inspect the real iframe UI.
      const content = join(testExtension, 'content.js');
      await writeFile(content, (await readFile(content, 'utf8')).replaceAll('mode:"closed"', 'mode:"open"'));
    }
    extension = testExtension;
  }
  if (testInfo.title.includes('recent bridge') || testInfo.title.includes('palette launch')) {
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
  const locale = testInfo.title.includes('English') ? 'en-US' : testInfo.title.includes('fallback') ? 'fr-FR' : testInfo.title.includes('Taiwan') ? 'zh-TW' : 'zh-CN';
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
  const vimium = testInfo.title.includes('storage') && !testInfo.title.includes('closed storage') ? undefined : process.env.ZING_VIMIUM_PATH;
  context = await chromium.launchPersistentContext(profile, {
    ignoreDefaultArgs: process.platform === 'darwin' ? ['about:blank'] : [],
    locale, headless: true, reducedMotion: 'reduce', executablePath, viewport: { width: 1100, height: 760 },
    args: [`--lang=${locale}`, `--disable-extensions-except=${[extension, vimium].filter(Boolean).join(',')}`, `--load-extension=${[extension, vimium].filter(Boolean).join(',')}`],
  });
  worker = context.serviceWorkers().find(worker => worker.url().endsWith('/background.js')) || await context.waitForEvent('serviceworker', worker => worker.url().endsWith('/background.js'));
  popupUrl = worker.url().replace('background.js', 'popup.html');
  ui = await context.newPage();
  await ui.goto(popupUrl);
  await expect(ui.locator('.result.command')).toHaveCount(9);
});
test.afterEach(async () => {
  await context?.close(); await rm(profile, { recursive: true, force: true });
  if (testExtension) await rm(testExtension, { recursive: true, force: true });
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
  await expect(ui.locator('.navigation-hint')).toContainText('Ctrl P');
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
  // The UI closes after execution; opening a fresh extension page also exercises a fresh snapshot.
  ui = await context.newPage(); await ui.goto(popupUrl);
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
  await ui.locator('.palette').screenshot({ path: 'test-results/palette.png' });
});

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
  await page.screenshot({ path: 'test-results/overlay-refined.png', animations: 'disabled' });
  await page.keyboard.type('example');
  await expect.poll(comboValue).toBe('example');
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('close right');
  await expect.poll(comboValue).toBe('close right');
  await page.screenshot({ path: 'test-results/overlay.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 400 });
  await page.keyboard.press('Meta+k');
  await expect.poll(comboValue).toBe('');
  await page.screenshot({ path: 'test-results/overlay-narrow-actions.png', animations: 'disabled' });
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

test('Raycast navigation pages, jumps sections and restores caret when actions close', async () => {
  await ui.evaluate(async base => {
    for (let i = 0; i < 12; i++) await chrome.tabs.create({ url: `${base}/Navigation-${i}`, active: false });
    await chrome.bookmarks.create({ title: 'Navigation Bookmark', url: `${base}/Navigation-Bookmark` });
  }, origin);
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页和书签' });
  await input.fill('');
  await expect(ui.locator('.section-start')).toHaveCount(1);
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
    await ui.locator('.palette').screenshot({ path: `test-results/palette-${theme}.png` });
    await input.fill('Design System');
    await expect(ui.locator('.result')).toHaveCount(1);
    await input.press('Meta+k');
    const searchBox = await ui.locator('.action-search').boundingBox();
    const actionList = await ui.locator('.action-list').boundingBox();
    expect(searchBox!.y).toBeGreaterThanOrEqual(actionList!.y + actionList!.height - 1);
    await ui.locator('.palette').screenshot({ path: `test-results/actions-${theme}.png` });
    await ui.keyboard.press('Escape');
  }
});

for (const variant of ['English', 'fallback', 'Taiwan']) {
  test(`${variant} locale resolves manifest, commands, actions, counts and errors`, async () => {
    const chinese = variant === 'Taiwan';
    const input = ui.getByRole('combobox', { name: chinese ? '搜索命令、标签页和书签' : 'Search commands, tabs, and bookmarks' });
    await expect(input).toBeFocused();
    expect(await ui.evaluate(() => chrome.runtime.getManifest().name)).toBe('zing');
    await expect(ui.locator('.navigation-label')).toHaveText(chinese ? '选择' : 'Navigate');
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
    await ui.locator('.palette').screenshot({ path: `test-results/i18n-${variant.toLowerCase()}.png` });
  });
}

test('settings language and theme persist, synchronize, and preserve search focus', async () => {
  const input = ui.getByRole('combobox', { name: '搜索命令、标签页和书签' });
  await input.fill('reload');
  await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 5));
  await input.press('Meta+,');
  await expect(ui.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await expect(ui.getByRole('button', { name: '返回', exact: true })).toBeFocused();
  const language = ui.getByRole('combobox', { name: '语言', exact: true });
  await language.click();
  await ui.keyboard.press('Escape');
  await expect(language).toHaveAttribute('aria-expanded', 'false');
  await expect(ui.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await language.press('Enter');
  await language.press('End');
  await language.press('Enter');
  await expect(ui.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(ui.getByRole('combobox', { name: 'Language', exact: true })).toBeFocused();
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ preferences: { language: string } }>('preferences')).preferences.language)).toBe('en');
  await ui.emulateMedia({ colorScheme: 'light' });
  const theme = ui.getByRole('combobox', { name: 'Theme', exact: true });
  await theme.click();
  await ui.getByRole('option', { name: 'Dark', exact: true }).click();
  await expect(ui.locator('.zing-app')).toHaveAttribute('data-theme', 'dark');
  await expect(ui.locator('.palette')).toHaveCSS('background-color', 'rgb(40, 42, 54)');
  await ui.locator('.palette').screenshot({ path: 'test-results/settings-dark.png' });
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
  await expect(second.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await second.getByRole('combobox', { name: '主题', exact: true }).click();
  await second.getByRole('option', { name: '浅色', exact: true }).click();
  await ui.emulateMedia({ colorScheme: 'dark' });
  await expect(ui.locator('.palette')).toHaveCSS('background-color', 'rgb(247, 248, 250)');
  await second.getByRole('combobox', { name: '主题', exact: true }).click();
  await second.getByRole('option', { name: '跟随系统', exact: true }).click();
  await expect(ui.locator('.palette')).toHaveCSS('background-color', 'rgb(40, 42, 54)');
  await second.getByRole('combobox', { name: '语言', exact: true }).click();
  await second.getByRole('option', { name: '跟随系统', exact: true }).click();
  await expect(second.getByText('系统语言：简体中文（Chrome 界面语言）')).toBeVisible();
  await second.reload();
  await expect(second.locator('.zing-app')).toHaveAttribute('lang', 'zh-CN');
  await expect(second.locator('.zing-app')).toHaveAttribute('data-theme', 'system');
  await second.close();
});

test('English settings entries, narrow layout and Chrome hotkey settings', async () => {
  const input = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
  await input.fill('设置');
  await expect(ui.locator('.result').first()).toContainText('Settings');
  await input.press('Enter');
  await expect(ui.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(ui.locator('.hotkey-value')).toHaveText(await worker.evaluate(async () => (await chrome.commands.getAll()).find(c => c.name === 'toggle-palette')!.shortcut!));
  await ui.locator('.palette').screenshot({ path: 'test-results/settings-light.png' });
  // Keyboard Tab stays within settings, including reverse wrap from the back button.
  await ui.getByRole('button', { name: 'Back', exact: true }).press('Shift+Tab');
  await expect(ui.getByRole('button', { name: 'Manage Scripts' })).toBeFocused();
  await ui.keyboard.press('Tab');
  await expect(ui.getByRole('button', { name: 'Back', exact: true })).toBeFocused();
  await ui.keyboard.press('Escape');
  await ui.locator('.settings-button').click();
  await ui.setViewportSize({ width: 390, height: 400 });
  await ui.locator('.zing-app').evaluate(node => { node.classList.replace('popup', 'overlay'); document.body.style.width = '390px'; });
  expect(await ui.locator('.settings-body').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const palette = await ui.locator('.palette').boundingBox();
  expect(palette!.y + palette!.height).toBeLessThanOrEqual(400);
  await ui.getByRole('combobox', { name: 'Language', exact: true }).click();
  const menu = await ui.locator('.choice-menu').boundingBox();
  const body = await ui.locator('.settings-body').boundingBox();
  expect(menu!.y).toBeGreaterThanOrEqual(body!.y);
  expect(menu!.y + menu!.height).toBeLessThanOrEqual(body!.y + body!.height);
  await ui.getByRole('option', { name: '简体中文', exact: true }).click();
  await expect(ui.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await ui.locator('.palette').screenshot({ path: 'test-results/settings-narrow.png' });
  const nextPage = context.waitForEvent('page');
  await ui.getByRole('button', { name: '前往修改' }).click();
  const shortcuts = await nextPage;
  await expect(shortcuts).toHaveURL('chrome://extensions/shortcuts');
});

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
  await expect(ui.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(ui.getByText('System language: English (Chrome interface)')).toBeVisible();
});

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
  await expect.poll(async () => (await ax()).some(n => n.role?.value === 'heading' && n.name?.value === '设置')).toBe(true);
  await page.keyboard.press('Tab'); // Language
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await ax()).some(n => n.role?.value === 'heading' && n.name?.value === 'Settings')).toBe(true);
  await page.keyboard.press('Tab'); // Theme
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('preferences')).preferences)).toEqual({ language: 'en', theme: 'dark' });
  await page.screenshot({ path: 'test-results/settings-overlay.png' });
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await ax()).find(n => n.role?.value === 'combobox')?.value?.value).toBe('reload');
  await page.keyboard.press('Escape');
  await expect(page.locator('#zing-command-palette')).not.toBeAttached();
  await expect(page.getByRole('textbox', { name: 'Page input' })).toBeFocused();
});

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
  await expect(ui.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await expect(ui.getByRole('alert')).toHaveCount(0);
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
  await ui.locator('.palette').screenshot({ path: 'test-results/unified-search.png' });
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
    await ui.locator('.palette').screenshot({ path: `test-results/highlight-${theme}.png` });
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

for (const language of ['Chinese', 'English']) test(`${language} short queries reject noise while command typos and exact aliases still work`, async () => {
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
  await ui.locator('.palette').screenshot({ path: `test-results/strict-search-${language.toLowerCase()}.png` });
  await input.fill('iam nonexistent');
  await expect(ui.locator('.result')).toHaveCount(0);
  await input.fill('xinjiam');
  await expect(ui.locator('.result.command')).toHaveCount(0);
  await input.fill('xinjian');
  await expect(ui.locator('.result').first()).toHaveAttribute('id', 'zing-command:newTab');
  await input.fill('reloda');
  await expect(ui.locator('.result').first()).toHaveAttribute('id', 'zing-command:reload');
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
});

test('English learned ranking follows successful selections, survives reopening tabs, and resets across palettes', async () => {
  const target = await context.newPage();
  await target.goto(`${origin}/EchoTech-IAM`);
  await ui.evaluate(async base => { await chrome.bookmarks.create({ title: 'IAM Handbook', url: `${base}/Handbook` }); }, origin);
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
  await ui.locator('.palette').screenshot({ path: 'test-results/learned-ranking.png' });
  await ui.reload();
  await ui.getByRole('combobox').fill(' IAM ');
  await expect(ui.locator('.result').first()).toContainText('EchoTech IAM');
  const observer = await context.newPage(); await observer.goto(popupUrl);
  await observer.getByRole('combobox').fill('iam');
  await expect(observer.locator('.result').first()).toContainText('EchoTech IAM');
  await ui.getByRole('button', { name: 'Settings', exact: true }).click();
  await ui.getByRole('button', { name: 'Reset Ranking', exact: true }).click();
  await expect(ui.getByRole('status')).toContainText('Default ordering restored');
  await expect(observer.locator('.result').first()).toContainText('IAM Handbook');
  expect(await worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage)).toBeUndefined();
  await ui.getByRole('button', { name: 'Reset Ranking', exact: true }).scrollIntoViewIfNeeded();
  await ui.locator('.palette').screenshot({ path: 'test-results/ranking-settings.png' });
});

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
  await expect(ui.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage?.[0]?.target)).toBe('command:settings');
  expect(await worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage')).searchUsage?.[0]?.query)).toBe('language');
});

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

for (const language of ['Chinese', 'English']) test(`${language} home commands learn from search, home and actions while preserving recent tabs`, async () => {
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
  await expect(ui.getByRole('heading', { name: chinese ? '设置' : 'Settings', exact: true })).toBeVisible();
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
  await actions.press('Enter').catch(error => { if (!ui.isClosed()) throw error; });
  await expect.poll(() => ui.isClosed()).toBe(true);
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage'))
    .searchUsage?.find(record => record.target === 'command:mute')?.query)).toBe('');
  // A secondary action must not train a result for the original page-title query.
  expect(await worker.evaluate(async () => (await chrome.storage.local.get<{ searchUsage?: UsageRecord[] }>('searchUsage'))
    .searchUsage?.some(record => record.query === 'home fixture'))).toBe(false);
  ui = await context.newPage(); await ui.goto(popupUrl);
  await expect(ui.locator('.result.command').first()).toHaveAttribute('id', 'zing-command:settings');
  await expect(ui.locator('.result.command').nth(1)).toHaveAttribute('id', 'zing-command:mute');
  await expect(ui.locator('.result').first()).toHaveClass(/tab/);
  const beforeReload = await commandIds();
  await ui.reload();
  await expect(ui.locator('.result.command')).toHaveCount(9);
  expect(await commandIds()).toEqual(beforeReload);
  await ui.locator('.palette').screenshot({ path: `test-results/home-habits-${language.toLowerCase()}.png` });
  const beforeReset = await tabIds();
  await ui.getByRole('button', { name: chinese ? '设置' : 'Settings', exact: true }).click();
  await ui.getByRole('button', { name: chinese ? '重置搜索排序' : 'Reset Ranking', exact: true }).click();
  await expect(ui.getByRole('status')).toBeVisible();
  await expect(ui.getByRole('button', { name: chinese ? '重置搜索排序' : 'Reset Ranking', exact: true })).toBeFocused();
  await ui.keyboard.press('Escape');
  await expect.poll(commandIds).toEqual(defaultCommands);
  expect(await tabIds()).toEqual(beforeReset);
});

for (const language of ['Chinese', 'English']) test(`${language} quiet layout exposes Ctrl P N navigation in results and actions at narrow widths`, async () => {
  const chinese = language === 'Chinese';
  const page = await context.newPage(); await page.goto(`${origin}/Navigation-fixture`);
  await ui.bringToFront();
  const input = ui.getByRole('combobox');
  await expect(ui.locator('.result.tab .entry-title')).toContainText(['Navigation fixture']);
  await expect(ui.locator('.list-heading, .section-heading, .context-hint, .kind-label')).toHaveCount(0);
  await expect(ui.locator('.section-start')).toHaveCount(1);
  await expect(ui.locator('.navigation-hint')).toContainText('Ctrl P');
  await expect(ui.locator('.navigation-hint')).toContainText('Ctrl N');
  const rows = ui.locator('.result');
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
    await ui.locator('.palette').screenshot({ path: `test-results/quiet-${language.toLowerCase()}-${theme}.png` });
  }
  await ui.setViewportSize({ width: 390, height: 600 });
  await ui.locator('.zing-app').evaluate(node => { node.classList.replace('popup', 'overlay'); document.body.style.width = '390px'; });
  const hint = ui.locator('.navigation-hint');
  await expect(hint).toBeVisible();
  expect(await ui.locator('.footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  const hintBox = await hint.boundingBox(), actionsBox = await ui.locator('.footer-actions').boundingBox();
  expect(hintBox!.x + hintBox!.width).toBeLessThanOrEqual(actionsBox!.x);
  await input.press('Control+n');
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
  await ui.locator('.palette').screenshot({ path: `test-results/quiet-${language.toLowerCase()}-narrow.png` });
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

for (const language of ['English', 'Chinese']) test(`${language} storage list copies exact values, details, names and restores navigation`, async () => {
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
  await surface.locator('.palette').screenshot({ path: `test-results/storage-detail-${language}.png` });
  await page.keyboard.press('Escape');
  await expect(input).toHaveValue('config'); await expect(input).toBeFocused();
  await input.fill('markup'); await input.press('Enter');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('<img src=x onerror=alert(1)>');
  await expect(surface.locator('.storage-row img')).toHaveCount(0);
  await input.fill('absent'); await expect(surface.locator('.empty')).toContainText(chinese ? '没有找到' : 'No results found');
  await input.fill('');
  await page.emulateMedia({ colorScheme: 'dark' });
  await surface.locator('.palette').screenshot({ path: `test-results/storage-dark-${language}.png` });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 390, height: 600 });

  expect(await surface.locator('.footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await surface.locator('.palette').screenshot({ path: `test-results/storage-narrow-${language}.png` });
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
  await surface.locator('.palette').screenshot({ path: 'test-results/storage-cookie-detail.png' });
  await page.keyboard.press('Escape');
  await context.clearCookies();
  await page.keyboard.press('Meta+k'); await surface.locator('.action-search input').fill('refresh'); await page.keyboard.press('Enter');
  await expect(surface.locator('.empty')).toContainText('No entries');
  await page.evaluate(() => history.pushState({}, '', '/Changed'));
  await page.keyboard.press('Meta+k'); await surface.locator('.action-search input').fill('refresh'); await page.keyboard.press('Enter');
  await expect(surface.locator('.storage-error')).toContainText('The page changed');
});

test('English storage restricted pages show a recoverable explanation', async () => {
  await ui.locator('.search-bar input').fill('local storage'); await ui.keyboard.press('Enter');
  await expect(ui.locator('.storage-error')).toContainText('HTTP or HTTPS');
  await ui.keyboard.press('Enter');
  await expect(ui.locator('.storage-error')).toContainText('HTTP or HTTPS');
  await ui.keyboard.press('Escape');
  await expect(ui.locator('.search-bar input')).toBeFocused();
});

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

test('English closed storage overlay preserves Vimium keyboard isolation through every layer', async () => {
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
  await page.screenshot({ path: 'test-results/storage-closed-vimium.png' });
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await combo())?.name?.value).toBe('Search commands, tabs, and bookmarks');
  await expect.poll(async () => (await combo())?.value?.value).toBe('local storage');
  await page.keyboard.press('Escape');
  await expect(page.locator('#zing-command-palette')).not.toBeAttached();
});

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

test('English cookie native permission request accepts the production manifest patterns', async () => {
  // Exercise Chrome itself: two separate scheme declarations do not authorize a
  // wildcard-scheme request, even though they appear to cover the same URLs.
  const result = await ui.evaluate(() => Promise.race([
    chrome.permissions.request({ origins: ['*://127.0.0.1/*'] }).then(granted => ({ granted }), error => ({ error: error.message })),
    new Promise<{ pending: true }>(resolve => setTimeout(() => resolve({ pending: true }), 750)),
  ]));
  expect(result).not.toHaveProperty('error');
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

test('English recent switcher closes when source window closes and never changes toolbar popup', async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Recent-A`);
  const b = await context.newPage(); await b.goto(`${origin}/Recent-B`);
  const popup = await recentPopup(a);
  expect(await worker.evaluate(id => chrome.action.getPopup({tabId:id}), popup.target.id)).toBe('');
  await worker.evaluate(id => chrome.windows.remove(id), popup.target.windowId);
  await expect.poll(popup.closed).toBe(true);
});

 test('English recent switcher cancels when its original tab is closed', async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Recent-A`);
  const b = await context.newPage(); await b.goto(`${origin}/Recent-B`);
  const popup = await recentPopup(a);
  await worker.evaluate(id => chrome.tabs.remove(id), popup.target.id);
  await expect.poll(popup.closed).toBe(true);
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
  await expect(ui.getByRole('button', { name: 'Storage helper Edit Script' })).toBeVisible();
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
  await ui.getByRole('textbox', { name: 'Search scripts' }).fill('Storage helper');
  await ui.keyboard.press('Enter');
  await expect(ui.getByLabel('JavaScript code')).toHaveValue(code);
  await ui.getByLabel('Name', { exact: true }).fill('Storage helper renamed');
  await ui.getByRole('button', { name: 'Save', exact: true }).click();
  await ui.getByRole('button', { name: 'Storage helper renamed Edit Script' }).click();
  await ui.keyboard.press('Meta+k');
  await ui.getByRole('combobox', { name: 'Search actions' }).fill('delete'); await ui.keyboard.press('Enter');
  await ui.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(ui.getByRole('button', { name: 'Storage helper renamed Edit Script' })).toHaveCount(0);
  expect(await worker.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter(key => key.startsWith('saved-script:')))).toEqual([]);
});

test('English script binding guide copies this installation ID and opens Chrome shortcuts', async () => {
  await context.grantPermissions(['clipboard-read']);
  const before = await worker.evaluate(() => chrome.commands.getAll());
  await ui.getByRole('button', { name: 'Settings', exact: true }).click();
  await ui.getByRole('button', { name: 'Set Up Ctrl+Tab', exact: true }).click();
  await expect(ui.getByRole('heading', { name: 'Set Up Ctrl+Tab' })).toBeVisible();
  await expect(ui.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await expect(ui.getByRole('textbox', { name: 'JavaScript code' })).toHaveAttribute('readonly', '');
  await ui.getByRole('button', { name: 'Copy Code', exact: true }).click();
  const code = await ui.evaluate(() => navigator.clipboard.readText());
  const calls: unknown[] = [];
  new Function('chrome', code)({ developerPrivate: { updateExtensionCommand: (value: unknown) => calls.push(value) } });
  expect(calls).toEqual([
    { extensionId: new URL(worker.url()).hostname, commandName: 'switch-recent', keybinding: 'Ctrl+Tab' },
    { extensionId: new URL(worker.url()).hostname, commandName: 'switch-recent-back', keybinding: 'Ctrl+Shift+Tab' },
  ]);
  expect(await worker.evaluate(() => chrome.commands.getAll())).toEqual(before);
  await ui.setViewportSize({ width: 390, height: 500 });
  await ui.locator('.zing-app').evaluate(node => { node.classList.replace('popup', 'overlay'); document.body.style.width = '390px'; });
  expect(await ui.locator('.settings-body').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await ui.getByRole('button', { name: 'Copy Code', exact: true }).scrollIntoViewIfNeeded();
  await ui.locator('.palette').screenshot({ path: 'test-results/script-binding-guide.png' });
  const created = context.waitForEvent('page');
  await ui.getByRole('button', { name: 'Open Chrome Shortcuts' }).click();
  await expect(await created).toHaveURL('chrome://extensions/shortcuts');
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
  await expect(ui.getByRole('button', { name: '保存', exact: true })).toBeFocused();
  await ui.keyboard.press('Enter');
  await expect(ui.getByRole('textbox', { name: '搜索脚本' })).toBeFocused();
  await ui.getByRole('textbox', { name: '搜索脚本' }).fill('Keyboard');
  await ui.keyboard.press('Enter');
  await expect(ui.getByLabel('JavaScript 代码')).toHaveValue('const value = 42;');
  await ui.keyboard.press('Escape');
  await expect(ui.getByRole('heading', { name: '脚本收藏', exact: true })).toBeVisible();
  await ui.keyboard.press('Escape');
  await expect(ui.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await ui.keyboard.press('Escape');
  await expect(ui.getByRole('combobox', { name: '搜索命令、标签页和书签' })).toBeFocused();
});

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
  await ui.locator('.palette').screenshot({ path: '/tmp/zing-script-actions.png' });
});

test('Chinese script actions protect built-in setup and return directly to search', async () => {
  const search = ui.getByRole('combobox', { name: '搜索命令、标签页和书签' });
  await search.fill('ctrl tab'); await ui.keyboard.press('Meta+k');
  await expect(ui.locator('.action-row')).toHaveCount(2);
  await expect(ui.locator('.action-row')).toContainText(['复制代码', '查看设置说明']);
  await ui.keyboard.press('Control+n'); await ui.keyboard.press('Enter');
  await expect(ui.getByRole('heading', { name: '设置 Ctrl+Tab' })).toBeVisible();
  await expect(ui.getByLabel('JavaScript 代码')).toHaveAttribute('readonly', '');
  await expect(ui.getByRole('button', { name: '删除', exact: true })).toHaveCount(0);
  await ui.keyboard.press('Escape');
  await expect(search).toBeFocused(); await expect(search).toHaveValue('ctrl tab');
});

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

test('English command discovery completes the script lifecycle entirely from search and keyboard', async () => {
  await context.grantPermissions(['clipboard-read']);
  const search = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
  await search.fill('new script');
  await expect(ui.locator('.result[aria-selected=true]')).toContainText('New Script');
  await ui.keyboard.press('Enter');
  await expect(ui.getByRole('heading', { name: 'New Script', exact: true })).toBeVisible();
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
  await expect(ui.getByRole('heading', { name: 'Script Library', exact: true })).toBeVisible();
  await expect(ui.getByRole('textbox', { name: 'Search scripts' })).toBeFocused();
  await ui.keyboard.press('Escape'); await expect(search).toBeFocused(); await expect(search).toHaveValue('scripts');
  await search.fill('new script'); await ui.keyboard.press('Enter');
  await ui.keyboard.type('Unsaved'); await ui.keyboard.press('Escape');
  await expect(search).toBeFocused();
  expect(await worker.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter(key => key.startsWith('saved-script:')))).toEqual([]);
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
  await expect(ui.getByRole('heading', { name: '脚本收藏', exact: true })).toBeVisible();
  await ui.keyboard.press('Escape'); await expect(search).toBeFocused();
  await search.fill('新建脚本'); await ui.keyboard.press('Enter');
  await expect(ui.getByRole('heading', { name: '新建脚本', exact: true })).toBeVisible();
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

test('English script execution storage searches the run command and handles async objects and errors', async () => {
  const { page, surface } = await scriptExecutionFixture('Promise.resolve({ answer: 42, markup: "<script>not HTML</script>" })');
  const search = surface.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
  await search.fill('run script'); await page.keyboard.press('Enter');
  await expect(surface.getByRole('textbox', { name: 'Search scripts' })).toBeFocused();
  await page.keyboard.type('Execution helper'); await page.keyboard.press('Enter');
  await expect(surface.getByLabel('Result', { exact: true })).toHaveValue('{\n  "answer": 42,\n  "markup": "<script>not HTML</script>"\n}');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
  await worker.evaluate(() => chrome.storage.local.set({ 'saved-script:runner': { title: 'Execution helper', code: 'throw new Error("Expected failure")' } }));
  await search.fill('Execution helper'); await page.keyboard.press('Enter');
  await expect(surface.getByLabel('Result', { exact: true })).toHaveValue('Error: Expected failure');
  await expect(surface.getByRole('button', { name: 'Copy Result', exact: true })).toHaveCount(0);
  await surface.locator('.palette').screenshot({ path: '/tmp/zing-script-run-error.png' });
});

test('English script execution storage explains disabled permission and never runs before enabling', async () => {
  const { page, surface } = await scriptExecutionFixture('localStorage.setItem("ran", "yes"); 42', false);
  await surface.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' }).fill('Execution helper'); await page.keyboard.press('Enter');
  await expect(surface.getByRole('alert')).toContainText('Enable user scripts');
  expect(await page.evaluate(() => localStorage.getItem('ran'))).toBeNull();
  await expect(surface.getByRole('button', { name: 'Open Extension Details' })).toBeVisible();
  const created = context.waitForEvent('page'); await surface.getByRole('button', { name: 'Open Extension Details' }).click();
  const detail = await created; await expect(detail).toHaveURL(`chrome://extensions/?id=${new URL(worker.url()).hostname}`);
});

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

test('English script execution refuses a Chrome internal page and keeps built-in setup copy-only', async () => {
  await worker.evaluate(() => chrome.storage.local.set({ 'saved-script:runner': { title: 'Execution helper', code: '42' } }));
  await ui.getByRole('combobox').fill('Execution helper'); await ui.keyboard.press('Enter');
  await expect(ui.getByRole('alert')).toContainText('ordinary HTTP or HTTPS');
  await ui.keyboard.press('Escape');
  await ui.getByRole('combobox').fill('ctrl tab'); await ui.keyboard.press('Meta+k');
  await expect(ui.locator('.action-row')).toHaveCount(2);
  await expect(ui.locator('.action-row')).toContainText(['Copy Code', 'View Setup Instructions']);
});

test('English script save stays visible without scrolling the editor', async () => {
  await ui.setViewportSize({ width: 750, height: 516 });
  await ui.getByRole('combobox').fill('new script');
  await ui.keyboard.press('Enter');
  await expect(ui.getByRole('heading', { name: 'New Script', exact: true })).toBeVisible();
  await ui.getByLabel('Name', { exact: true }).fill('Visible save regression');
  await ui.getByLabel('JavaScript code').fill('localStorage.getItem("demo")');
  await expect(ui.getByRole('button', { name: 'Save', exact: true })).toBeInViewport({ ratio: 1 });
  await ui.screenshot({ path: '/tmp/zing-save-visible.png' });
  await ui.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(ui.getByRole('combobox')).toHaveValue('new script');
  expect(await worker.evaluate(async () => Object.values(await chrome.storage.local.get(null)).some((value: any) => value?.title === 'Visible save regression'))).toBe(true);
});

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
  await surface.locator('.settings-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(save).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: '/tmp/zing-save-short.png' });
  await save.click();
  await expect(surface.getByRole('combobox')).toHaveValue('新建脚本');
  expect(await worker.evaluate(async () => Object.values(await chrome.storage.local.get(null)).some((value: any) => value?.title === '短窗口验收' && value?.code === '42'))).toBe(true);
});


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
  await expect(surface.getByRole('heading', { name: 'New Script', exact: true })).toBeVisible();
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
  await ui.locator('.palette').screenshot({ path: '/tmp/zing-shared-editor.png' });
  await ui.keyboard.press('Meta+k'); await ui.locator('.palette').screenshot({ path: '/tmp/zing-shared-editor-menu.png' });
});

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
  await page.keyboard.press('Tab');
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
  await expect.poll(() => focused('Back')).toBe(true);
  await expect.poll(async () => (await ax()).some(node => node.role?.value === 'heading' && node.name?.value === 'Settings')).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => focused('Search commands, tabs, and bookmarks')).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#zing-command-palette')).not.toBeAttached();
});

test('English palette launch storage overlay Escape returns after clicking non-focusable content', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Escape-content`);
  await worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  const surface = page.frameLocator('.zing-frame');
  const search = surface.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
  await search.fill('manage scripts'); await page.keyboard.press('Enter');
  await expect(surface.getByRole('textbox', { name: 'Search scripts' })).toBeFocused();
  await surface.getByRole('heading', { name: 'Script Library', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('manage scripts');
  // Central routing handles each page, including clicks on non-input content.
  for (const [query, heading] of [['settings', 'Settings'], ['new script', 'New Script'], ['run script', 'Run Script']]) {
    await search.fill(query); await page.keyboard.press('Enter');
    await surface.getByRole('heading', { name: heading, exact: true }).click();
    await page.keyboard.press('Escape'); await expect(search).toBeFocused();
    await expect(search).toHaveValue(query);
  }
  await search.fill('new script'); await page.keyboard.press('Enter');
  await page.keyboard.press('Meta+k');
  await surface.locator('.action-heading').click(); await page.keyboard.press('Escape');
  await expect(surface.getByRole('heading', { name: 'New Script', exact: true })).toBeVisible();
  await expect(surface.getByLabel('Name', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(search).toBeFocused();
  await search.fill('local storage'); await page.keyboard.press('Enter');
  await surface.locator('.storage-header strong').click(); await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
  await search.fill('settings'); await page.keyboard.press('Enter');
  await surface.getByRole('button', { name: 'Manage Scripts', exact: true }).click();
  await surface.getByRole('heading', { name: 'Script Library', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(surface.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await surface.getByRole('heading', { name: 'Settings', exact: true }).click();
  await page.keyboard.press('Escape'); await expect(search).toBeFocused();
  await search.fill('no-such-command'); await surface.getByText('No results found', { exact: true }).click();
  await page.keyboard.press('Escape'); await expect(page.locator('#zing-command-palette')).not.toBeAttached();
});

test('English Escape routing survives lost control focus through every script and settings layer', async () => {
  await worker.evaluate(() => chrome.storage.local.set({ 'saved-script:escape-fixture': { title: 'Escape fixture', code: 'return "fixture";' } }));
  const search = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
  const escapeWithoutControlFocus = async () => {
    await ui.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await ui.keyboard.press('Escape');
  };
  await search.fill('manage scripts'); await search.press('Enter');
  await expect(ui.getByRole('textbox', { name: 'Search scripts' })).toBeFocused();
  await escapeWithoutControlFocus();
  await expect(search).toBeFocused();
  await search.fill('settings'); await search.press('Enter');
  await ui.getByRole('combobox', { name: 'Language', exact: true }).press('Enter');
  await escapeWithoutControlFocus();
  await expect(ui.getByRole('combobox', { name: 'Language', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(ui.getByRole('combobox', { name: 'Language', exact: true })).toBeFocused();
  await ui.getByRole('button', { name: 'Manage Scripts', exact: true }).click();
  const scripts = ui.getByRole('textbox', { name: 'Search scripts' });
  await scripts.fill('Escape fixture'); await scripts.press('Enter');
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
  await escapeWithoutControlFocus(); await expect(ui.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await escapeWithoutControlFocus(); await expect(search).toBeFocused();
  await expect(search).toHaveValue('settings');
  await search.fill('run script'); await search.press('Enter');
  await scripts.fill('Escape fixture'); await scripts.press('Enter');
  // The popup is a restricted target; the error result is still a navigation layer.
  await expect(ui.getByRole('alert')).toBeVisible();
  await escapeWithoutControlFocus(); await expect(scripts).toBeFocused();
  await escapeWithoutControlFocus(); await expect(search).toBeFocused();
});

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
  await expect(surface.getByRole('textbox', { name: 'Search scripts' })).toBeVisible();
  await escape(); await expect(search).toBeFocused();
  await escape(); await expect(page.locator('#zing-command-palette')).not.toBeAttached();
  // Reopen to catch stale registrations/listeners left behind by the prior mount.
  await open(); await expect(search).toBeFocused();
  await search.fill('manage scripts'); await page.keyboard.press('Enter');
  await escape(); await expect(search).toBeFocused();
  await escape(); await expect(page.locator('#zing-command-palette')).not.toBeAttached();
});

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
  const picker = ui.getByRole('textbox', { name: 'Search scripts' });
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

test('English Backspace returns from empty searches while preserving text editing and the root', async () => {
  const search = ui.getByRole('combobox', { name: 'Search commands, tabs, and bookmarks' });
  await search.fill('settings'); await search.press('Enter');
  await ui.getByRole('button', { name: 'Manage Scripts', exact: true }).click();
  const scripts = ui.getByRole('textbox', { name: 'Search scripts' });
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
  await ui.getByRole('button', { name: 'Back', exact: true }).first().focus();
  await ui.keyboard.press('Backspace'); await expect(scripts).toBeFocused();
  await scripts.press('Backspace');
  await expect(ui.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  const language = ui.getByRole('combobox', { name: 'Language', exact: true });
  await language.press('Enter'); await language.press('Backspace');
  await expect(language).toHaveAttribute('aria-expanded', 'false');
  await language.press('Backspace'); await expect(search).toBeFocused();
  await search.fill(''); await search.press('Backspace');
  await expect(search).toBeFocused();
  await search.press('Meta+k'); await ui.keyboard.press('Backspace');
  await expect(search).toBeFocused();
});

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

for (const language of ['English', 'Chinese']) test(`${language} categorized candidates show real shortcuts and keep search matching and save binding`, async () => {
  const en = language === 'English';
  const search = ui.locator('.search-bar input');
  await search.fill('script:new');
  const first = ui.locator('#zing-results [role="option"]').first();
  await expect(first.locator('.entry-title')).toHaveText(en ? 'Script: New Script' : '脚本: 新建脚本');
  await expect(first.locator('mark')).not.toHaveCount(0);
  await expect(first.locator('.entry-shortcut')).toHaveCount(0);
  await search.fill('new tab');
  await expect(first.locator('.entry-title')).toHaveText(en ? 'Tab: New Tab' : '标签页: 新建标签页');
  await expect(first.locator('.entry-shortcut')).toHaveText('⌘T');
  await search.fill('restore'); await expect(first.locator('.entry-shortcut')).toHaveText('⌘⇧T');
  await search.fill('settings'); await expect(first.locator('.entry-shortcut')).toHaveText('⌘,');
  await search.press('Meta+k');
  await expect(ui.locator('.action-row .entry-shortcut')).toHaveText('⌘,');
  await ui.keyboard.press('Meta+,'); await expect(ui.locator('.settings-header h1')).toHaveText(en ? 'Settings' : '设置');
  await ui.keyboard.press('Escape');
  await search.fill('script: new'); await search.press('Enter');
  await ui.locator('.script-field input').fill('Prefix fixture');
  await ui.locator('.script-field textarea').fill('42');
  await ui.keyboard.press('Meta+k');
  await expect(ui.locator('.action-row .entry-shortcut')).toHaveText('⌘↵');
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
    await ui.locator('.palette').screenshot({ path: `/tmp/zing-categories-${language}-${theme}.png` });
  }
});

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
  await surface.locator('.palette').screenshot({ path: '/tmp/zing-favicon-overlay.png' });
  // A real image failure must leave a type icon, never a broken-image glyph.
  await icon.evaluate((img: HTMLImageElement) => { img.src = img.src.replace('/_favicon/', '/missing-icon.png'); });
  await expect(surface.locator('.result.tab img')).toHaveCount(0);
  await expect(surface.locator('.result.tab .entry-icon svg')).toBeVisible();
  await search.fill('close tab'); await expect(surface.locator('.result.command .entry-shortcut').first()).toHaveText('⌘W');
  await search.fill('reload'); await expect(surface.locator('.result.command .entry-shortcut').first()).toHaveText('⌘R');
  await search.fill('settings'); await search.press('Meta+,');
  await expect(surface.locator('.settings-header h1')).toHaveText('Settings');
});

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

for (const scenario of ['fast', 'slow', 'failure and retry']) {
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
}

test('English interaction polish script navigation scrolls and returns to the same selection and caret', async () => {
  await worker.evaluate(() => chrome.storage.local.set(Object.fromEntries(Array.from({ length: 35 }, (_, i) => [
    `saved-script:polish-${i}`, { title: `Polish ${String(i).padStart(2, '0')}`, code: '42' },
  ]))));
  await ui.locator('.search-bar input').fill('manage scripts'); await ui.keyboard.press('Enter');
  const search = ui.getByRole('textbox', { name: 'Search scripts' });
  await search.fill('Polish');
  await expect(ui.locator('.script-item')).toHaveCount(35);
  await search.press('Shift+Enter'); await expect(search).toBeVisible();
  await search.press('Control+Shift+n');
  await expect(ui.locator('.script-item.selected')).toContainText('Polish 00');
  for (let i = 0; i < 28; i++) await search.press('Control+n');
  await expect(ui.locator('.script-item.selected')).toContainText('Polish 28');
  expect(await ui.locator('.script-item.selected').evaluate(node => {
    const row = node.getBoundingClientRect(); const body = node.closest('.script-list')!.getBoundingClientRect();
    return row.top >= body.top - 1 && row.bottom <= body.bottom + 1;
  })).toBe(true);
  await search.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 4));
  await search.press('Enter');
  await expect(ui.getByLabel('Name', { exact: true })).toHaveValue('Polish 28');
  await ui.keyboard.press('Escape');
  await expect(search).toBeFocused(); await expect(search).toHaveValue('Polish');
  expect(await search.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 4]);
  await expect(ui.locator('.script-item.selected')).toContainText('Polish 28');
});

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
});

test('English interaction polish storage shares menu footer highlighting and focus restoration', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/Interaction-polish`);
  await page.evaluate(() => localStorage.setItem('polish.key', 'value'));
  const surface = await openStorageOverlay(page);
  await surface.locator('.search-bar input').fill('local storage'); await page.keyboard.press('Enter');
  const search = surface.locator('.storage-search input');
  await expect(surface.locator('.storage-row')).toHaveCount(1);
  await search.fill('polish');
  await search.evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 3));
  await search.press('Meta+k');
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

test('English interaction polish storage script picker ignores modified Enter before execution', async () => {
  const { page, surface } = await scriptExecutionFixture('42', false);
  await surface.locator('.search-bar input').fill('run script'); await page.keyboard.press('Enter');
  const search = surface.getByRole('textbox', { name: 'Search scripts' });
  await expect(search).toBeFocused();
  await search.press('Shift+Enter'); await expect(search).toBeFocused();
  await search.press('Meta+Enter'); await expect(search).toBeFocused();
  await expect(surface.locator('.script-run-status')).toHaveCount(0);
  await expect(surface.getByRole('alert')).toHaveCount(0);
  await search.press('Enter');
  await expect(surface.getByRole('alert')).toContainText('Enable user scripts');
});

test('English result footer storage overlay copies reruns and restores output selection through the shared menu', async () => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { page, surface } = await scriptExecutionFixture('localStorage.setItem("runs", String(Number(localStorage.getItem("runs") || 0) + 1)); "Exact result\\n\\n"');
  const search = surface.locator('.search-bar input');
  await search.fill('Execution helper'); await search.press('Enter');
  const output = surface.getByLabel('Result', { exact: true });
  const primary = surface.locator('.palette-footer .primary-action');
  await expect(output).toHaveValue('Exact result\n\n');
  await expect(primary).toHaveAccessibleName('Copy Result'); await expect(primary).toBeFocused();
  await expect(surface.locator('.settings-body .script-controls')).toHaveCount(0);
  await output.focus(); await output.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(2, 8));
  await output.press('Meta+k');
  const menu = surface.getByRole('combobox', { name: 'Search actions' });
  await expect(menu).toBeFocused();
  await expect(surface.locator('.action-row')).toContainText(['Copy Result', 'Run Again']);
  await menu.press('Control+n'); await expect(primary).toHaveAccessibleName('Run Again');
  await menu.press('Control+p'); await expect(primary).toHaveAccessibleName('Copy Result');
  await menu.press('Tab'); await expect(menu).toBeFocused();
  await menu.press('Escape'); await expect(output).toBeFocused();
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
  await surface.locator('.palette').screenshot({ path: '/tmp/zing-result-footer-narrow.png' });
  await primary.click(); expect(await page.evaluate(() => localStorage.getItem('runs'))).toBe('2');
  await page.keyboard.press('Escape'); await expect(search).toBeFocused(); await expect(search).toHaveValue('Execution helper');
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
  await ui.locator('.palette').screenshot({ path: '/tmp/zing-result-footer-chinese.png' });
  await primary.press('Meta+k'); await menu.press('Control+n'); await menu.press('Enter');
  await expect(primary).toBeDisabled();
  await ui.keyboard.press('Escape'); await expect(picker).toBeFocused(); await expect(picker).toHaveValue('Result fixture');
  await finish(true, 'Late result');
  await expect(picker).toBeFocused(); await expect(ui.locator('.script-output')).toHaveCount(0);
});

test('English recent bridge storage overlay shares palette geometry and accepts held navigation on release', async () => {
  const f = await bridgeFixture();
  await worker.evaluate(async () => {
    const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
    await Promise.all(callbacks.map(callback => callback('toggle-palette')));
  });
  const surface = f.a.frameLocator('.zing-frame');
  await expect(surface.getByRole('combobox')).toBeFocused();
  const paletteBounds = await surface.locator('.palette').boundingBox();
  await f.a.keyboard.press('Escape');
  await f.a.keyboard.down('Control'); await f.open();
  await expect(f.a.locator('#zing-command-palette')).toBeAttached();
  await expect(surface.getByRole('listbox')).toBeFocused();
  expect(await f.windows()).toBe(0);
  const switcherBounds = await surface.locator('.palette').boundingBox();
  expect(switcherBounds).toEqual(paletteBounds);
  const initial = await surface.locator('[aria-selected=true]').getAttribute('id');
  await f.a.keyboard.press('n');
  expect(await surface.locator('[aria-selected=true]').getAttribute('id')).not.toBe(initial);
  await f.a.keyboard.press('p');
  expect(await surface.locator('[aria-selected=true]').getAttribute('id')).toBe(initial);
  expect(await f.active()).toBe(f.ids.source);
  await f.a.keyboard.up('Control');
  await expect.poll(f.active).toBe(Number(initial!.replace('recent-', '')));
  await expect(f.a.locator('#zing-command-palette')).not.toBeAttached();
});

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

for (const reason of ['Escape', 'outside click', 'another window', 'another tab', 'opening interrupted']) {
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
}

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

test('English recent bridge storage overlay mouse selection and narrow geometry match palette', async () => {
  const f = await bridgeFixture(); await f.a.setViewportSize({ width: 390, height: 440 });
  await f.open();
  const surface = f.a.frameLocator('.zing-frame');
  await expect(surface.getByRole('listbox')).toBeFocused();
  const before = await surface.locator('.palette').boundingBox();
  expect(before!.x).toBe(10); expect(before!.y).toBe(24);
  expect(before!.x + before!.width).toBeLessThanOrEqual(380);
  expect(before!.y + before!.height).toBeLessThanOrEqual(416);
  await surface.getByRole('option').filter({ hasText: 'Bridge B' }).click();
  await expect.poll(f.active).toBe(f.ids.previous);
  await expect(f.a.locator('#zing-command-palette')).not.toBeAttached();
});

test('English recent bridge storage overlay closes safely when its worker stops', async () => {
  const f = await bridgeFixture(); await f.a.keyboard.down('Control'); await f.open();
  await expect(f.a.frameLocator('.zing-frame').getByRole('listbox')).toBeFocused();
  const monitor = await context.newCDPSession(f.a);
  await monitor.send('ServiceWorker.enable'); await monitor.send('ServiceWorker.stopAllWorkers');
  await expect(f.a.locator('#zing-command-palette')).not.toBeAttached();
});

test('English recent bridge closed storage overlay preserves Vimium navigation and release', async () => {
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

for (const acceptDelay of [0, 250]) test(`English recent bridge storage overlay quick release never paints the scrim or panel (${acceptDelay}ms accept)`, async () => {
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

test('English recent bridge storage overlay held shortcut reveals and navigates normally', async () => {
  const f = await bridgeFixture();
  await f.a.keyboard.down('Control'); await f.open();
  const surface = f.a.frameLocator('.zing-frame');
  await expect(surface.locator('.recent-overlay')).toHaveCSS('opacity', '1');
  await expect(surface.getByRole('listbox')).toBeFocused();
  const selected = await surface.getByRole('listbox').getAttribute('aria-activedescendant');
  await f.a.keyboard.press('n');
  await expect(surface.getByRole('listbox')).not.toHaveAttribute('aria-activedescendant', selected!);
  await f.a.keyboard.press('p');
  await expect(surface.getByRole('listbox')).toHaveAttribute('aria-activedescendant', selected!);
  await f.a.keyboard.up('Control');
  await expect.poll(f.active).toBe(f.ids.previous);
  await expect(f.a.locator('#zing-command-palette')).not.toBeAttached();
});

test('English human first recent switcher exposes clickable confirm and respects focused cancel', async () => {
  const a = await context.newPage(); await a.goto(`${origin}/Mouse-A`);
  const b = await context.newPage(); await b.goto(`${origin}/Mouse-B`);
  let popup = await recentPopup(a);
  const selected = Number((await popup.selected()).replace('recent-', ''));
  await popup.page.getByRole('button', { name: 'Switch', exact: true }).click();
  await expect.poll(popup.closed).toBe(true); expect(await popup.active()).toBe(selected);
  popup = await recentPopup(a);
  const cancel = popup.page.locator('footer').getByRole('button', { name: 'Cancel', exact: true });
  await cancel.press('Enter').catch(error => { if (!popup.page.isClosed()) throw error; });
  await expect.poll(popup.closed).toBe(true); expect(await popup.active()).toBe(popup.target.id);
});

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
