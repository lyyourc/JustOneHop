import { test, expect } from './support/paletteUI';
import type { Reply } from '../src/types';

test('Chinese recent bridge UI embedded switcher mouse selection and narrow geometry with supplied session', async ({ palette }) => {
  const { ui } = palette;
  await ui.setViewportSize({ width: 750, height: 760 });
  await palette.open({ overlay: {
    session: 'ui-session', sourceId: 1, offset: 1, modifier: 'Control', shortcut: 'Ctrl+Q',
    tabs: [{ id: 1, title: 'Bridge A', url: 'https://fixture.test/a' }, { id: 2, title: 'Bridge B', url: 'https://fixture.test/b' }] as chrome.tabs.Tab[],
  }, reply: request => request.source === 'justonehop-recent' && ['accept-overlay', 'cancel-overlay'].includes(request.type)
    ? { ok: true, data: undefined } : undefined });
  const surface = ui.frameLocator('.justonehop-frame');
  await expect(surface.getByRole('listbox')).toBeFocused(); await expect(surface.getByRole('combobox')).toBeDisabled();
  await expect(surface.getByRole('listbox')).toHaveCSS('outline-style', 'none');
  await ui.keyboard.press('ArrowUp');
  await expect(surface.getByRole('option', { selected: true })).toContainText('Bridge A');
  await expect(surface.getByRole('listbox')).toHaveCSS('outline-style', 'none');
  await ui.keyboard.press('ArrowDown');
  await expect(surface.getByRole('option', { selected: true })).toContainText('Bridge B');
  const searchHint = surface.locator('.palette-footer-context .navigation-key').last();
  await expect(searchHint).toHaveText('Ctrl+F搜索');
  await expect(searchHint).toBeVisible();
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('switcher-search-hint.png') });
  await ui.setViewportSize({ width: 390, height: 440 });
  // The isolated UI can focus before the entrance scale animation finishes.
  await expect.poll(() => surface.locator('.palette').evaluate(node =>
    node.getAnimations().every(animation => animation.playState === 'finished'))).toBe(true);
  const before = await surface.locator('.palette').boundingBox();
  expect(before!.x).toBe(10); expect(before!.y).toBe(24);
  expect(before!.x + before!.width).toBeLessThanOrEqual(380); expect(before!.y + before!.height).toBeLessThanOrEqual(416);
  const footer = await surface.locator('.palette-footer').boundingBox();
  expect(footer!.height).toBe(44); expect(footer!.y + footer!.height).toBe(before!.y + before!.height - 1);
  await expect(surface.locator('.palette-footer-context')).toBeHidden();
  await expect(surface.locator('.palette-footer-title')).toHaveText('松开 Ctrl 切换');
  await expect(surface.getByRole('combobox')).toHaveAttribute('placeholder', '搜索最近标签页…');
  expect((await surface.locator('.search-bar').boundingBox())!.height).toBe(56);
  await surface.locator('button.search-icon').click();
  await expect(surface.getByRole('combobox')).toBeEnabled(); await expect(surface.getByRole('combobox')).toBeFocused();
  await surface.getByRole('combobox').fill('Bridge'); await expect(surface.getByRole('option')).toHaveCount(2);
  await expect(surface.locator('.primary-action')).toBeInViewport({ ratio: 1 }); await expect(surface.locator('.secondary-action')).toBeInViewport({ ratio: 1 });
  expect(await surface.locator('.palette-footer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect.poll(() => surface.locator('.recent-overlay').evaluate(node => getComputedStyle(node).opacity)).toBe('1');
  await surface.locator('.palette').screenshot({ path: test.info().outputPath('switcher-overlay-narrow.png') });
  await surface.getByRole('option').filter({ hasText: 'Bridge B' }).click();
  await expect.poll(() => palette.requests.filter(request => request.type === 'accept-overlay')).toEqual([
    { source: 'justonehop-recent', type: 'accept-overlay', session: 'ui-session', tabId: 2 },
  ]);
  await expect(ui.locator('#justonehop-command-palette')).not.toBeAttached();
  // No actual command bridge or tab activation is claimed; English extension E2E covers both.
});

test('recent overlay retries failed confirmation and ignores a late success after cancellation', async ({ palette }) => {
  const { ui } = palette;
  let reply: ((result: Reply<undefined>) => void) | undefined;
  const session = {
    session: 'confirmation-session', sourceId: 1, offset: 1, modifier: 'Control', shortcut: 'Ctrl+Q',
    tabs: [{ id: 1, title: 'Source', url: 'https://fixture.test/a' }, { id: 2, title: 'Target', url: 'https://fixture.test/b' }] as chrome.tabs.Tab[],
  };
  await palette.open({ locale: 'en-US', overlay: session, reply: request => {
    if (request.source !== 'justonehop-recent') return undefined;
    if (request.type === 'cancel-overlay') return { ok: true, data: undefined };
    if (request.type === 'accept-overlay') return new Promise(resolve => { reply = resolve; });
    return undefined;
  } });
  // Observe completion of the actual UI message promise, including its consumer's
  // microtasks, so the late-reply assertion cannot pass before the reply arrives.
  await ui.evaluate(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    let completed = 0;
    chrome.runtime.sendMessage = ((message: { type: string }) => {
      const result = send(message);
      if (message.type === 'accept-overlay') void result.then(() => setTimeout(() => {
        document.body.dataset.acceptReplies = String(++completed);
      }, 0));
      return result;
    }) as typeof chrome.runtime.sendMessage;
  });
  const surface = ui.frameLocator('.justonehop-frame');
  await expect(surface.locator('.palette-footer-context .navigation-key').last()).toHaveText('Ctrl+FSearch');
  await expect(surface.locator('.palette-footer-context')).toBeVisible();
  await ui.keyboard.press('Control+f');
  await expect(surface.getByRole('combobox')).toBeFocused();
  await surface.getByRole('option').filter({ hasText: 'Target' }).click();
  await expect.poll(() => palette.requests.filter(request => request.type === 'accept-overlay').length).toBe(1);
  await ui.keyboard.press('Enter');
  expect(palette.requests.filter(request => request.type === 'accept-overlay')).toHaveLength(1);
  reply!({ ok: false, error: 'Switch failed' });
  await expect(surface.getByRole('alert')).toHaveText('Something went wrong. Please try again.');
  await expect(surface.locator('.primary-action')).toBeEnabled();
  await surface.locator('.primary-action').click();
  await expect.poll(() => palette.requests.filter(request => request.type === 'accept-overlay').length).toBe(2);
  await ui.keyboard.press('Escape');
  await expect(ui.locator('#justonehop-command-palette')).not.toBeAttached();
  expect(await palette.dispatch({ source: 'justonehop-recent', type: 'open-overlay', ...session, session: 'next-session' })).toBe(true);
  reply!({ ok: true, data: undefined });
  await expect(ui.locator('body')).toHaveAttribute('data-accept-replies', '2');
  await expect(surface.getByRole('option').filter({ hasText: 'Target' })).toBeVisible();
  await expect(surface.locator('.primary-action')).toBeEnabled();
  await ui.keyboard.press('Escape');
  await expect(ui.locator('#justonehop-command-palette')).not.toBeAttached();
});
