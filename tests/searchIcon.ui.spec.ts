import sharp from 'sharp';
import { test, expect } from './support/paletteUI';
import { readFile } from 'node:fs/promises';

test('overlay image upload preserves visible pixels through preview and save', async ({ palette }) => {
  const { ui } = palette;
  await palette.open({ locale: 'en-US', overlay: true });
  const surface = ui.frameLocator('.justonehop-frame');
  await surface.locator('.settings-button').click();
  await surface.getByRole('tab', { name: 'Appearance', exact: true }).click();
  await surface.getByRole('button', { name: 'Wear Badge' }).click();
  const buffer = process.env.JUSTONEHOP_TEST_ICON
    ? await readFile(process.env.JUSTONEHOP_TEST_ICON)
    : await sharp({ create: { width: 512, height: 512, channels: 4, background: '#00c49a' } }).png().toBuffer();
  await surface.locator('input[type=file]').setInputFiles({ name: 'icon.png', mimeType: 'image/png', buffer });
  const preview = surface.locator('.search-icon-preview img');
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth === 64)).toBe(true);
  await surface.locator('.settings-view').screenshot({ path: test.info().outputPath('overlay-icon-upload.png') });
  await ui.keyboard.press('Enter');
  const icon = surface.locator('.search-focus img');
  await expect.poll(() => icon.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth === 64)).toBe(true);
});

test('overlay keeps each preview visible across repeated PNG and JPEG uploads', async ({ palette }) => {
  const { ui } = palette;
  await palette.open({ locale: 'en-US', overlay: true });
  const surface = ui.frameLocator('.justonehop-frame');
  await surface.locator('.settings-button').click();
  await surface.getByRole('tab', { name: 'Appearance', exact: true }).click();
  await surface.getByRole('button', { name: 'Wear Badge' }).click();
  for (let attempt = 0; attempt < 12; attempt++) {
    await test.step(`upload ${attempt + 1}`, async () => {
      const format = attempt % 2 ? 'jpeg' : 'png';
      const path = format === 'jpeg' ? process.env.JUSTONEHOP_TEST_JPEG : process.env.JUSTONEHOP_TEST_ICON;
      const buffer = path ? await readFile(path)
        : await sharp({ create: { width: 512, height: 512, channels: 4,
          background: { r: 20 + attempt * 15, g: 100, b: 150, alpha: 1 } } }).toFormat(format).toBuffer();
      const previous = attempt ? await surface.locator('.search-icon-preview img').elementHandle() : null;
      await surface.locator('input[type=file]').setInputFiles({ name: `icon.${format}`, mimeType: `image/${format}`, buffer });
      if (previous) await expect.poll(() => previous.evaluate(node => node.isConnected)).toBe(false);
      await expect(surface.getByRole('button', { name: 'Choose Image' })).toBeEnabled();
      const preview = surface.locator('.search-icon-preview img');
      await expect.poll(() => preview.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth === 64)).toBe(true);
      await surface.locator('.settings-view').screenshot({ path: test.info().outputPath(`upload-${attempt + 1}.png`) });
    });
  }
  await ui.keyboard.press('Enter');
  await expect(surface.locator('.search-focus img')).toBeVisible();
});

test('search icon editor supports keyboard Emoji, image previews, failures and narrow layouts', async ({ palette }) => {
  const { ui } = palette;
  await palette.open({ locale: 'en-US', reply: request => request.type === 'open-help-url' ? { ok: true, data: undefined } : undefined });
  const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await search.fill('emoji'); await search.press('Enter');
  const change = ui.getByRole('button', { name: 'Wear Badge' });
  await expect(change).toBeFocused(); await change.press('Enter');
  const emoji = ui.getByRole('textbox', { name: 'Emoji', exact: true });
  const chooseImage = ui.getByRole('button', { name: 'Choose Image', exact: true });
  await expect(chooseImage).toBeFocused();
  await chooseImage.press('Shift+Tab'); await expect(emoji).toBeFocused();
  await expect(emoji).toHaveCSS('border-width', '1px');
  await expect(emoji).toHaveCSS('border-radius', '8px');
  await expect(emoji).toHaveCSS('font-size', '20px');
  await expect(emoji).toHaveCSS('outline-style', 'none');
  await expect(ui.locator('.search-icon-settings .search-bar, .search-icon-settings .search-focus, .search-icon-settings .footer-back')).toHaveCount(0);
  await expect(ui.getByRole('heading', { name: 'Hop Badge', exact: true })).toBeVisible();
  const defaults = ui.getByRole('button', { name: 'Restore', exact: true });
  await expect(defaults.locator('kbd')).toHaveCount(0);
  await expect(defaults.locator('.brand-logo')).toBeVisible();
  await expect(defaults).toHaveAttribute('title', 'Restore Default Badge');
  const back = ui.locator('.settings-footer').getByRole('button', { name: 'Back', exact: true });
  await expect(back).toHaveCount(1);
  await expect(emoji).toHaveValue('');
  await expect(emoji).not.toHaveAttribute('placeholder');
  const emojiLink = ui.getByRole('link', { name: 'Emoji', exact: true });
  await expect(emojiLink).toHaveAttribute('href', 'https://emoji.muan.co/');
  await emoji.press('Shift+Tab'); await expect(emojiLink).toBeFocused();
  await emojiLink.press('Enter');
  await expect.poll(() => palette.requests.filter(request => request.type === 'open-help-url')).toEqual([
    { source: 'justonehop', type: 'open-help-url', url: 'https://emoji.muan.co/' },
  ]);
  await expect(ui.locator('.search-icon-settings')).toBeVisible();
  await emojiLink.click();
  await expect.poll(() => palette.requests.filter(request => request.type === 'open-help-url')).toHaveLength(2);
  await emojiLink.press('Shift+Tab'); await expect(ui.getByRole('tab', { name: 'Help', exact: true })).toBeFocused();
  await back.focus();
  await back.press('Shift+Enter'); await expect(ui.locator('.search-icon-settings')).toBeVisible();
  await back.press('Enter'); await expect(change).toBeFocused();
  await change.click(); await expect(chooseImage).toBeFocused();
  await ui.keyboard.press('Escape'); await expect(change).toBeFocused();
  await change.press('Enter'); await expect(chooseImage).toBeFocused();
  for (const colorScheme of ['light', 'dark'] as const) {
    await ui.emulateMedia({ colorScheme });
    await ui.locator('.settings-view').screenshot({ path: test.info().outputPath(`search-icon-task-${colorScheme}.png`) });
  }
  await emoji.fill('👩🏽‍💻');
  await expect(ui.locator('.search-icon-preview')).toContainText('👩🏽‍💻');
  await emoji.press('Shift+Enter');
  await expect(ui.locator('.search-icon-settings')).toBeVisible();
  palette.failNextSave(); await emoji.press('Enter');
  await expect(ui.getByRole('alert')).toContainText('Could not save settings');
  expect((palette.store.preferences as { searchIcon?: string }).searchIcon).toBeUndefined();
  await expect(emoji).toBeFocused();
  await expect(ui.getByRole('button', { name: 'Wear Badge' })).toBeEnabled();
  await emoji.press('Enter');
  await expect(change).toBeFocused();
  await expect(ui.locator('.search-focus')).toHaveText('👩🏽‍💻');
  await change.press('Enter');
  await emoji.fill('🚀🚀');
  const disabledSave = ui.getByRole('button', { name: 'Wear Badge' });
  await expect(disabledSave).toBeDisabled();
  const idleBackground = await disabledSave.evaluate(node => getComputedStyle(node).backgroundColor);
  await disabledSave.hover();
  await expect(disabledSave).toHaveCSS('background-color', idleBackground);
  await expect(ui.getByRole('alert')).toContainText('Enter a single Emoji');
  await emoji.fill('🚀'); await emoji.press('Escape');
  await expect(ui.locator('.search-focus')).toHaveText('👩🏽‍💻');
  await change.click();
  const file = ui.locator('input[type=file]');
  await file.setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('<svg/>') });
  await expect(ui.getByRole('alert')).toContainText('Could not read image');
  await expect(chooseImage).toBeFocused();
  await expect(ui.locator('.search-icon-preview')).toContainText('👩🏽‍💻');
  for (const format of ['png', 'jpeg', 'webp'] as const) {
    const buffer = await sharp({ create: { width: 120, height: 60, channels: 4, background: '#ff0000' } }).toFormat(format).toBuffer();
    await file.setInputFiles({ name: `icon.${format}`, mimeType: `image/${format}`, buffer });
    await expect(ui.getByRole('button', { name: 'Wear Badge', exact: true })).toBeFocused();
    const image = ui.locator('.search-icon-preview img');
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth === 64)).toBe(true);
    const encoded = (await image.getAttribute('src'))!.split(',')[1];
    const { data, info } = await sharp(Buffer.from(encoded, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const center = (32 * info.width + 32) * info.channels;
    const [red, green, blue, alpha] = data.subarray(center, center + 4);
    expect(red >= 250 && green <= 5 && blue <= 5 && alpha === 255).toBe(true);
    expect(data[32 * info.channels + 3]).toBe(0);
  }
  await ui.setViewportSize({ width: 390, height: 400 });
  await ui.locator('.justonehop-app').evaluate(node => { node.classList.replace('popup', 'overlay'); document.body.style.width = '390px'; });
  expect(await ui.locator('.search-icon-settings .settings-body').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await ui.locator('.settings-view').screenshot({ path: test.info().outputPath('search-icon-narrow.png') });
  await expect(ui.getByRole('button', { name: 'Wear Badge' })).toBeInViewport();
  await expect(back).toBeInViewport();
  await expect(ui.getByRole('button', { name: 'Wear Badge' })).toBeFocused();
  await ui.keyboard.press('Enter');
  await expect(change).toBeFocused();
  await expect(ui.locator('.search-focus img')).toBeVisible();
  await change.click();
  await ui.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(ui.locator('.search-icon-preview .brand-logo')).toBeVisible();
  await ui.keyboard.press('Enter');
  await expect(ui.locator('.search-focus .brand-logo')).toBeVisible();
  expect((palette.store.preferences as { searchIcon?: string }).searchIcon).toBeUndefined();
});
