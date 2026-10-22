import sharp from 'sharp';
import { test, expect } from './support/paletteUI';
import { readFile } from 'node:fs/promises';

test('overlay image upload preserves visible pixels through preview and save', async ({ palette }) => {
  const { ui } = palette;
  await palette.open({ locale: 'en-US', overlay: true });
  const surface = ui.frameLocator('.justonehop-frame');
  await surface.locator('.settings-button').click();
  await surface.getByRole('tab', { name: 'Appearance', exact: true }).click();
  await surface.getByRole('button', { name: 'Change Icon' }).click();
  const buffer = process.env.JUSTONEHOP_TEST_ICON
    ? await readFile(process.env.JUSTONEHOP_TEST_ICON)
    : await sharp({ create: { width: 512, height: 512, channels: 4, background: '#00c49a' } }).png().toBuffer();
  await surface.locator('input[type=file]').setInputFiles({ name: 'icon.png', mimeType: 'image/png', buffer });
  const preview = surface.locator('.search-icon-preview img');
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth === 64)).toBe(true);
  await surface.locator('.settings-view').screenshot({ path: test.info().outputPath('overlay-icon-upload.png') });
  await surface.getByRole('button', { name: 'Save Icon' }).click();
  const icon = surface.locator('.search-focus img');
  await expect.poll(() => icon.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth === 64)).toBe(true);
});

test('overlay keeps each preview visible across repeated PNG and JPEG uploads', async ({ palette }) => {
  const { ui } = palette;
  await palette.open({ locale: 'en-US', overlay: true });
  const surface = ui.frameLocator('.justonehop-frame');
  await surface.locator('.settings-button').click();
  await surface.getByRole('tab', { name: 'Appearance', exact: true }).click();
  await surface.getByRole('button', { name: 'Change Icon' }).click();
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
  await surface.getByRole('button', { name: 'Save Icon' }).click();
  await expect(surface.locator('.search-focus img')).toBeVisible();
});

test('search icon editor supports keyboard Emoji, image previews, failures and narrow layouts', async ({ palette }) => {
  const { ui } = palette;
  await palette.open({ locale: 'en-US' });
  const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await search.fill('emoji'); await search.press('Enter');
  const change = ui.getByRole('button', { name: 'Change Icon' });
  await expect(change).toBeFocused(); await change.press('Enter');
  const emoji = ui.getByRole('textbox', { name: 'Emoji', exact: true });
  await expect(emoji).toBeFocused();
  await expect(emoji).toHaveCSS('border-width', '1px');
  await expect(emoji).toHaveCSS('border-radius', '8px');
  await expect(emoji).toHaveCSS('font-size', '20px');
  await expect(emoji).toHaveCSS('outline-style', 'solid');
  await expect(emoji).toHaveCSS('outline-width', '2px');
  await expect(ui.locator('.search-icon-settings .search-bar, .search-icon-settings .search-focus, .search-icon-settings .footer-back')).toHaveCount(0);
  await expect(ui.getByRole('heading', { name: 'Search Bar Icon', exact: true })).toBeVisible();
  const defaults = ui.getByRole('button', { name: 'Use Default', exact: true });
  await expect(defaults.locator('kbd')).toHaveCount(0);
  await expect(defaults.locator('.brand-logo')).toBeVisible();
  await expect(defaults).toHaveAttribute('title', 'Use Default');
  const back = ui.locator('.settings-footer').getByRole('button', { name: 'Back', exact: true });
  await expect(back).toHaveCount(1);
  await emoji.press('Shift+Tab'); await expect(ui.getByRole('tab', { name: 'Appearance', exact: true })).toBeFocused();
  await back.focus();
  await back.press('Shift+Enter'); await expect(ui.locator('.search-icon-settings')).toBeVisible();
  await back.press('Enter'); await expect(change).toBeFocused();
  await change.click(); await expect(emoji).toBeFocused();
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
  await expect(ui.getByRole('button', { name: 'Save Icon' })).toBeEnabled();
  await emoji.press('Enter');
  await expect(change).toBeFocused();
  await expect(ui.locator('.search-focus')).toHaveText('👩🏽‍💻');
  await change.press('Enter');
  await emoji.fill('🚀🚀');
  const disabledSave = ui.getByRole('button', { name: 'Save Icon' });
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
  await expect(ui.locator('.search-icon-preview')).toContainText('👩🏽‍💻');
  for (const format of ['png', 'jpeg', 'webp'] as const) {
    const buffer = await sharp({ create: { width: 120, height: 60, channels: 4, background: '#ff0000' } }).toFormat(format).toBuffer();
    await file.setInputFiles({ name: `icon.${format}`, mimeType: `image/${format}`, buffer });
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
  await expect(ui.getByRole('button', { name: 'Save Icon' })).toBeInViewport();
  await expect(back).toBeInViewport();
  await ui.getByRole('button', { name: 'Save Icon' }).click();
  await expect(change).toBeFocused();
  await expect(ui.locator('.search-focus img')).toBeVisible();
  await change.click();
  await ui.getByRole('button', { name: 'Use Default' }).click();
  await expect(ui.locator('.search-icon-preview .brand-logo')).toBeVisible();
  await ui.getByRole('button', { name: 'Save Icon' }).click();
  await expect(ui.locator('.search-focus .brand-logo')).toBeVisible();
  expect((palette.store.preferences as { searchIcon?: string }).searchIcon).toBeUndefined();
});
