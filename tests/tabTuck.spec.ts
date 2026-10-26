import { test, expect, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { browserPath } from './support/browserPath';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let server: Server;
let origin: string;
let context: BrowserContext;
let worker: Worker;
let ui: Page;
let profile: string;
let popupUrl: string;
let windowId: number;
let browserStarted = false;

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const title = new URL(request.url!, 'http://localhost').pathname.slice(1).replaceAll('-', ' ');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><title>${title}</title><h1>${title}</h1><input aria-label="Unsaved note"><script>window.fixtureIdentity = crypto.randomUUID();</script>`);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { server.close(); });

test.beforeEach(async ({}, testInfo) => {
  const started = performance.now();
  browserStarted = false;
  profile = '';
  profile = await mkdtemp(join(tmpdir(), 'justonehop-tuck-e2e-'));
  const extension = join(profile, 'extension');
  await cp(resolve('dist'), extension, { recursive: true });
  // Advance only this disposable worker's clock and dispatch the real registered
  // alarm callback. No test RPC or clock controls are shipped in the extension.
  const background = join(extension, 'background.js');
  const hook = `
    globalThis.__tuckClockOffset = 0;
    globalThis.__tuckAlarms = [];
    globalThis.__tuckFocusListeners = [];
    const addFocus = chrome.windows.onFocusChanged.addListener.bind(chrome.windows.onFocusChanged);
    chrome.windows.onFocusChanged.addListener = callback => { globalThis.__tuckFocusListeners.push(callback); addFocus(callback); };
    const realNow = Date.now.bind(Date);
    Date.now = () => realNow() + globalThis.__tuckClockOffset;
    const addAlarm = chrome.alarms.onAlarm.addListener.bind(chrome.alarms.onAlarm);
    chrome.alarms.onAlarm.addListener = callback => { globalThis.__tuckAlarms.push(callback); addAlarm(callback); };
    chrome.idle.queryState = async () => 'idle';
  `;
  await writeFile(background, hook + await readFile(background, 'utf8'));
  const executablePath = await browserPath();
  const prepared = performance.now();
  context = await chromium.launchPersistentContext(join(profile, 'browser'), {
    executablePath, headless: true, locale: 'en-US', reducedMotion: 'reduce',
    ignoreDefaultArgs: process.platform === 'darwin' ? ['about:blank'] : [],
    viewport: { width: 1100, height: 760 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const launched = performance.now();
  browserStarted = true;
  worker = context.serviceWorkers().find(item => item.url().endsWith('/background.js'))
    || await context.waitForEvent('serviceworker', item => item.url().endsWith('/background.js'));
  const ready = performance.now();
  await worker.evaluate(() => chrome.storage.local.set({ preferences: { language: 'en', theme: 'light', autoTuck: false } }));
  popupUrl = worker.url().replace('background.js', 'popup.html');
  ui = await context.newPage();
  await ui.goto(popupUrl);
  const session = await context.newCDPSession(ui);
  testInfo.annotations.push({ type: 'browser-version', description: (await session.send('Browser.getVersion')).product },
    { type: 'browser-environment', description: JSON.stringify({ locale: 'en-US', shadow: 'closed', headed: false }) });
  await session.detach();
  await expect(ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' })).toBeVisible();
  windowId = await ui.evaluate(async () => (await chrome.tabs.getCurrent())!.windowId);
  for (const page of context.pages()) if (page !== ui) await page.close();
  testInfo.annotations.push({ type: 'fixture-timing', description: JSON.stringify({
    prepareMs: Math.round(prepared - started), launchMs: Math.round(launched - prepared),
    workerMs: Math.round(ready - launched), uiMs: Math.round(performance.now() - ready),
  }) });
});
test.afterEach(async ({}, testInfo) => {
  const started = performance.now();
  try { if (browserStarted) await context.close(); }
  finally {
    if (profile) await rm(profile, { recursive: true, force: true });
    testInfo.annotations.push({ type: 'fixture-cleanup-ms', description: String(Math.round(performance.now() - started)) });
  }
});

async function seed(...names: string[]) {
  const result = await worker.evaluate(async ({ origin, windowId, names }) => {
    const tabs = [];
    for (const name of names) tabs.push(await chrome.tabs.create({ windowId, url: `${origin}/${name}`, active: false }));
    return tabs.map((tab, index) => ({ id: tab.id!, url: `${origin}/${names[index]}` }));
  }, { origin, windowId, names });
  await expect.poll(() => worker.evaluate(async expected => (await Promise.all(expected.map(async item => {
    const tab = await chrome.tabs.get(item.id);
    return tab.status === 'complete' && tab.url === item.url;
  }))).every(Boolean), result)).toBe(true);
  return result.map(tab => tab.id);
}
async function execute(action: 'tuck' | 'undoTuck', tabId?: number) {
  const reply = await ui.evaluate(payload => chrome.runtime.sendMessage({ source: 'justonehop', type: 'execute', payload }), { action, windowId, tabId });
  expect(reply, `${action} should succeed`).toMatchObject({ ok: true });
}
const groupId = (tabId: number) => worker.evaluate(async id => (await chrome.tabs.get(id)).groupId, tabId);
const liveTabs = () => worker.evaluate(id => chrome.tabs.query({ windowId: id }), windowId);
async function reopen() {
  ui = await context.newPage(); await ui.goto(popupUrl);
  await expect(ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' })).toBeVisible();
}
async function enableAutomaticTucking() {
  await worker.evaluate(async () => {
    const { preferences } = await chrome.storage.local.get('preferences');
    await chrome.storage.local.set({ preferences: { ...(preferences as Record<string, unknown>), autoTuck: true } });
  });
  await expect.poll(() => worker.evaluate(async () => (await chrome.alarms.get('justonehop-auto-tuck'))?.periodInMinutes)).toBe(5);
  await expect.poll(() => worker.evaluate(async () => ((await chrome.storage.session.get('justonehopTabTuckSession')).justonehopTabTuckSession as { enabled?: boolean } | undefined)?.enabled === true)).toBe(true);
}
async function runIdleScan() {
  await worker.evaluate(async () => {
    const harness = globalThis as unknown as { __tuckClockOffset: number; __tuckAlarms: ((alarm: chrome.alarms.Alarm) => unknown)[] };
    harness.__tuckClockOffset = 8 * 24 * 60 * 60 * 1000;
    const alarms = await chrome.alarms.getAll();
    for (const alarm of alarms) await Promise.all(harness.__tuckAlarms.map(listener => listener(alarm)));
  });
}

test('English tuck keeps the original pages and their state, then search brings back only the chosen tab', async () => {
  const [alpha, beta] = await seed('Tuck-Alpha', 'Tuck-Beta');
  await expect.poll(() => context.pages().some(page => page.url() === `${origin}/Tuck-Alpha`)).toBe(true);
  const alphaPage = context.pages().find(page => page.url() === `${origin}/Tuck-Alpha`)!;
  const identity = await alphaPage.evaluate(() => {
    (document.querySelector('input') as HTMLInputElement).value = 'Keep this unsaved note';
    return (window as unknown as { fixtureIdentity: string }).fixtureIdentity;
  });
  const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await search.fill('Tuck Alpha');
  // History can arrive before the live tab snapshot; only the tab has tuck actions.
  const target = ui.locator(`[id="justonehop-tab:${alpha}"]`);
  await expect(target).toBeVisible();
  await expect(ui.locator('#justonehop-results')).toHaveAttribute('aria-busy', 'false');
  await search.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  await expect(target).toHaveAttribute('aria-selected', 'true');
  await search.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  const actionSearch = ui.getByRole('combobox', { name: 'Search actions' });
  await actionSearch.fill('tuck');
  await ui.getByRole('dialog').getByRole('option').filter({ hasText: 'Tuck Away Tab' }).click();
  await expect.poll(() => groupId(alpha)).not.toBe(-1);
  if (ui.isClosed()) await reopen();
  await execute('tuck', beta);
  const tuckedGroup = await groupId(alpha);
  expect(await groupId(beta)).toBe(tuckedGroup);
  expect((await liveTabs()).filter(tab => tab.url?.startsWith(origin)).map(tab => tab.id).sort()).toEqual([alpha, beta].sort());
  expect(await worker.evaluate(id => chrome.tabGroups.get(id), tuckedGroup)).toMatchObject({ collapsed: true });
  expect(await alphaPage.locator('input').inputValue()).toBe('Keep this unsaved note');
  expect(await alphaPage.evaluate(() => (window as unknown as { fixtureIdentity: string }).fixtureIdentity)).toBe(identity);
  await ui.reload();
  const input = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await input.fill('Tuck Alpha');
  const row = ui.getByRole('option').filter({ hasText: 'Tuck Alpha' }).first();
  await expect(row).toContainText('Tuck Away');
  expect((await recoverySnapshot()).tabs.find((tab: { id: number }) => tab.id === alpha).tucked).toBe(true);
  await row.click();
  await expect.poll(() => groupId(alpha)).toBe(-1);
  expect(await groupId(beta)).toBe(tuckedGroup);
  await expect.poll(() => worker.evaluate(id => chrome.tabGroups.get(id).then(group => group.collapsed), tuckedGroup)).toBe(true);
  expect(await alphaPage.locator('input').inputValue()).toBe('Keep this unsaved note');
});

test('English tuck preview navigation and Escape do not move a tucked tab', { tag: '@windows' }, async () => {
  const [alpha, beta] = await seed('Preview-Alpha', 'Preview-Beta');
  await execute('tuck', alpha); await execute('tuck', beta);
  const tuckedGroup = await groupId(alpha);
  const source = await ui.evaluate(async () => {
    const tab = (await chrome.tabs.getCurrent())!;
    await chrome.tabs.update(tab.id!, { active: true });
    return tab.id!;
  });
  const created = context.waitForEvent('page', page => page.url().includes('switcher.html'));
  await worker.evaluate(({ source, windowId }) => chrome.windows.create({
    url: `switcher.html?tab=${source}&window=${windowId}&direction=1`, type: 'popup', focused: true, width: 500, height: 500,
  }), { source, windowId });
  const popup = await created;
  await expect(popup.getByRole('option').first()).toBeVisible();
  const order = await popup.getByRole('option').evaluateAll(rows => rows.map(row => row.id));
  await popup.keyboard.down('Control');
  for (let step = 0; step < order.length; step++) {
    await popup.keyboard.press('n');
    expect(await groupId(alpha)).toBe(tuckedGroup);
    expect(await groupId(beta)).toBe(tuckedGroup);
    expect(await worker.evaluate(id => chrome.tabs.get(id).then(tab => tab.active), source)).toBe(true);
  }
  await popup.keyboard.down('Escape');
  await expect.poll(() => popup.isClosed()).toBe(true);
  expect(await groupId(alpha)).toBe(tuckedGroup);
  expect(await groupId(beta)).toBe(tuckedGroup);
});

test('English automatic tuck makes one reversible batch and undo respects closed and manually regrouped pages', async () => {
  const [closed, regrouped, restored, retained] = await seed('Idle-Closed', 'Idle-Regrouped', 'Idle-Restored', 'Idle-Retained');
  await enableAutomaticTucking();
  await worker.evaluate(() => {
    const original = chrome.tabs.group.bind(chrome.tabs);
    const created: chrome.tabGroups.TabGroup[] = [];
    (globalThis as unknown as { __createdTuckGroups: chrome.tabGroups.TabGroup[] }).__createdTuckGroups = created;
    chrome.tabs.group = (async (options: chrome.tabs.GroupOptions) => {
      const id = await original(options);
      if (options.groupId === undefined) created.push(await chrome.tabGroups.get(id));
      return id;
    }) as typeof chrome.tabs.group;
    (globalThis as unknown as { __tuckClockOffset: number }).__tuckClockOffset = 8 * 24 * 60 * 60 * 1000;
  });
  const fresh = await seed('Fresh-Left', 'Fresh-Right');
  const ordinary = (await liveTabs()).sort((a, b) => a.index - b.index).filter(tab => ![closed, regrouped, restored, retained].includes(tab.id!)).map(tab => tab.id);
  await runIdleScan();
  await expect.poll(() => groupId(restored)).not.toBe(-1);
  const tuckedGroup = await groupId(restored);
  await expect.poll(() => worker.evaluate(id => chrome.tabGroups.get(id), tuckedGroup)).toMatchObject({ title: 'Tuck Away', color: 'grey', collapsed: true });
  expect(await worker.evaluate(() => chrome.tabGroups.query({}))).toHaveLength(1);
  await test.info().attach('new-native-group.json', { contentType: 'application/json', body: JSON.stringify(await worker.evaluate(() =>
    (globalThis as unknown as { __createdTuckGroups: chrome.tabGroups.TabGroup[] }).__createdTuckGroups)) });
  for (const id of [closed, regrouped, retained]) expect(await groupId(id)).toBe(tuckedGroup);
  const tuckedStrip = (await liveTabs()).sort((a, b) => a.index - b.index);
  expect(tuckedStrip.slice(-4).map(tab => tab.id)).toEqual([closed, regrouped, restored, retained]);
  expect(tuckedStrip.filter(tab => ordinary.includes(tab.id)).map(tab => tab.id)).toEqual(ordinary);
  for (const id of fresh) expect(await groupId(id)).toBe(-1);
  await worker.evaluate(id => chrome.tabs.remove(id), closed);
  const manualGroup = await worker.evaluate(async id => {
    const group = await chrome.tabs.group({ tabIds: [id] });
    await chrome.tabGroups.update(group, { title: 'My own group', color: 'green' });
    return group;
  }, regrouped);
  await execute('undoTuck');
  await expect.poll(() => groupId(restored)).toBe(-1);
  expect(await groupId(retained)).toBe(-1);
  expect(await groupId(regrouped)).toBe(manualGroup);
  const restoredStrip = (await liveTabs()).sort((a, b) => a.index - b.index);
  expect(restoredStrip.filter(tab => [restored, retained].includes(tab.id!)).map(tab => tab.id)).toEqual([restored, retained]);
  expect(restoredStrip.filter(tab => ordinary.includes(tab.id)).map(tab => tab.id)).toEqual(ordinary);
  expect(restoredStrip.some(tab => tab.id === closed)).toBe(false);
  // Undo gives restored tabs a fresh grace period; the next scan cannot immediately tuck them again.
  await runIdleScan();
  expect(await groupId(restored)).toBe(-1);
  expect(await groupId(retained)).toBe(-1);
});

test('second automatic tuck reuses each window original group and ignores a same-name user group', { tag: '@windows' }, async () => {
  const firstWindow = windowId;
  const secondWindow = await worker.evaluate(async () => (await chrome.windows.create({ url: 'about:blank', focused: false }))!.id!);
  const [firstA, userTab] = await seed('First-A', 'User-Owned');
  windowId = secondWindow;
  const [firstB] = await seed('First-B');
  windowId = firstWindow;
  const userGroup = await worker.evaluate(async id => {
    const group = await chrome.tabs.group({ tabIds: [id] });
    await chrome.tabGroups.update(group, { title: 'Tuck Away', color: 'grey' });
    return group;
  }, userTab);
  await enableAutomaticTucking();
  await runIdleScan();
  await expect.poll(() => groupId(firstA)).not.toBe(-1);
  await expect.poll(() => groupId(firstB)).not.toBe(-1);
  const groupA = await groupId(firstA);
  const groupB = await groupId(firstB);
  expect(new Set([groupA, groupB, userGroup]).size).toBe(3);
  const status = () => ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'tuck-status' }));
  await status(); // Wait for the whole scan before creating the next cohort.

  const [secondA] = await seed('Second-A');
  windowId = secondWindow;
  const [secondB] = await seed('Second-B');
  windowId = firstWindow;
  await status(); // Drain creation events so their initial clocks are recorded.
  expect(await groupId(secondA)).toBe(-1);
  expect(await groupId(secondB)).toBe(-1);
  await worker.evaluate(async () => {
    const harness = globalThis as unknown as { __tuckClockOffset: number; __tuckAlarms: ((alarm: chrome.alarms.Alarm) => unknown)[] };
    harness.__tuckClockOffset += 8 * 24 * 60 * 60 * 1000;
    const alarm = (await chrome.alarms.get('justonehop-auto-tuck'))!;
    for (const listener of harness.__tuckAlarms) listener(alarm);
  });
  await status();
  expect(await groupId(secondA)).toBe(groupA);
  expect(await groupId(secondB)).toBe(groupB);
  expect(await groupId(firstA)).toBe(groupA);
  expect(await groupId(firstB)).toBe(groupB);
  expect(await groupId(userTab)).toBe(userGroup);
  expect(await worker.evaluate(() => chrome.tabGroups.query({}))).toHaveLength(3);
  for (const [id, ownerWindow] of [[groupA, firstWindow], [groupB, secondWindow]]) {
    expect(await worker.evaluate(id => chrome.tabGroups.get(id), id)).toMatchObject({
      windowId: ownerWindow, title: 'Tuck Away', color: 'grey', collapsed: true,
    });
  }
  await execute('undoTuck');
  expect(await groupId(secondA)).toBe(-1);
  expect(await groupId(firstA)).toBe(groupA);
  expect(await groupId(secondB)).toBe(groupB);
  windowId = secondWindow;
  await execute('undoTuck');
  windowId = firstWindow;
  expect(await groupId(secondB)).toBe(-1);
  expect(await groupId(firstB)).toBe(groupB);
  expect(await groupId(userTab)).toBe(userGroup);
});

test('second automatic tuck respects ownership after rename, foreign member, and worker restart', async () => {
  const status = () => ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'tuck-status' }));
  for (const change of ['rename', 'foreign member', 'worker restart'] as const) await test.step(change, async () => {
    const [first] = await seed('Original-Batch');
    await enableAutomaticTucking();
    await runIdleScan();
    await expect.poll(() => groupId(first)).not.toBe(-1);
    const originalGroup = await groupId(first);
    await status();
    let foreign: number | undefined;
    if (change === 'rename') {
      await worker.evaluate(id => chrome.tabGroups.update(id, { title: 'My reading', color: 'blue' }), originalGroup);
    } else if (change === 'foreign member') {
      [foreign] = await seed('User-Added');
      await worker.evaluate(({ id, groupId }) => chrome.tabs.group({ tabIds: [id], groupId }), { id: foreign, groupId: originalGroup });
    } else {
      await restartTuckWorker();
      await worker.evaluate(() => { (globalThis as unknown as { __tuckClockOffset: number }).__tuckClockOffset = 8 * 24 * 60 * 60 * 1000; });
    }
    await status();
    const [second] = await seed('Next-Batch');
    await status();
    await worker.evaluate(async () => {
      const harness = globalThis as unknown as { __tuckClockOffset: number; __tuckAlarms: ((alarm: chrome.alarms.Alarm) => unknown)[] };
      harness.__tuckClockOffset += 8 * 24 * 60 * 60 * 1000;
      const alarm = (await chrome.alarms.get('justonehop-auto-tuck'))!;
      for (const listener of harness.__tuckAlarms) listener(alarm);
    });
    await status();
    const nextGroup = await groupId(second);
    expect(nextGroup).not.toBe(-1);
    expect(await groupId(first)).toBe(originalGroup);
    if (change === 'worker restart') {
      expect(nextGroup).toBe(originalGroup);
      expect(await worker.evaluate(() => chrome.tabGroups.query({}))).toHaveLength(1);
    } else {
      expect(nextGroup).not.toBe(originalGroup);
      expect(await worker.evaluate(() => chrome.tabGroups.query({}))).toHaveLength(2);
      if (change === 'rename') expect(await worker.evaluate(id => chrome.tabGroups.get(id), originalGroup)).toMatchObject({ title: 'My reading', color: 'blue' });
      if (foreign !== undefined) expect(await groupId(foreign)).toBe(originalGroup);
    }
    await execute('undoTuck');
    expect(await groupId(second)).toBe(-1);
    expect(await groupId(first)).toBe(originalGroup);
    if (foreign !== undefined) expect(await groupId(foreign)).toBe(originalGroup);
    await worker.evaluate(async ids => {
      await chrome.tabs.remove(ids);
      const { preferences } = await chrome.storage.local.get('preferences');
      await chrome.storage.local.set({ preferences: { ...(preferences as Record<string, unknown>), autoTuck: false } });
      (globalThis as unknown as { __tuckClockOffset: number }).__tuckClockOffset = 0;
    }, [first, second, ...(foreign !== undefined ? [foreign] : [])]);
    await status();
  });
});

test('automatic batches preserve original interleaved order across worker restart and respect manual reorder and group edits', async () => {
  await test.step('interleaved order across worker restart', async () => {
    const [b, d] = await seed('Order-B', 'Order-D');
    await enableAutomaticTucking();
    await worker.evaluate(() => { (globalThis as unknown as { __tuckClockOffset: number }).__tuckClockOffset = 8 * 24 * 60 * 60 * 1000; });
    const [a, c] = await seed('Order-A', 'Order-C');
    await worker.evaluate(async ({ a, b, c, d }) => {
      await chrome.tabs.move(a, { index: (await chrome.tabs.get(b)).index });
      await chrome.tabs.move(c, { index: (await chrome.tabs.get(d)).index });
    }, { a, b, c, d });
    await runIdleScan();
    await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'tuck-status' }));
    const owned = await groupId(b);
    expect(owned).not.toBe(-1);
    const members = () => worker.evaluate(async id => (await chrome.tabs.query({ groupId: id })).sort((a, b) => a.index - b.index).map(tab => tab.id), owned);
    expect(await members()).toEqual([b, d]);
    await restartTuckWorker();
    await worker.evaluate(async () => {
      const harness = globalThis as unknown as { __tuckClockOffset: number; __tuckAlarms: ((alarm: chrome.alarms.Alarm) => unknown)[] };
      harness.__tuckClockOffset = 16 * 24 * 60 * 60 * 1000;
      const alarm = (await chrome.alarms.get('justonehop-auto-tuck'))!;
      for (const listener of harness.__tuckAlarms) listener(alarm);
    });
    await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'tuck-status' }));
    expect(await members()).toEqual([a, b, c, d]);
    await execute('undoTuck');
    expect(await members()).toEqual([b, d]);
    expect(await groupId(a)).toBe(-1);
    expect(await groupId(c)).toBe(-1);
    await worker.evaluate(async ids => {
      await chrome.tabs.remove(ids);
      const { preferences } = await chrome.storage.local.get('preferences');
      await chrome.storage.local.set({ preferences: { ...(preferences as Record<string, unknown>), autoTuck: false } });
      (globalThis as unknown as { __tuckClockOffset: number }).__tuckClockOffset = 0;
    }, [a, b, c, d]);
    await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'tuck-status' }));
  });

  await test.step('manual reorder of existing tucked members', async () => {
    const [a, b, c] = await seed('Manual-Order-A', 'Manual-Order-B', 'Manual-Order-C');
    await enableAutomaticTucking();
    await worker.evaluate(id => chrome.tabs.update(id, { pinned: true }), b);
    await runIdleScan();
    await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'tuck-status' }));
    const owned = await groupId(a);
    await worker.evaluate(async ({ a, c }) => chrome.tabs.move(c, { index: (await chrome.tabs.get(a)).index }), { a, c });
    await worker.evaluate(id => chrome.tabs.update(id, { pinned: false }), b);
    await runIdleScan();
    await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'tuck-status' }));
    expect(await worker.evaluate(async id => (await chrome.tabs.query({ groupId: id })).sort((a, b) => a.index - b.index).map(tab => tab.id), owned)).toEqual([b, c, a]);
    await worker.evaluate(async ids => {
      await chrome.tabs.remove(ids);
      const { preferences } = await chrome.storage.local.get('preferences');
      await chrome.storage.local.set({ preferences: { ...(preferences as Record<string, unknown>), autoTuck: false } });
      (globalThis as unknown as { __tuckClockOffset: number }).__tuckClockOffset = 0;
    }, [a, b, c]);
    await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'tuck-status' }));
  });

  await test.step('justonehop group edits preserve tuck ownership and persist custom title and color', async () => {
    const [a, b, c] = await seed('Managed-A', 'Managed-B', 'Managed-C');
    await execute('tuck', a); await execute('tuck', b);
    const id = await groupId(a);
    const reply = await ui.evaluate(payload => chrome.runtime.sendMessage({ source: 'justonehop', type: 'execute', payload }),
      { action: 'updateGroup', windowId, groupId: id, groupChanges: { title: 'Later', color: 'purple' } });
    expect(reply).toMatchObject({ ok: true });
    await execute('tuck', c);
    expect(await groupId(c)).toBe(id);
    expect(await worker.evaluate(id => chrome.tabGroups.get(id), id)).toMatchObject({ title: 'Later', color: 'purple' });
    const snapshot = await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'snapshot' }));
    expect(snapshot.data.tabs.filter((tab: { tucked: boolean }) => tab.tucked)).toHaveLength(3);
    await worker.evaluate(id => chrome.tabs.update(id, { active: true }), a);
    await expect.poll(() => groupId(a)).toBe(-1);
    expect(await worker.evaluate(id => chrome.tabGroups.get(id), id)).toMatchObject({ title: 'Later', color: 'purple' });
    const records = await worker.evaluate(() => chrome.storage.local.get('justonehopTabTuckRecovery'));
    expect(JSON.stringify(records)).toContain('Later');
    expect(JSON.stringify(records)).toContain('purple');
    await worker.evaluate(ids => chrome.tabs.remove(ids), [a, b, c]);
  });
});

test('unfocused Chrome tucks on a native alarm after thirty minutes and leaving a long-running active page gives a fresh grace period', async () => {
  await test.step('long-running active page gets a fresh grace period when the user leaves it', async () => {
    const [previous, next, idle] = await seed('Long-Active', 'New-Active', 'Old-Idle');
    await worker.evaluate(id => chrome.tabs.update(id, { active: true }), previous);
    await enableAutomaticTucking();
    await worker.evaluate(async next => {
      (globalThis as unknown as { __tuckClockOffset: number }).__tuckClockOffset = 8 * 24 * 60 * 60 * 1000;
      await chrome.tabs.update(next, { active: true });
    }, next);
    await expect.poll(() => worker.evaluate(async ({ windowId, next }) => {
      const stored = (await chrome.storage.session.get('justonehopTabTuckSession')).justonehopTabTuckSession as { active?: Record<number, number> };
      return stored.active?.[windowId] === next;
    }, { windowId, next })).toBe(true);
    await runIdleScan();
    await expect.poll(() => groupId(idle)).not.toBe(-1);
    expect(await groupId(previous)).toBe(-1);
    expect(await groupId(next)).toBe(-1);
    await ui.bringToFront();
    await worker.evaluate(async ids => {
      await chrome.tabs.remove(ids);
      const { preferences } = await chrome.storage.local.get('preferences');
      await chrome.storage.local.set({ preferences: { ...(preferences as Record<string, unknown>), autoTuck: false } });
      (globalThis as unknown as { __tuckClockOffset: number }).__tuckClockOffset = 0;
    }, [previous, next, idle]);
    await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'tuck-status' }));
  });

  await test.step('unfocused Chrome tucks on a native alarm after thirty minutes and preserves undo', async () => {
    const [old] = await seed('Unfocused-Idle');
    await enableAutomaticTucking();
    await worker.evaluate(() => {
      const harness = globalThis as unknown as { __tuckClockOffset: number; __tuckFocusListeners: ((id: number) => void)[] };
      harness.__tuckClockOffset = 8 * 24 * 60 * 60 * 1000;
      chrome.idle.queryState = async () => 'active' as const;
      const getAll = chrome.windows.getAll.bind(chrome.windows);
      chrome.windows.getAll = (async () => (await getAll({})).map(window => ({ ...window, focused: false }))) as typeof chrome.windows.getAll;
      for (const listener of harness.__tuckFocusListeners) listener(chrome.windows.WINDOW_ID_NONE);
    });
    const status = () => ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'tuck-status' }));
    await expect.poll(async () => (await status()).data.waitingReason).toBe('grace');
    expect(await groupId(old)).toBe(-1);
    await worker.evaluate(async () => {
      const harness = globalThis as unknown as { __tuckClockOffset: number };
      harness.__tuckClockOffset += 30 * 60 * 1000;
      await chrome.alarms.create('justonehop-auto-tuck', { when: Date.now() - harness.__tuckClockOffset + 100, periodInMinutes: 5 });
    });
    await expect.poll(() => groupId(old)).not.toBe(-1);
    await expect.poll(async () => chromeGroup(await groupId(old))).toMatchObject({ title: 'Tuck Away', collapsed: true });
    await execute('undoTuck');
    expect(await groupId(old)).toBe(-1);
    async function chromeGroup(id: number) { return worker.evaluate(id => chrome.tabGroups.get(id), id); }
  });
});

test('English auto tuck duration saves on selection, a native alarm applies it, and disabling releases only owned tabs', async () => {
  await test.step('duration selection and native alarm execution', async () => {
    const [old] = await seed('Configurable-Idle');
    await enableAutomaticTucking();
    expect(await worker.evaluate(() => chrome.alarms.get('justonehop-auto-tuck'))).toMatchObject({ periodInMinutes: 5 });
    await worker.evaluate(() => {
      (globalThis as unknown as { __tuckClockOffset: number }).__tuckClockOffset = 2 * 60 * 60 * 1000;
      chrome.idle.queryState = async () => 'active' as const;
    });
    const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await search.fill('auto tuck'); await search.press('Enter');
    const duration = ui.getByRole('combobox', { name: 'Tuck after inactivity' });
    const before = await worker.evaluate(async () => (await chrome.storage.local.get('justonehopTabTuckClocks')).justonehopTabTuckClocks as { clocks: Record<string, number> });
    await duration.click();
    await ui.getByRole('option', { name: '1 hour', exact: true }).click();
    await ui.locator('.settings-search .search-focus.is-back').click();
    await search.fill('auto tuck'); await search.press('Enter');
    await expect(duration).toHaveText('1 hour');
    await expect(ui.getByRole('button', { name: 'Save duration', exact: true })).toHaveCount(0);
    await expect.poll(() => worker.evaluate(async () => ((await chrome.storage.local.get('preferences')).preferences as { autoTuckAfterHours: number }).autoTuckAfterHours)).toBe(1);
    await expect(ui.getByText('1 eligible tabs waiting for Chrome to lose focus or your computer to become idle', { exact: true })).toBeVisible();
    expect(await groupId(old)).toBe(-1);
    const after = await worker.evaluate(async () => (await chrome.storage.local.get('justonehopTabTuckClocks')).justonehopTabTuckClocks as { clocks: Record<string, number> });
    expect(after.clocks[`${origin}/Configurable-Idle`]).toBe(before.clocks[`${origin}/Configurable-Idle`]);
    await worker.evaluate(async () => {
      chrome.idle.queryState = async () => 'idle' as const;
      const offset = (globalThis as unknown as { __tuckClockOffset: number }).__tuckClockOffset;
      await chrome.alarms.create('justonehop-auto-tuck', { when: Date.now() - offset + 100, periodInMinutes: 5 });
    });
    await expect.poll(() => groupId(old)).not.toBe(-1);
    await ui.getByRole('button', { name: 'Refresh status' }).click();
    await expect(ui.getByText('No tabs currently qualify', { exact: true })).toBeVisible();
    await expect(ui.getByText('Last automatic check:', { exact: false })).toBeVisible();
    expect((await liveTabs()).some(tab => tab.id === old)).toBe(true);
    await worker.evaluate(id => chrome.tabs.remove(id), old);
  });

  await test.step('disabling automatic tuck releases its own tabs and keeps a same-name user group', async () => {
    const [alpha, beta, personal] = await seed('Settings-Alpha', 'Settings-Beta', 'Settings-Personal');
    await enableAutomaticTucking();
    await execute('tuck', alpha); await execute('tuck', beta);
    const owned = await groupId(alpha);
    const personalGroup = await worker.evaluate(async ({ personal, owned }) => {
      const metadata = await chrome.tabGroups.get(owned);
      const group = await chrome.tabs.group({ tabIds: [personal] });
      await chrome.tabGroups.update(group, { title: metadata.title, color: metadata.color, collapsed: true });
      return group;
    }, { personal, owned });
    await ui.reload();
    const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await search.fill('auto tuck'); await search.press('Enter');
    const setting = ui.getByRole('switch');
    await expect(setting).toBeChecked();
    await setting.click();
    await expect(setting).not.toBeChecked();
    await expect.poll(() => groupId(alpha)).toBe(-1);
    expect(await groupId(beta)).toBe(-1);
    expect(await groupId(personal)).toBe(personalGroup);
    expect(await worker.evaluate(async () => ((await chrome.storage.local.get('preferences')).preferences as { autoTuck: boolean }).autoTuck)).toBe(false);
    await expect.poll(() => worker.evaluate(async () => Object.keys(((await chrome.storage.local.get('justonehopTabTuckClocks')).justonehopTabTuckClocks as { clocks: Record<string, number> }).clocks).length)).toBe(0);
  });
});

test('partial disable failure preserves safe recovery across a worker restart', async () => {
  const [alpha, beta] = await seed('Partial-Alpha', 'Partial-Beta');
  await enableAutomaticTucking();
  await runIdleScan();
  await expect.poll(() => groupId(beta)).not.toBe(-1);
  const owned = await groupId(beta);
  await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'tuck-status' }));
  await worker.evaluate(beta => {
    const original = chrome.tabs.ungroup.bind(chrome.tabs);
    chrome.tabs.ungroup = (async (ids: number | [number, ...number[]]) => {
      if (ids === beta || Array.isArray(ids) && ids.includes(beta)) throw new Error('Temporary release failure');
      return original(ids);
    }) as typeof chrome.tabs.ungroup;
  }, beta);
  await worker.evaluate(async () => {
    const { preferences } = await chrome.storage.local.get('preferences');
    await chrome.storage.local.set({ preferences: { ...(preferences as Record<string, unknown>), autoTuck: false } });
  });
  await expect.poll(() => worker.evaluate(async () => (await chrome.alarms.get('justonehop-auto-tuck'))?.periodInMinutes)).toBe(0.5);
  expect(await groupId(alpha)).toBe(-1);
  expect(await groupId(beta)).toBe(owned);
  await expect.poll(() => worker.evaluate(async ({ windowId, beta }) => {
    const state = (await chrome.storage.session.get('justonehopTabTuckSession')).justonehopTabTuckSession as {
      groups: { members: number[] }[]; undo: Record<number, { ids: number[] }>;
    };
    return { members: state.groups.flatMap(group => group.members), undo: state.undo[windowId]?.ids };
  }, { windowId, beta })).toEqual({ members: [beta], undo: [beta] });
  await restartTuckWorker();
  await expect.poll(() => groupId(beta)).toBe(-1);
  expect(await groupId(alpha)).toBe(-1);
  expect((await recoverySnapshot()).canUndoTuck).toBe(false);
  expect(await worker.evaluate(() => chrome.alarms.get('justonehop-auto-tuck'))).toBeUndefined();
});

async function restartTuckWorker() {
  const monitor = await context.newPage();
  await monitor.goto('chrome://extensions');
  await monitor.getByRole('switch', { name: 'Developer mode', exact: true }).setChecked(true);
  await monitor.goto(origin);
  const client = await context.newCDPSession(monitor);
  const versions = new Map<string, { versionId: string; runningStatus: string; status: string }>();
  const workerUrl = worker.url();
  let stopped = false;
  client.on('ServiceWorker.workerVersionUpdated', event => {
    for (const version of event.versions) if (version.scriptURL === workerUrl) {
      versions.set(version.versionId, version);
      if (version.runningStatus === 'stopped') stopped = true;
    }
  });
  try {
    await client.send('ServiceWorker.enable');
    await expect.poll(() => [...versions.values()].some(version => version.status === 'activated' && version.runningStatus === 'running')).toBe(true);
    const version = [...versions.values()].find(version => version.status === 'activated' && version.runningStatus === 'running')!;
    await client.send('ServiceWorker.stopWorker', { versionId: version.versionId });
    await expect.poll(() => stopped).toBe(true);
    expect(await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'snapshot' }))).toMatchObject({ ok: true });
    await expect.poll(() => [...versions.values()].some(version => version.runningStatus === 'running')).toBe(true);
    worker = context.serviceWorkers().find(candidate => candidate.url() === workerUrl)!;
  } finally {
    await client.detach();
    await monitor.close();
  }
}

async function restartChrome() {
  await context.close();
  const extension = join(profile, 'extension');
  context = await chromium.launchPersistentContext(join(profile, 'browser'), {
    executablePath: await browserPath(), headless: true, locale: 'en-US', reducedMotion: 'reduce',
    ignoreDefaultArgs: process.platform === 'darwin' ? ['about:blank'] : [],
    viewport: { width: 1100, height: 760 },
    args: ['--restore-last-session', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  worker = context.serviceWorkers().find(item => item.url().endsWith('/background.js'))
    || await context.waitForEvent('serviceworker', item => item.url().endsWith('/background.js'));
  popupUrl = worker.url().replace('background.js', 'popup.html');
  ui = await context.newPage(); await ui.goto(popupUrl);
  await expect(ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' })).toBeVisible();
  windowId = await ui.evaluate(async () => (await chrome.tabs.getCurrent())!.windowId);
}
async function recoverySnapshot() {
  return ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'snapshot' }).then(reply => reply.data));
}

async function requireRecoveryConfirmation() {
  await worker.evaluate(async () => {
    const { justonehopTabTuckRecovery } = await chrome.storage.local.get('justonehopTabTuckRecovery');
    const saved = justonehopTabTuckRecovery as { records: { requiresConfirmation?: boolean }[] };
    saved.records.forEach(record => { record.requiresConfirmation = true; });
    await chrome.storage.local.set({ justonehopTabTuckRecovery: saved });
  });
}
async function prepareRestart({ requiresConfirmation = false } = {}) {
  const [alpha, beta] = await seed('Restart-Alpha', 'Restart-Beta');
  await execute('tuck', alpha); await execute('tuck', beta);
  await expect.poll(() => worker.evaluate(async () => ((await chrome.storage.local.get('justonehopTabTuckRecovery')).justonehopTabTuckRecovery as { records: unknown[] }).records.length)).toBe(1);
  if (requiresConfirmation) await requireRecoveryConfirmation();
  await restartChrome();
  await expect.poll(async () => (await recoverySnapshot()).tabs.filter((tab: { url?: string }) => tab.url?.startsWith(origin)).length).toBe(2);
}
async function openRecovery() {
  const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await search.fill('recover tucked tabs');
  await ui.getByRole('option').filter({ hasText: 'Review Tucked Away Groups' }).first().click();
  await expect(ui.locator('.tuck-recovery .palette-footer-title')).toHaveText('Review Tucked Away Groups');
}

test('English actual Chrome restart retains records and safely resumes a group with incomplete restored metadata', async () => {
  await prepareRestart();
  const snapshot = await recoverySnapshot();
  const alpha = snapshot.tabs.find((tab: { url: string }) => tab.url === `${origin}/Restart-Alpha`);
  const beta = snapshot.tabs.find((tab: { url: string }) => tab.url === `${origin}/Restart-Beta`);
  if (snapshot.tuckRecoveries.length) {
    expect(snapshot.tuckRecoveries[0].candidates).toHaveLength(1);
    expect(alpha.tucked).toBe(false);
    const [extra] = await seed('New-Ordinary');
    const blocked = await ui.evaluate(payload => chrome.runtime.sendMessage({ source: 'justonehop', type: 'execute', payload }),
      { action: 'tuck', windowId, tabId: extra });
    expect(blocked.ok).toBe(false);
    expect(await groupId(extra)).toBe(-1);
    await openRecovery();
    await expect(ui.getByRole('listbox')).toContainText(`${origin}/Restart-Alpha`);
    await ui.keyboard.press('Escape');
    await expect(ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' })).toHaveValue('recover tucked tabs');
    expect((await recoverySnapshot()).tuckRecoveries).toHaveLength(1);
    await openRecovery();
    await ui.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    await expect(ui.getByRole('dialog')).toBeVisible();
    await ui.keyboard.press('Escape');
    await expect(ui.locator('.tuck-recovery .palette-footer-title')).toHaveText('Review Tucked Away Groups');
    await ui.screenshot({ path: test.info().outputPath('justonehop-tuck-recovery.png') });
    await ui.evaluate(async () => {
      const { preferences } = await chrome.storage.local.get('preferences');
      await chrome.storage.local.set({ preferences: { ...(preferences as Record<string, unknown>), language: 'zh' } });
    });
    await expect(ui.getByRole('button', { name: /继续管理这组/ })).toBeVisible();
    await ui.screenshot({ path: test.info().outputPath('justonehop-tuck-recovery-zh.png') });
    await ui.keyboard.press('Control+n');
    await ui.keyboard.press('Control+p');
    await expect(ui.getByRole('listbox')).toBeFocused();
    await ui.getByRole('listbox').getByRole('option', { selected: true }).click();
    await ui.keyboard.press('Enter');
    await expect(ui.locator('.tuck-recovery')).toBeVisible();
    expect((await recoverySnapshot()).tuckRecoveries).toHaveLength(1);
    expect((await recoverySnapshot()).tabs.filter((tab: { tucked?: boolean }) => tab.tucked)).toHaveLength(0);
    await ui.keyboard.press('Shift+Tab');
    await expect(ui.locator('.tuck-recovery .task-back')).toBeFocused();
    await ui.keyboard.press('Tab');
    await ui.keyboard.press('Tab');
    await expect(ui.getByRole('button', { name: '继续管理这组', exact: true })).toBeFocused();
    await ui.keyboard.press('Enter');
  }
  await expect.poll(async () => (await recoverySnapshot()).tabs.filter((tab: { tucked?: boolean }) => tab.tucked).length).toBe(2);
  expect((await recoverySnapshot()).tuckRecoveries).toEqual([]);
  await worker.evaluate(id => chrome.tabs.update(id, { active: true }), alpha.id);
  await expect.poll(() => groupId(alpha.id)).toBe(-1);
  expect(await groupId(beta.id)).not.toBe(-1);
  await expect.poll(() => worker.evaluate(async id => (await chrome.tabGroups.get((await chrome.tabs.get(id)).groupId)).collapsed, beta.id)).toBe(true);
});

test('multiple same-name groups recover after real Chrome restart with metadata completion', { tag: '@windows' }, async () => {
  const firstWindow = windowId;
  const secondWindow = await worker.evaluate(async () => (await chrome.windows.create({ url: 'about:blank', focused: false }))!.id!);
  const [firstA] = await seed('Restart-Window-A');
  windowId = secondWindow;
  const [firstB] = await seed('Restart-Window-B');
  windowId = firstWindow;
  await enableAutomaticTucking();
  await runIdleScan();
  await expect.poll(() => groupId(firstA)).not.toBe(-1);
  await expect.poll(() => groupId(firstB)).not.toBe(-1);
  await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'tuck-status' }));
  await expect.poll(() => worker.evaluate(async () => ((await chrome.storage.local.get('justonehopTabTuckRecovery')).justonehopTabTuckRecovery as { records: unknown[] }).records.length)).toBe(2);
  await restartChrome();
  const restoredTabs = () => ui.evaluate(origin => chrome.tabs.query({}).then(tabs => tabs.filter(tab =>
    tab.url === `${origin}/Restart-Window-A` || tab.url === `${origin}/Restart-Window-B`)), origin);
  await expect.poll(async () => (await restoredTabs()).length).toBe(2);
  const restored = await restoredTabs();
  const a = restored.find(tab => tab.url!.endsWith('/Restart-Window-A'))!;
  const b = restored.find(tab => tab.url!.endsWith('/Restart-Window-B'))!;
  expect(a.windowId).not.toBe(b.windowId);
  expect(a.groupId).not.toBe(-1);
  expect(b.groupId).not.toBe(-1);
  expect(a.groupId).not.toBe(b.groupId);
  for (const tab of [a, b]) {
    await ui.evaluate(async id => {
      const group = await chrome.tabGroups.get(id);
      if (group.title !== 'Tuck Away' || group.color !== 'grey') {
        await chrome.tabGroups.update(id, { title: 'Tuck Away', color: 'grey' });
      }
    }, tab.groupId);
  }
  await expect.poll(async () => (await recoverySnapshot()).tuckRecoveries.length).toBe(0);
  const owned = await ui.evaluate(async () => ((await chrome.storage.session.get('justonehopTabTuckSession')).justonehopTabTuckSession as {
    groups: { id: number; windowId: number; members: number[] }[];
  }).groups);
  for (const tab of [a, b]) expect(owned.find(group => group.id === tab.groupId)).toMatchObject({
    windowId: tab.windowId, members: [tab.id],
  });
  expect(await ui.evaluate(() => chrome.tabGroups.query({}).then(groups => groups.length))).toBe(2);

  windowId = a.windowId;
  const [nextA] = await seed('After-Restart-A');
  windowId = b.windowId;
  const [nextB] = await seed('After-Restart-B');
  await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'tuck-status' }));
  await runIdleScan();
  await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'tuck-status' }));
  expect(await groupId(nextA)).toBe(a.groupId);
  expect(await groupId(nextB)).toBe(b.groupId);
  expect(await worker.evaluate(() => chrome.tabGroups.query({}))).toHaveLength(2);
  await execute('undoTuck');
  expect(await groupId(nextB)).toBe(-1);
  expect(await groupId(nextA)).toBe(a.groupId);
  windowId = a.windowId;
  await execute('undoTuck');
  expect(await groupId(nextA)).toBe(-1);
  expect(await groupId(a.id!)).toBe(a.groupId);
  expect(await groupId(b.id!)).toBe(b.groupId);
});

test('English recovery rejects stale confirmation and forgetting leaves native pages and groups untouched', async () => {
  await prepareRestart({ requiresConfirmation: true });
  await expect.poll(async () => (await recoverySnapshot()).tuckRecoveries[0]?.candidates.length).toBe(1);
  const snapshot = await recoverySnapshot();
  expect(snapshot.tuckRecoveries).toHaveLength(1);
  expect(snapshot.tabs.filter((tab: { tucked?: boolean }) => tab.tucked)).toHaveLength(0);
  const pending = snapshot.tuckRecoveries[0], candidate = pending.candidates[0];
  await ui.evaluate(id => chrome.tabGroups.update(id, { title: 'My changed group', color: 'blue' }), candidate.id);
  const stale = await ui.evaluate(payload => chrome.runtime.sendMessage({ source: 'justonehop', type: 'execute', payload }),
    { action: 'resumeTuck', windowId, recoveryId: pending.id, groupId: candidate.id, fingerprint: candidate.fingerprint });
  expect(stale.ok).toBe(false);
  expect(await ui.evaluate(id => chrome.tabGroups.get(id), candidate.id)).toMatchObject({ title: 'My changed group', color: 'blue' });
  const before = await liveTabs();
  await openRecovery();
  await expect(ui.locator('.tuck-recovery .settings-header')).toHaveCount(0);
  await expect(ui.locator('.tuck-recovery .task-back')).toHaveAccessibleName('Back');
  const selected = ui.locator('.recovery-candidate[aria-selected=true]');
  const selectedId = await selected.getAttribute('id');
  await selected.click({ button: 'right' });
  await expect(ui.getByRole('dialog')).toBeVisible();
  await ui.locator('.tuck-recovery .task-back').click();
  await expect(ui.getByRole('dialog')).toHaveCount(0);
  await expect(ui.locator('.tuck-recovery .palette-footer-title')).toHaveText('Review Tucked Away Groups');
  await expect(ui.getByRole('listbox')).toBeFocused();
  await expect(selected).toHaveAttribute('id', selectedId!);
  expect((await recoverySnapshot()).tuckRecoveries).toHaveLength(1);
  await ui.locator('.tuck-recovery .task-back').click();
  const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await expect(search).toBeFocused(); await expect(search).toHaveValue('recover tucked tabs');
  expect((await liveTabs()).map(tab => [tab.id, tab.groupId])).toEqual(before.map(tab => [tab.id, tab.groupId]));
  await openRecovery();
  await ui.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await ui.getByRole('dialog').getByRole('option').filter({ hasText: 'Stop Recovering This Record' }).click();
  await expect.poll(async () => (await recoverySnapshot()).tuckRecoveries.length).toBe(0);
  expect((await liveTabs()).map(tab => [tab.id, tab.groupId])).toEqual(before.map(tab => [tab.id, tab.groupId]));
  expect(await ui.evaluate(id => chrome.tabGroups.get(id), candidate.id)).toMatchObject({ title: 'My changed group', color: 'blue' });
  expect(await ui.evaluate(async () => ((await chrome.storage.local.get('justonehopTabTuckRecovery')).justonehopTabTuckRecovery as { records: unknown[] }).records)).toEqual([]);
});
