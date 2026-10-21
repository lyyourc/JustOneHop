import { test, expect, snapshotTab } from './support/paletteUI';

test('ambiguous page results show URL differences in main search and history', async ({ palette }) => {
  const root = 'https://github.com/lyyourc/JustOneHop';
  const title = 'lyyourc/JustOneHop: A Human-First Command Palette';
  await palette.open({ locale: 'en-US', snapshot: { tabs: [{ ...snapshotTab(2, 'repo'), title, url: root }] },
    reply: request => request.type === 'search-history' ? { ok: true, data: { items: [
      { id: 'root', title, url: root, lastVisitTime: Date.now() },
      { id: 'anchor', title, url: root + '#quick-shortcuts', lastVisitTime: Date.now() },
    ], limited: false } } : request.type === 'execute' && request.payload.action === 'openHistoryPage' ? { ok: true, data: undefined } : undefined });
  const { ui } = palette;
  const input = ui.locator('.search-bar input');
  await input.fill('justonehop');
  const anchor = ui.locator('[id="justonehop-history:anchor"]');
  await expect(ui.locator('.result.tab')).toHaveCount(1);
  await expect(ui.locator('.result.history')).toHaveCount(1);
  await expect(anchor.locator('.distinct-address-detail')).toHaveText('#quick-shortcuts');
  await expect(anchor).toHaveAttribute('title', `${title} — ${root}#quick-shortcuts`);
  await anchor.click({ button: 'right' });
  await ui.getByRole('combobox', { name: 'Search actions' }).press('Escape');
  await expect(input).toHaveValue('justonehop');
  await ui.locator('#justonehop-search-all-history').click();
  await expect(ui.locator('.history-view')).toBeVisible();
  await expect(ui.locator('.result.history')).toHaveCount(2);
  await expect(anchor.locator('.distinct-address-detail')).toHaveText('#quick-shortcuts');
  await ui.setViewportSize({ width: 390, height: 516 });
  await ui.evaluate(() => { document.body.style.width = '390px'; });
  await expect(anchor.locator('.distinct-address-detail')).toBeInViewport();
  expect(await anchor.locator('.distinct-address-detail').evaluate(node => node.clientWidth >= node.scrollWidth)).toBe(true);
  expect(await ui.locator('.palette').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('distinct-addresses.png') });
  await input.press('ArrowDown');
  await expect(anchor).toHaveAttribute('aria-selected', 'true');
  await input.press('Enter');
  await expect.poll(() => palette.executions()).toEqual([expect.objectContaining({ action: 'openHistoryPage', url: root + '#quick-shortcuts' })]);
});
