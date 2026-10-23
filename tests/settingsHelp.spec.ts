import { test as base, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { test, defaults, origin, context, ui, worker, popupUrl } from './support/paletteFixture';
import { registerPaletteFixture } from './support/paletteFixture';

registerPaletteFixture();

test.describe(() => {
  test.use({ environment: { ...defaults, shadow: 'open', pageAccess: true } });
  test('custom search icons persist and synchronize across extension pages and restricted overlays', async () => {
    const search = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
    await search.fill('图标'); await search.press('Enter');
    await ui.getByRole('button', { name: '佩戴徽章' }).click();
    await ui.getByRole('textbox', { name: 'Emoji', exact: true }).fill('🚀');
    await ui.getByRole('button', { name: '佩戴徽章' }).click();
    await expect(ui.locator('.search-focus')).toHaveText('🚀');
    const second = await context.newPage(); await second.goto(popupUrl);
    await expect(second.locator('.search-focus')).toHaveText('🚀');
    await ui.getByRole('button', { name: '佩戴徽章' }).click();
    await ui.locator('input[type=file]').setInputFiles(resolve('dist/icon128.png'));
    await expect(ui.locator('.search-icon-preview img')).toBeVisible();
    await ui.getByRole('button', { name: '佩戴徽章' }).click();
    await expect(second.locator('.search-focus img')).toBeVisible();
    const stored = await worker.evaluate(async () => (await chrome.storage.local.get('preferences')).preferences as { searchIcon: string });
    expect(stored.searchIcon).toMatch(/^data:image\/png;base64,/);
    const source = await context.newPage(); await source.goto(`${origin}/Focus-fixture`);
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0].id!, source.url());
    await worker.evaluate(async tabId => {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tabId, { source: 'justonehop', type: 'toggle' });
    }, tabId);
    const overlay = source.frameLocator('.justonehop-frame');
    const img = overlay.locator('.search-focus img');
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth === 64 && node.naturalHeight === 64)).toBe(true);
    await overlay.locator('.settings-button').click();
    await overlay.getByRole('tab', { name: '外观', exact: true }).click();
    await overlay.getByRole('button', { name: '佩戴徽章' }).click();
    const emoji = overlay.getByRole('textbox', { name: 'Emoji', exact: true });
    await emoji.fill('🌱');
    await context.route('https://emoji.muan.co/', route => route.fulfill({ contentType: 'text/html', body: '<title>Emoji copy destination</title>' }));
    const pickerOpened = context.waitForEvent('page');
    await overlay.getByRole('link', { name: 'Emoji', exact: true }).click();
    const picker = await pickerOpened;
    await expect(picker).toHaveURL('https://emoji.muan.co/');
    await expect.poll(() => worker.evaluate(async () => (await chrome.tabs.query({ active: true })).some(tab => tab.url === 'https://emoji.muan.co/'))).toBe(true);
    await worker.evaluate(async id => { await chrome.tabs.update(id, { active: true }); }, tabId);
    await source.bringToFront();
    await expect(emoji).toBeVisible(); await expect(emoji).toHaveValue('🌱');
    const pickerId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://emoji.muan.co/' }))[0].id!);
    const revisitPicker = async (draft: string) => {
      await worker.evaluate(async id => { await chrome.tabs.update(id, { active: true }); }, pickerId);
      await expect.poll(() => worker.evaluate(async id => (await chrome.tabs.get(id)).active, pickerId)).toBe(true);
      await worker.evaluate(async id => { await chrome.tabs.update(id, { active: true }); }, tabId);
      await source.bringToFront();
      await expect(emoji).toBeVisible(); await expect(emoji).toHaveValue(draft);
    };
    await revisitPicker('🌱');
    await revisitPicker('🌱');
    await emoji.press('Escape');
    await overlay.getByRole('button', { name: '佩戴徽章' }).click();
    await emoji.fill('🌻');
    await revisitPicker('🌻');
    await revisitPicker('🌻');
    await picker.close();
    const preview = overlay.locator('.search-icon-preview img');
    const images: string[] | undefined = process.env.JUSTONEHOP_TEST_IMAGES ? JSON.parse(process.env.JUSTONEHOP_TEST_IMAGES) : undefined;
    for (let attempt = 0; attempt < (images?.length ?? 12); attempt++) {
      await test.step(`overlay upload ${attempt + 1}`, async () => {
        const path = images?.[attempt] ?? (attempt % 2 ? process.env.JUSTONEHOP_TEST_JPEG : process.env.JUSTONEHOP_TEST_ICON);
        const previous = attempt ? await preview.elementHandle() : null;
        await overlay.locator('input[type=file]').setInputFiles(path || resolve(`dist/icon${attempt % 2 ? 48 : 16}.png`));
        if (previous) await expect.poll(() => previous.evaluate(node => node.isConnected)).toBe(false);
        await expect(overlay.getByRole('button', { name: '选择图片' })).toBeEnabled();
        await expect(preview).toBeVisible();
        await expect.poll(() => preview.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth === 64 && node.naturalHeight === 64)).toBe(true);
        await overlay.locator('.settings-view').screenshot({ path: test.info().outputPath(`overlay-upload-${attempt + 1}.png`) });
      });
    }
    await overlay.locator('.settings-view').screenshot({ path: test.info().outputPath('real-overlay-upload.png') });
    await overlay.getByRole('button', { name: '佩戴徽章' }).click();
    await overlay.locator('.settings-search input').press('Escape');
    await overlay.locator('.search-bar input').fill('reload');
    await overlay.locator('.search-bar input').evaluate((node: HTMLInputElement) => node.setSelectionRange(1, 4));
    await overlay.locator('.search-focus').click();
    expect(await overlay.locator('.search-bar input').evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([1, 4]);
    await overlay.locator('.search-bar input').fill('标签切换器');
    await overlay.locator('.search-bar input').press('Enter');
    await expect(overlay.locator('.recent-search-activate img')).toBeVisible();
    await overlay.locator('.recent-search-activate').click();
    await expect(overlay.locator('.recent-search-field input')).toBeFocused();
    const away = await context.newPage(); await away.goto(`${origin}/After-badge`);
    await expect(source.locator('#justonehop-command-palette')).not.toBeAttached();
    await away.close();
    await source.close();
    await second.reload();
    await expect(second.locator('.search-focus img')).toBeVisible();
    await second.locator('.settings-button').click();
    await second.getByRole('tab', { name: '外观', exact: true }).click();
    await second.getByRole('button', { name: '佩戴徽章' }).click();
    await second.getByRole('button', { name: '恢复', exact: true }).click();
    await second.getByRole('button', { name: '佩戴徽章' }).click();
    await expect(ui.locator('.search-focus .brand-logo')).toBeVisible();
    await second.getByRole('button', { name: '佩戴徽章' }).click();
    await context.route('https://emoji.muan.co/', route => route.fulfill({ contentType: 'text/html', body: '<title>Emoji copy destination</title>' }));
    const opened = context.waitForEvent('page');
    await second.getByRole('link', { name: 'Emoji', exact: true }).click();
    const emojiSite = await opened;
    await expect(emojiSite).toHaveURL('https://emoji.muan.co/');
    await emojiSite.close();
    await second.close();
  });
});

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
  await ui.getByRole('tab', { name: 'Appearance', exact: true }).click();
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
  await second.getByRole('tab', { name: '外观', exact: true }).click();
  await second.getByRole('combobox', { name: '主题', exact: true }).click();
  await second.getByRole('option', { name: '浅色', exact: true }).click();
  await ui.emulateMedia({ colorScheme: 'dark' });
  await expect(ui.locator('.palette')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await second.getByRole('combobox', { name: '主题', exact: true }).click();
  await second.getByRole('option', { name: '跟随系统', exact: true }).click();
  await expect(ui.locator('.palette')).toHaveCSS('background-color', 'rgb(41, 42, 45)');
  await second.getByRole('tab', { name: '外观', exact: true }).click();
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
    await article.press('Tab'); await expect(page.locator('.help-github-card')).toBeFocused();
    await page.keyboard.press('Tab'); await expect(page.locator('.primary-action')).toBeFocused();
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

test.describe(() => {
  const locale = 'en-US';
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
    expect(headingBox!.y - (searchBox!.y + searchBox!.height)).toBeLessThanOrEqual(16);
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
    await article.press('Tab'); await expect(ui.locator('.help-github-card')).toBeFocused();
    await ui.keyboard.press('Tab'); await expect(ui.locator('.help-view .footer-hint-pet')).toBeFocused();
    await ui.keyboard.press('Shift+Tab'); await expect(ui.locator('.help-github-card')).toBeFocused();
    await ui.keyboard.press('Shift+Tab'); await expect(article).toBeFocused();
    await article.press('Escape');
    await expect(input).toBeFocused(); await expect(input).toHaveValue('help');
    expect(await input.evaluate(el => [(el as HTMLInputElement).selectionStart, (el as HTMLInputElement).selectionEnd])).toEqual([0, 1]);
    await expect(ui.locator('.result[aria-selected="true"]')).toContainText(helpName);

    // Mouse entry and Settings top Back use the same document as keyboard search.
    await ui.locator('.settings-button').click();
    await expect(ui.getByRole('tab', { name: helpName, exact: true })).toBeVisible();
    const settingsSearch = ui.getByRole('textbox', { name: english ? 'Search settings' : '搜索设置', exact: true });
    await settingsSearch.fill(english ? '帮助' : 'help');
    await expect(ui.locator('[data-setting]')).toHaveCount(1);
    await ui.getByRole('button', { name: readName }).click();
    await expect(article).toBeFocused();
    await expect(settingsSearch).toBeVisible();
    await expect(article).toContainText(shortcut);
    expect((await ui.locator('.settings-footer .palette-footer').boundingBox())!.y).toBe(originalFooter!.y);
    await ui.locator('.settings-search .search-focus.is-back').click();
    await expect(settingsSearch).toHaveValue(english ? '帮助' : 'help');
    await expect(ui.getByRole('button', { name: readName })).toBeFocused();
    await ui.keyboard.press('Enter'); await expect(article).toBeFocused();
    await ui.keyboard.press('Backspace');
    await expect(ui.getByRole('button', { name: readName })).toBeFocused();
    await ui.keyboard.press('Escape'); await expect(settingsSearch).toHaveValue(''); await expect(settingsSearch).toBeFocused();
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
    await ui.locator('.help-search .search-focus.is-back').click();
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

  test('English settings entries, narrow layout and Chrome hotkey settings', async () => {
  const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  const switcher = ui.locator('[id="justonehop-command:tabSwitcher"]');
  const actualBinding = await worker.evaluate(async () => (await chrome.commands.getAll()).find(command => command.name === 'switch-recent')?.shortcut || '');
  for (const query of ['', 'Code']) {
    await input.fill(query);
    await expect(switcher).toBeVisible();
    await expect(switcher.locator('.entry-subtitle')).toHaveText('Switch tabs like in VS Code');
    if (actualBinding) await expect(switcher.locator('.entry-shortcut kbd')).toHaveText(actualBinding);
    else await expect(switcher.locator('.entry-shortcut')).toHaveCount(0);
    if (query) await expect(switcher.locator('.entry-subtitle mark')).toHaveText('Code');
  }
  const originalPreferences = await worker.evaluate(async () => (await chrome.storage.local.get('preferences')).preferences as { language?: string; theme?: string } | undefined);
  for (const theme of ['light', 'dark']) {
    await worker.evaluate(preferences => chrome.storage.local.set({ preferences }), { language: 'en', theme });
    await expect(ui.locator('.justonehop-app')).toHaveAttribute('data-theme', theme);
  }
  await worker.evaluate(async preferences => {
    if (preferences === undefined) await chrome.storage.local.remove('preferences');
    else await chrome.storage.local.set({ preferences });
  }, originalPreferences);
  await expect(ui.locator('.justonehop-app')).toHaveAttribute('data-theme', originalPreferences?.theme ?? 'system');
  await input.fill('');
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
  await ui.locator('.help-search .search-focus.is-back').click();
  await expect(input).toBeFocused();
  await input.fill('设置');
  await expect(ui.locator('.result').first()).toContainText('Settings');
  await expect(ui.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
  await input.press('Enter');
  await expect(ui.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  await expect(ui.getByRole('textbox', { name: 'Search settings', exact: true })).toBeFocused();
  await ui.getByRole('tab', { name: 'Keyboard', exact: true }).click();
  await expect(ui.locator('[data-setting="keyboard"] .hotkey-value')).toHaveText(await worker.evaluate(async () => (await chrome.commands.getAll()).find(c => c.name === 'toggle-palette')!.shortcut!));
  await expect(ui.locator('[data-setting="binding"] .hotkey-value')).toHaveText(await worker.evaluate(async () => (await chrome.commands.getAll()).find(c => c.name === 'switch-recent')?.shortcut || 'Not assigned'));
  await expect(ui.locator('[data-setting="binding"] label')).toHaveText('Tab Switcher');
  await expect(ui.locator('[data-setting="binding"] p')).toHaveText('Switch tabs like in VS Code using the shortcut shown. Prefer Ctrl+Tab? Set it up once.');
  await expect(ui.locator('[data-setting="keyboard"] .hotkey-value')).toHaveAttribute('title', /(?:Shift \+ Command|Command \+ Shift) \+ P — Open \/ Close JustOneHop/);
  await expect(ui.locator('[data-setting="binding"] .hotkey-value')).toHaveAttribute('title', / — Switch tabs like in VS Code using the shortcut shown\./);
  await expect(ui.locator('[data-setting="binding"] .hotkey-value')).toHaveAttribute('aria-label', await ui.locator('[data-setting="binding"] .hotkey-value').getAttribute('title') as string);
  await ui.getByRole('tab', { name: 'Appearance', exact: true }).click();
  await ui.locator('[data-setting="language"] label').hover();
  for (const category of ['Appearance', 'Keyboard', 'Labs']) {
    await ui.getByRole('tab', { name: category, exact: true }).click();
    await expect(ui.locator('.settings-body h2')).toHaveCount(0);
    for (const label of await ui.locator('.setting-copy label:not([for])').all()) {
      await expect(label).toHaveCSS('cursor', 'default');
    }
  }
  await expect(ui.locator('.setting-copy label[for]')).toHaveCSS('cursor', 'pointer');
  await ui.getByRole('tab', { name: 'Appearance', exact: true }).click();
  const header = ui.locator('.settings-search');
  const headerBox = await header.boundingBox();
  expect(headerBox!.height).toBe(mainHeader!.height);
  expect(headerBox!.y).toBe(mainHeader!.y);
  const settingsSearch = ui.getByRole('textbox', { name: 'Search settings', exact: true });
  await settingsSearch.click();
  await expect(settingsSearch).toBeFocused();
  await expect(ui.locator('.settings-view .palette-footer-title')).toHaveText('Settings');
  const settingsFooter = await ui.locator('.settings-view .palette-footer').boundingBox();
  expect(settingsFooter!.y).toBe(mainFooter!.y);
  expect(settingsFooter!.height).toBe(44);
  await expect(settingsSearch).toBeFocused();
  await ui.locator('.settings-search .search-focus.is-back').click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('设置');
  await input.press('Enter');
  const language = ui.getByRole('combobox', { name: 'Language', exact: true });
  const theme = ui.getByRole('combobox', { name: 'Theme', exact: true });
  const languageBox = await language.boundingBox();
  const languageRow = await ui.locator('[data-setting="language"] .setting-row').boundingBox();
  await expect(language).toHaveCSS('height', '32px');
  await expect(language).toHaveCSS('border-radius', '8px');
  await expect(language).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await ui.getByRole('tab', { name: 'Appearance', exact: true }).click();
  const themeBox = await theme.boundingBox();
  // Both settings begin their category; descriptions may change control height offsets.
  expect((await ui.locator('[data-setting="theme"] .setting-row').boundingBox())!.y).toBeGreaterThan(languageRow!.y);
  expect(themeBox!.x).toBe(languageBox!.x);
  expect(themeBox!.width).toBe(languageBox!.width);
  await ui.getByRole('tab', { name: 'Labs', exact: true }).click();
  const experiments = ui.locator('.settings-experiments');
  await expect(ui.locator('[data-setting="tabs"] > .setting-row p')).toContainText('Pages stay open.');
  await expect(ui.locator('.tuck-settings')).toHaveCount(0);
  await expect(experiments.getByRole('switch')).toHaveCount(1);
  await expect(experiments.getByRole('button')).toHaveText(['How it works', 'Reset Ranking']);
  await ui.getByRole('tab', { name: 'Keyboard', exact: true }).click();
  const changeButton = ui.getByRole('button', { name: 'Change in Chrome' });
  await expect(changeButton).toHaveCSS('height', '32px');
  await expect(changeButton).toHaveCSS('border-radius', '100px');
  await expect(changeButton).toHaveCSS('font-weight', '500');
  await expect(ui.locator('.settings-page .footer-divider')).toHaveCount(0);
  const navigation = ui.locator('.settings-navigation');
  await expect(navigation).not.toBeVisible();
  await ui.getByRole('button', { name: 'Show keyboard hints', exact: true }).click();
  await expect(navigation).toBeVisible();
  await expect(navigation.locator('.navigation-key')).toHaveText(['TabNext', 'Shift+TabPrevious']);
  await expect(navigation.locator('kbd')).toHaveText(['Tab', 'Shift+Tab']);
  await expect(navigation).toHaveAttribute('title', 'Tab moves to the next control; Shift+Tab moves to the previous control.');
  await ui.mouse.move(0, 0);
  await expect(navigation).toBeHidden();
  await ui.getByRole('tab', { name: 'Appearance', exact: true }).click();
  await ui.locator('.settings-view').screenshot({ path: test.info().outputPath('settings-light.png') });
  // Each category keeps its full visible Tab chain, including category navigation.
  for (const [category, fields] of [
    ['Appearance', [language, theme, ui.getByRole('button', { name: 'Wear Badge' }), ui.getByRole('switch', { name: 'Hide Pet' })]],
    ['Keyboard', [changeButton, ui.getByRole('button', { name: 'Set Up', exact: true })]],
    ['Labs', [experiments.getByRole('switch'), experiments.getByRole('button', { name: 'How it works' }), experiments.getByRole('button', { name: 'Reset Ranking' })]],
  ] as const) {
    const categoryTab = ui.getByRole('tab', { name: category, exact: true });
    await categoryTab.click();
    await settingsSearch.click();
    const controls = [header.locator('.search-dismiss'), ...['Appearance', 'Keyboard', 'Labs', 'Help'].map(name => ui.getByRole('tab', { name, exact: true })), ...fields,
      ui.locator('.settings-view .footer-hint-pet'), header.locator('.search-focus.is-back'), settingsSearch];
    for (const control of controls) { await ui.keyboard.press('Tab'); await expect(control).toBeFocused(); }
    await ui.keyboard.press('Shift+Tab');
    await expect(header.locator('.search-focus.is-back')).toBeFocused();
    await ui.keyboard.press('Shift+Tab');
    await expect(ui.locator('.settings-view .footer-hint-pet')).toBeFocused();
    await ui.keyboard.press('Tab');
    await ui.keyboard.press('Tab');
  }
  await ui.getByRole('tab', { name: 'Appearance', exact: true }).click();
  await settingsSearch.fill('lang');
  await expect(ui.locator('.settings-body h2')).toHaveCount(0);
  await expect(ui.locator('[data-setting]')).toHaveCount(1);
  await expect(ui.locator('[data-setting="language"] label')).toHaveText('Language');
  await expect(ui.locator('.settings-body mark')).toHaveCount(0);
  await settingsSearch.fill('主题');
  await expect(theme).toBeVisible();
  await expect(language).toHaveCount(0);
  await settingsSearch.press('Tab');
  await expect(header.locator('.search-dismiss')).toBeFocused();
  await expect(header.locator('.search-dismiss')).toHaveAccessibleName('Clear search');
  await ui.keyboard.press('Tab');
  await expect(ui.getByRole('tab', { name: 'Appearance', exact: true })).toBeFocused();
  for (let step = 0; step < 4; step++) await ui.keyboard.press('Tab');
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
  await expect(navigation).toBeHidden();
  await ui.getByRole('button', { name: 'Show keyboard hints', exact: true }).click();
  await expect(navigation).toBeVisible();
  await ui.mouse.move(0, 0);
  await expect(navigation).toBeHidden();
  const footer = await ui.locator('.settings-view .palette-footer').boundingBox();
  expect(footer!.height).toBe(44);
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(palette!.y + palette!.height);
  const categories = ui.getByRole('combobox', { name: 'Settings categories', exact: true });
  await expect(categories).toBeVisible();
  const narrowLanguageRow = await ui.locator('[data-setting="language"] .setting-row').boundingBox();
  const narrowThemeRow = await ui.locator('[data-setting="theme"] .setting-row').boundingBox();
  expect(narrowThemeRow!.y).toBeGreaterThan(narrowLanguageRow!.y);
  await categories.selectOption({ label: 'Appearance' });
  await ui.getByRole('combobox', { name: 'Language', exact: true }).click();
  await expect(ui.locator('.choice-option').first()).toHaveCSS('min-height', '32px');
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('settings-select-narrow.png') });
  const menu = await ui.locator('.choice-menu').boundingBox();
  const body = await ui.locator('.settings-body').boundingBox();
  expect(menu!.y).toBeGreaterThanOrEqual(body!.y);
  expect(menu!.y + menu!.height).toBeLessThanOrEqual(body!.y + body!.height);
  await ui.getByRole('option', { name: '简体中文', exact: true }).click();
  await expect(ui.getByRole('region', { name: '设置', exact: true })).toBeVisible();
  const chineseCategories = ui.getByRole('combobox', { name: '设置分类', exact: true });
  for (const category of ['外观', '键盘', '实验室']) {
    await chineseCategories.selectOption({ label: category });
    await expect(ui.locator('.settings-body h2')).toHaveCount(0);
  }
  await chineseCategories.selectOption({ label: '外观' });
  await expect(navigation.locator('.navigation-key')).toHaveText(['Tab下一个', 'Shift+Tab上一个']);
  await expect(navigation.locator('kbd')).toHaveText(['Tab', 'Shift+Tab']);
  await ui.locator('.settings-view').screenshot({ path: test.info().outputPath('settings-narrow.png') });
  await chineseCategories.selectOption({ label: '键盘' });
  const nextPage = context.waitForEvent('page');
  await ui.getByRole('button', { name: '前往修改' }).click();
  const shortcuts = await nextPage;
  await expect(shortcuts).toHaveURL('chrome://extensions/shortcuts');
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
  await page.keyboard.press('Shift+Tab'); // Settings top Back badge
  await expect.poll(async () => (await ax()).some(n => n.role?.value === 'button' && n.name?.value === '返回' && n.properties?.some(p => p.name === 'focused' && p.value.value === true))).toBe(true);
  await page.keyboard.press('Tab'); // Search
  await page.keyboard.press('Tab'); // Search Escape button
  await page.keyboard.press('Tab'); // Appearance category
  for (let step = 0; step < 4; step++) await page.keyboard.press('Tab'); // Remaining categories, then Language
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await ax()).some(n => n.role?.value === 'region' && n.name?.value === 'Settings')).toBe(true);
  await page.keyboard.press('Tab'); // Theme follows Language in Appearance
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

for (const host of ['overlay', 'native'] as const) test.describe('headed', { tag: ['@headed', '@clipboard'] }, () => {
  test.use({ environment: { ...defaults, locale: 'en-US', pageAccess: true, shadow: 'open', commands: true, headed: true } });
  test(`English Settings Keyboard binding guide survives real ${host} navigation`, async () => {
    const source = await context.newPage();
    await source.goto(host === 'overlay' ? `${origin}/Binding-guide-source` : 'chrome://version/');
    await source.bringToFront();
    const sourceTab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!, source.url());
    const activeTab = () => worker.evaluate(async windowId => (await chrome.tabs.query({ windowId, active: true }))[0]?.id, sourceTab.windowId);
    await expect.poll(() => source.evaluate(() => document.hasFocus())).toBe(true);
    await worker.evaluate(async () => {
      const callbacks = (globalThis as unknown as { __recentCommands: ((command: string) => Promise<void>)[] }).__recentCommands;
      await Promise.all(callbacks.map(callback => callback('toggle-palette')));
    });
    if (host === 'native') await expect.poll(() => context.pages().some(page => page.url().includes('popup.html#window='))).toBe(true);
    const native = host === 'native' ? context.pages().find(page => page.url().includes('popup.html#window='))! : undefined;
    const surface = native || source.frameLocator('.justonehop-frame');
    await surface.locator('.settings-button').click();
    await surface.getByRole('tab', { name: 'Keyboard', exact: true }).click();
    await surface.getByRole('button', { name: 'Set Up', exact: true }).click();
    const code = await surface.getByRole('textbox', { name: 'JavaScript code' }).inputValue();
    await surface.getByRole('button', { name: 'Copy & Open', exact: true }).click();
    await expect.poll(() => context.pages().some(page => page.url() === 'chrome://extensions/shortcuts')).toBe(true);
    const shortcuts = context.pages().find(page => page.url() === 'chrome://extensions/shortcuts')!;
    const shortcutsId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url === 'chrome://extensions/shortcuts')!.id!);
    await shortcuts.bringToFront();
    await expect.poll(activeTab).toBe(shortcutsId);
    if (host === 'overlay') {
      for (let round = 0; round < 3; round++) {
        await source.bringToFront();
        await expect(surface.locator('.binding-guide')).toBeVisible();
        await expect(surface.getByRole('textbox', { name: 'JavaScript code' })).toHaveValue(code);
        await expect.poll(activeTab).toBe(sourceTab.id);
        await shortcuts.bringToFront();
        await expect.poll(activeTab).toBe(shortcutsId);
      }
      await source.bringToFront();
      await surface.locator('.settings-search .search-focus.is-back').click();
      await shortcuts.bringToFront();
      await expect.poll(activeTab).toBe(shortcutsId);
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
      await expect(ui.locator('#justonehop-results .result:not(#justonehop-search-all-history):not([id^="justonehop-google:"])')).toHaveCount(0);
      await expect(ui.locator('#justonehop-results .result')).toHaveCount(2);
      await expect(ui.locator('[id^="justonehop-google:"]')).toHaveCount(1);
      await expect(ui.locator('#justonehop-search-all-history')).toHaveCount(1);
    }
    const permissions = await worker.evaluate(() => {
      const manifest = chrome.runtime.getManifest();
      return [...(manifest.permissions || []), ...(manifest.optional_permissions || [])];
    });
    expect(permissions).not.toContain('userScripts');
    expect(await ui.evaluate(() => '__legacyScriptExecuted' in globalThis)).toBe(false);
    await ui.locator('.settings-button').click();
    const settingIds: string[] = [];
    for (const category of ['Appearance', 'Keyboard', 'Labs']) {
      await ui.getByRole('tab', { name: category, exact: true }).click();
      settingIds.push(...await ui.locator('[data-setting]').evaluateAll(rows => rows.map(row => row.getAttribute('data-setting')!)));
      await expect(ui.getByRole('button', { name: 'Manage Scripts', exact: true })).toHaveCount(0);
    }
    expect(settingIds).toEqual(['language', 'theme', 'searchIcon', 'hidePet', 'keyboard', 'binding', 'tabs', 'ranking']);
    const settings = ui.getByRole('textbox', { name: 'Search settings', exact: true });
    await settings.fill('scripts'); await expect(ui.locator('[data-setting]')).toHaveCount(0);
    await settings.fill('ctrl tab');
    const setup = ui.getByRole('button', { name: 'Set Up', exact: true });
    await setup.click();
    await expect(ui.getByRole('region', { name: 'Set Up Ctrl+Tab', exact: true })).toBeVisible();
    await expect(ui.locator('.binding-code-field textarea')).toHaveAttribute('readonly', '');
    await ui.locator('.settings-search .search-focus.is-back').click();
    await expect(settings).toHaveValue('ctrl tab'); await expect(setup).toBeFocused();
    await ui.keyboard.press('Escape'); await expect(settings).toHaveValue(''); await expect(settings).toBeFocused();
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
  test('English binding guide copies this installation ID and opens Chrome shortcuts', { tag: '@clipboard' }, async () => {
  await context.grantPermissions(['clipboard-read']);
  const before = await worker.evaluate(() => chrome.commands.getAll());
  await ui.locator('.settings-button').click();
  await ui.getByRole('tab', { name: 'Keyboard', exact: true }).click();
  await ui.getByRole('button', { name: 'Set Up', exact: true }).click();
  await expect(ui.locator('.settings-footer .palette-footer-title')).toHaveText('Settings');
  await expect(ui.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await expect(ui.getByRole('textbox', { name: 'JavaScript code' })).toHaveAttribute('readonly', '');
  await expect(ui.locator('.binding-view .settings-header')).toHaveCount(0);
  const copy = ui.locator('.palette-footer .primary-action');
  await expect(copy).toHaveAccessibleName('Copy & Open');
  await expect(copy).toBeFocused();
  await expect(ui.locator('.binding-body')).toBeVisible();
  await ui.locator('.palette-footer .actions-button').click();
  await ui.getByRole('dialog').getByRole('option', { name: /^Copy Code/ }).click();
  await expect(ui.locator('.operation-feedback[role="status"]')).toContainText('Code copied');
  const code = await ui.evaluate(() => navigator.clipboard.readText());
  expect(code).not.toMatch(/[\r\n]/);
  await expect(ui.locator('.palette-footer-title')).toHaveText('Settings');
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
  await ui.locator('.settings-view').screenshot({ path: test.info().outputPath('binding-guide.png') });
  await ui.locator('.palette-footer .actions-button').click();
  await expect(ui.getByRole('dialog').getByRole('option', { name: 'Delete', exact: true })).toHaveCount(0);
  await ui.locator('.settings-search .search-focus.is-back').click();
  await expect(ui.locator('.action-menu')).toHaveCount(0);
  await expect(ui.locator('.palette-footer-title')).toHaveText('Settings');
  await ui.evaluate(() => navigator.clipboard.writeText('before combined action'));
  await copy.focus();
  const created = context.waitForEvent('page');
  await ui.keyboard.press('Enter');
  await expect(await created).toHaveURL('chrome://extensions/shortcuts');
  expect(ui.isClosed()).toBe(false);
  await ui.bringToFront();
  await expect(ui.locator('.binding-guide')).toBeVisible();
  await expect(ui.locator('.palette-footer-title')).toHaveText('Settings');
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
  test('English binding guide copies from unified search inside the closed keyboard frame', { tag: '@clipboard' }, async () => {
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

test('Chinese binding guide returns to settings and retains its standalone handoff', { tag: '@clipboard' }, async () => {
  const search = ui.getByRole('combobox', { name: '搜索命令、标签页、书签和历史' });
  await search.fill('ctrl tab');
  await expect(ui.getByRole('option', { selected: true })).toBeVisible();
  await search.press('Enter');
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

test.describe(() => {
  test.use({ environment: { ...defaults, locale: 'en-US' } });
  test('English binding guide preserves code selection through the shared action menu', { tag: '@clipboard' }, async () => {
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
  test('Hop Badge Escape returns one level inside the closed webpage overlay', async () => {
    const page = await context.newPage(); await page.goto(`${origin}/Escape-badge`);
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
    await page.keyboard.type('hop badge');
    await expect.poll(async () => (await ax()).some(node => node.role?.value === 'option' && node.name?.value?.includes('Hop Badge') && node.properties?.some(prop => prop.name === 'selected' && prop.value.value === true))).toBe(true);
    await page.keyboard.press('Enter');
    await expect.poll(() => focused('Wear Badge')).toBe(true);
    await page.keyboard.press('Enter');
    await expect.poll(() => focused('Choose Image')).toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(() => focused('Wear Badge')).toBe(true);
    await expect.poll(async () => (await ax()).some(node => node.role?.value === 'heading' && node.name?.value === 'Hop Badge')).toBe(false);
    await expect(page.locator('#justonehop-command-palette')).toBeAttached();
    await page.keyboard.press('Escape');
    await expect.poll(() => focused('Search commands, tabs, bookmarks, and history')).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#justonehop-command-palette')).not.toBeAttached();
  });
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
  await page.keyboard.type('ctrl tab');
  await expect.poll(async () => {
    const nodes = await ax();
    return nodes.some(node => node.role?.value === 'listbox' && !node.properties?.some(prop => prop.name === 'busy' && prop.value.value === true)) &&
      nodes.some(node => node.role?.value === 'option' && node.name?.value?.includes('Set Up Ctrl+Tab') && node.properties?.some(prop => prop.name === 'selected' && prop.value.value === true));
  }, { message: 'Binding setup command is selected and ready' }).toBe(true);
  await page.keyboard.press('Enter');
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
  await expect(ui.locator('[id="justonehop-command:tabSwitcher"]')).toHaveAttribute('aria-selected', 'true');
  await ui.locator('.search-bar input').press('Enter');
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
