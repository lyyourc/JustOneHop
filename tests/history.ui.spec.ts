import { test, expect, fixtureOrigin, snapshotTab } from './support/paletteUI';

test.use({ viewport: { width: 1100, height: 760 }, reducedMotion: 'reduce' });

test('History search: 100ms deadline freezes pending rows and rejects late or superseded replies', async ({ palette }) => {
  const { ui } = palette;
  const query = 'JustOneHopHistoryRace';
  await palette.open({ locale: 'en-US', history: 'controlled', snapshot: {
    bookmarks: [{ id: 'local', title: `${query} local`, url: `${fixtureOrigin}/${query}-local`, folder: '' }],
  } });
  await expect(ui.locator('.result.command')).toHaveCount(9);
  const clockStart = Date.now();
  await ui.clock.install({ time: clockStart });
  await ui.clock.pauseAt(clockStart + 60_000);
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
  const requests = () => palette.historyRequests.map(request => request.query);
  const release = (query: string) => {
    const request = palette.historyRequests.find(request => request.query === query);
    if (!request) throw new Error(`No pending history request: ${query}`);
    request.release();
  };
  const delivered = (text: string) => expect.poll(() => ui.evaluate(() => (globalThis as unknown as { __historyReplies: string[] }).__historyReplies)).toContain(text);
  const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  const rows = ui.locator('#justonehop-results');
  const homeRows = await rows.locator('.result').evaluateAll(nodes => nodes.map(node => node.id));
  await search.fill(query);
  await expect.poll(requests).toContain(query);
  await expect(rows).toHaveAttribute('aria-busy', 'true');
  expect(await rows.locator('.result').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(homeRows);
  await expect(ui.locator('.primary-action')).toBeDisabled();
  await search.press('Enter');
  expect(await palette.executions()).toEqual([]);
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

test('History intent: bilingual commands enter an empty all-time search and restore root context', async ({ palette }) => {
  const { ui } = palette;
  await palette.open({ locale: 'en-US' });
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
    if (query === 'history') await ui.locator('.palette').screenshot({ path: test.info().outputPath('history-empty.png') });
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
