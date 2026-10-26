import { test, expect, snapshotTab } from './support/paletteUI';

test('continue search hint preserves home until accepted', async ({ palette }) => {
  const at = Date.now();
  palette.store.searchUsage = [
    { query: 'google', target: 'tab:https://google.com/', weight: 50, lastUsed: at },
    { query: 'notion', target: 'tab:https://notion.so/', weight: 1, lastUsed: at },
  ];
  await palette.open({ locale: 'en-US', snapshot: {
    searchContinuation: { query: 'github issues', target: 'tab:https://github.com/issues', at },
    tabs: [snapshotTab(2, 'github-issues'), snapshotTab(3, 'github-issues-guide')],
  } });
  const { ui } = palette;
  const input = ui.locator('.search-bar input');
  const hint = ui.locator('.query-completion');
  const homeIds = await ui.locator('.result').evaluateAll(nodes => nodes.map(node => node.id));
  await expect(input).toHaveValue('');
  await expect(input).toHaveAttribute('placeholder', '');
  await expect(hint).toHaveText('github issues');
  await expect(ui.getByRole('button', { name: 'Continue Search', exact: true })).toBeVisible();
  await input.press('Shift+Tab'); await expect(input).toHaveValue('');
  await ui.getByRole('button', { name: 'Continue Search', exact: true }).click();
  await expect(input).toHaveValue('github issues'); await expect(input).toBeFocused();
  await input.fill(''); await expect(hint).toHaveCount(0); // Deletion suppression still applies.
  expect(await ui.locator('.result').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(homeIds);
  await input.fill('g'); await expect(hint).toHaveText('github issues');
  await input.press('Tab'); await expect(input).toHaveValue('github issues');
  await input.fill(''); await input.fill('n'); await expect(hint).toHaveText('notion');
  expect(await palette.executions()).toEqual([]);
});

test('continue search hint expires while the palette remains open and Enter still executes home', async ({ palette }) => {
  const at = Date.now();
  await palette.ui.clock.install({ time: at });
  await palette.open({ locale: 'en-US', snapshot: { searchContinuation: { query: 'github', target: 'tab:https://github.com/', at } } });
  const input = palette.ui.locator('.search-bar input');
  await expect(palette.ui.locator('.query-completion')).toHaveText('github');
  const rows = palette.ui.locator('.result');
  const ids = await rows.evaluateAll(nodes => nodes.map(node => node.id));
  for (let step = 0; step < ids.length; step++) {
    if (await palette.ui.locator('[id="justonehop-command:settings"]').getAttribute('aria-selected') === 'true') break;
    await input.press('ArrowDown');
  }
  await input.press('Enter');
  await expect(palette.ui.locator('.settings-view')).toBeVisible();
  expect(await palette.executions()).toEqual([expect.objectContaining({ action: 'settings', query: '', continueSearch: false })]);
  await palette.ui.keyboard.press('Escape');
  await expect(palette.ui.locator('.query-completion')).toHaveText('github');
  await palette.ui.clock.fastForward(10 * 60 * 1000);
  await expect(palette.ui.locator('.query-completion')).toHaveCount(0);
  await expect(input).toHaveValue('');
});
