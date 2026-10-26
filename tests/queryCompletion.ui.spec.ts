import { test, expect, snapshotTab } from './support/paletteUI';

test('query completion keeps explicit input and supports keyboard and mouse', async ({ palette }) => {
  palette.store.searchUsage = [{ query: 'github', target: 'tab:https://github.com/', weight: 2, lastUsed: Date.now() }];
  await palette.open({ locale: 'en-US', overlay: true,
    snapshot: { tabs: [snapshotTab(2, 'github'), snapshotTab(3, 'gmail')] },
    reply: request => request.type === 'execute' && request.payload.action === 'switch' ? { ok: true, data: undefined } : undefined });
  const { ui } = palette;
  const surface = ui.frameLocator('iframe.justonehop-frame');
  const input = surface.locator('.search-bar input');
  const hint = surface.locator('.query-completion');
  const complete = surface.getByRole('button', { name: 'Complete', exact: true });
  const start = async () => { await input.fill(''); await input.fill('g'); await expect(hint).toHaveText('github'); };
  await start();
  await expect(input).toHaveValue('g');
  await expect(surface.locator('.result.tab')).toHaveCount(2);
  await input.press('ArrowDown');
  await expect(input).toHaveValue('g');
  await input.press('Tab');
  await expect(input).toHaveValue('github');
  await expect(input).toBeFocused();
  await expect(surface.locator('.result.tab')).toHaveCount(1);
  await input.press('Tab');
  await expect(input).not.toBeFocused();
  await surface.locator('.search-dismiss').click();
  await expect(input).toHaveValue(''); await expect(input).toBeFocused();

  for (const key of ['ArrowRight', 'Control+e']) {
    await start(); await input.press(key); await expect(input).toHaveValue('github');
  }
  await start();
  await input.dispatchEvent('keydown', { key: 'Tab', repeat: true });
  await expect(input).toHaveValue('g'); await expect(input).toBeFocused();
  await input.press('Meta+k');
  await expect(hint).toHaveCount(0);
  await surface.getByRole('combobox', { name: 'Search actions' }).press('Escape');
  await expect(input).toHaveValue('g'); await expect(hint).toHaveText('github');
  await start(); await input.press('Shift+Tab');
  await expect(input).toHaveValue('g'); await expect(input).not.toBeFocused();
  await start(); await complete.click();
  await expect(input).toHaveValue('github'); await expect(input).toBeFocused();
  await input.press('Backspace'); await expect(input).toHaveValue('githu'); await expect(hint).toHaveCount(0);
  await input.press('b'); await expect(input).toHaveValue('github');

  await start(); await input.press('ArrowLeft'); await expect(hint).toHaveCount(0);
  await input.press('Tab'); await expect(input).toHaveValue('g'); await expect(input).not.toBeFocused();
  await start(); await input.press('Shift+ArrowLeft'); await expect(hint).toHaveCount(0);
  await start();
  await input.dispatchEvent('compositionstart'); await expect(hint).toHaveCount(0);
  await input.dispatchEvent('keydown', { key: 'Tab', isComposing: true });
  await input.dispatchEvent('keydown', { key: 'Enter', keyCode: 229 });
  await expect(input).toHaveValue('g'); expect(await palette.executions()).toEqual([]);
  await input.dispatchEvent('compositionend'); await expect(hint).toHaveText('github');

  await palette.provideStorage({ searchUsage: [
    { query: 'github', target: 'tab:https://github.com/', weight: 2, lastUsed: Date.now() },
    { query: 'gmail', target: 'tab:https://gmail.com/', weight: 20, lastUsed: Date.now() },
  ] });
  await expect(hint).toHaveText('github');
  await palette.provideStorage({ searchUsage: [] }); await expect(hint).toHaveCount(0);
  await palette.provideStorage({ searchUsage: [{ query: 'github', target: 'tab:https://github.com/', weight: 2, lastUsed: Date.now() }] });
  await expect(hint).toHaveText('github');

  await ui.setViewportSize({ width: 390, height: 640 });
  const longQuery = 'github '.repeat(18) + 'issues';
  await palette.provideStorage({ searchUsage: [{ query: longQuery, target: 'query:navigation', weight: 2, lastUsed: Date.now() }] });
  await input.fill(longQuery.slice(0, -3));
  await expect(hint).toHaveText(longQuery);
  expect(await surface.locator('.palette').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await input.press('Tab'); await expect(input).toHaveValue(longQuery);
  await palette.provideStorage({ searchUsage: [{ query: 'github', target: 'tab:https://github.com/', weight: 2, lastUsed: Date.now() }] });
  await start();
  for (const theme of ['light', 'dark']) {
    await palette.provideStorage({ preferences: { language: 'en', theme } });
    await expect(complete).toBeInViewport();
    expect(await surface.locator('.palette').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await surface.locator('.palette').screenshot({ path: test.info().outputPath(`completion-${theme}.png`) });
  }
  await complete.click(); await expect(input).toHaveValue('github'); await expect(input).toBeFocused();
  await start();
  await expect(surface.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
  const targetId = await surface.locator('.result[aria-selected="true"]').getAttribute('id');
  await input.press('Enter');
  await expect.poll(() => palette.executions()).toEqual([expect.objectContaining({ action: 'switch', query: 'g', tabId: Number(targetId!.split(':').at(-1)) })]);
});

test('query completion is unavailable in incognito even with existing local records', async ({ palette }) => {
  palette.store.searchUsage = [{ query: 'github', target: 'tab:https://github.com/', weight: 2, lastUsed: Date.now() }];
  await palette.open({ snapshot: { incognito: true } });
  const input = palette.ui.locator('.search-bar input');
  await input.fill('g');
  await expect(palette.ui.locator('.query-completion')).toHaveCount(0);
  await input.press('Tab'); await expect(input).not.toBeFocused();
});
