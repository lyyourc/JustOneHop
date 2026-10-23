import { test as base, expect, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { browserPath } from './support/browserPath';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const test = base.extend<{ startupStorageFailure: boolean }>({ startupStorageFailure: [false, { option: true }] });

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

test.beforeEach(async ({ startupStorageFailure }, testInfo) => {
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
  const failure = startupStorageFailure ? `
    const readSession = chrome.storage.session.get.bind(chrome.storage.session);
    let failedSessionRead = false;
    chrome.storage.session.get = async (...args) => {
      if (!failedSessionRead) { failedSessionRead = true; throw new Error('Temporary test storage failure'); }
      return readSession(...args);
    };
  ` : '';
  await writeFile(background, hook + failure + await readFile(background, 'utf8'));
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
    { type: 'browser-environment', description: JSON.stringify({ locale: 'en-US', startupStorageFailure, shadow: 'closed', headed: false }) });
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

for (const change of ['rename', 'foreign member', 'worker restart'] as const) {
  test(`second automatic tuck respects ownership after ${change}`, async () => {
    const [first] = await seed('Original-Batch');
    await enableAutomaticTucking();
    await runIdleScan();
    await expect.poll(() => groupId(first)).not.toBe(-1);
    const originalGroup = await groupId(first);
    const status = () => ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'tuck-status' }));
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
  });
}

for (const interruption of ['none', 'worker restart', 'failed insertion'] as const) test(`automatic batches preserve original interleaved order${interruption === 'none' ? '' : ` across ${interruption}`}`, async () => {
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
  if (interruption === 'worker restart') await restartTuckWorker();
  if (interruption === 'failed insertion') await worker.evaluate(() => {
    const move = chrome.tabs.move.bind(chrome.tabs);
    const group = chrome.tabs.group.bind(chrome.tabs);
    chrome.tabs.group = (async (options: chrome.tabs.GroupOptions) => {
      chrome.tabs.group = group;
      const id = await group(options);
      const members = await chrome.tabs.query({ groupId: id });
      const tabId = Array.isArray(options.tabIds) ? options.tabIds[0] : options.tabIds!;
      await move(tabId, { index: Math.max(...members.map(tab => tab.index)) });
      return id;
    }) as typeof group;
    chrome.tabs.move = (async () => {
      chrome.tabs.move = move;
      throw new Error('injected insertion failure');
    }) as typeof move;
  });
  await worker.evaluate(async () => {
    const harness = globalThis as unknown as { __tuckClockOffset: number; __tuckAlarms: ((alarm: chrome.alarms.Alarm) => unknown)[] };
    harness.__tuckClockOffset = 16 * 24 * 60 * 60 * 1000;
    const alarm = (await chrome.alarms.get('justonehop-auto-tuck'))!;
    for (const listener of harness.__tuckAlarms) listener(alarm);
  });
  await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'tuck-status' }));
  if (interruption === 'failed insertion') {
    expect(new Set(await members())).toEqual(new Set([b, d, a]));
    expect(await worker.evaluate(async () => {
      const saved = (await chrome.storage.session.get('justonehopTabTuckSession')).justonehopTabTuckSession as { pendingOrder?: Record<string, unknown[]> };
      return Object.values(saved.pendingOrder || {}).flat().length;
    })).toBe(1);
    await restartTuckWorker();
    await worker.evaluate(async () => {
      const harness = globalThis as unknown as { __tuckClockOffset: number; __tuckAlarms: ((alarm: chrome.alarms.Alarm) => unknown)[] };
      harness.__tuckClockOffset = 16 * 24 * 60 * 60 * 1000;
      const alarm = (await chrome.alarms.get('justonehop-auto-tuck'))!;
      for (const listener of harness.__tuckAlarms) listener(alarm);
    });
    await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'tuck-status' }));
  }
  expect(await members()).toEqual([a, b, c, d]);
  await execute('undoTuck');
  expect(await members()).toEqual(interruption === 'failed insertion' ? [a, b, d] : [b, d]);
  expect(await groupId(a)).toBe(interruption === 'failed insertion' ? owned : -1);
  expect(await groupId(c)).toBe(-1);
});

test('later automatic batches respect a manual reorder of existing tucked members', async () => {
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
});

test('unfocused Chrome tucks on a native alarm after thirty minutes and preserves undo', async () => {
  const [old] = await seed('Unfocused-Idle');
  await enableAutomaticTucking();
  // OS focus and elapsed time are controlled; alarm delivery and grouping are native.
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

test('English auto tuck duration saves on selection and a native alarm applies it', async () => {
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
  await ui.locator('.settings-search').getByRole('button', { name: 'Back', exact: true }).click();
  await search.fill('auto tuck'); await search.press('Enter');
  await expect(duration).toHaveText('1 hour');
  await expect(ui.getByRole('button', { name: 'Save duration', exact: true })).toHaveCount(0);
  await expect.poll(() => worker.evaluate(async () => ((await chrome.storage.local.get('preferences')).preferences as { autoTuckAfterHours: number }).autoTuckAfterHours)).toBe(1);
  await expect(ui.getByText('1 eligible tabs waiting for Chrome to lose focus or your computer to become idle', { exact: true })).toBeVisible();
  expect(await groupId(old)).toBe(-1);
  const after = await worker.evaluate(async () => (await chrome.storage.local.get('justonehopTabTuckClocks')).justonehopTabTuckClocks as { clocks: Record<string, number> });
  expect(after.clocks[`${origin}/Configurable-Idle`]).toBe(before.clocks[`${origin}/Configurable-Idle`]);
  // Chrome delivers this alarm itself; only age and idle state are simulated.
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
  await ui.getByRole('textbox', { name: 'Search settings' }).fill('auto tuck');
  const rules = ui.getByRole('button', { name: 'How it works' });
  await expect(ui.locator('.tuck-description')).toContainText('Pages stay open.');
  await expect(ui.locator('.tuck-rules-copy')).toBeHidden();
  await rules.click();
  await expect(ui.locator('.tuck-rules-copy')).toContainText('returns all tucked tabs');
  const ruleParagraphs = ui.locator('.tuck-rules-copy li');
  await expect(ruleParagraphs).toHaveText([
    'Tabs are only tucked after being idle for the chosen duration; enabling will not immediately tuck existing tabs.',
    'Tucks tabs when your computer is idle or Chrome has been unfocused for 30 minutes. Stops when you return to Chrome.',
    'Active, pinned, grouped, and other protected tabs are excluded.',
    'Turning off returns all tucked tabs back to the tab bar.',
  ]);
  const scheduleBox = await ruleParagraphs.nth(0).boundingBox();
  const timingBox = await ruleParagraphs.nth(1).boundingBox();
  expect(timingBox!.y).toBeGreaterThanOrEqual(scheduleBox!.y + scheduleBox!.height);
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('auto-tuck-rules-en.png') });
  await rules.click();
  await expect(ui.locator('.tuck-rules-copy')).toBeHidden();
  const labelBox = await ui.locator('.tuck-duration-label label').boundingBox();
  const choiceBox = await duration.boundingBox();
  expect(Math.abs(labelBox!.y + labelBox!.height / 2 - choiceBox!.y - choiceBox!.height / 2)).toBeLessThan(2);
  const checkBox = await ui.locator('.tuck-last-check').boundingBox();
  const rulesBox = await rules.boundingBox();
  expect(Math.abs(checkBox!.y + checkBox!.height / 2 - rulesBox!.y - rulesBox!.height / 2)).toBeLessThan(2);
  await ui.locator('.palette').screenshot({ path: test.info().outputPath('auto-tuck-en.png') });
  await ui.getByRole('textbox', { name: 'Search settings' }).fill('');
  const copyMetrics = (selector: string) => ui.locator(selector).evaluate(node => {
    const title = node.querySelector('label')!.getBoundingClientRect();
    const description = node.querySelector<HTMLElement>('.tuck-status-copy, p')!;
    const style = getComputedStyle(description);
    return { gap: description.getBoundingClientRect().top - title.bottom,
      fontSize: style.fontSize, lineHeight: style.lineHeight,
      unclipped: description.scrollWidth <= description.clientWidth && description.scrollHeight <= description.clientHeight };
  });
  const tuckCopy = await copyMetrics('.tuck-heading .setting-copy');
  const durationBox = await duration.boundingBox();
  await ui.getByRole('tab', { name: 'Appearance', exact: true }).click();
  const helpCopy = await copyMetrics('[data-setting="searchIcon"] .setting-copy');
  // Descriptions share typography and spacing across categories; wrapping stays natural.
  expect(helpCopy.unclipped).toBe(true);
  for (const copy of [tuckCopy]) {
    expect(Math.abs(copy.gap - helpCopy.gap)).toBeLessThan(1);
    expect(copy.fontSize).toBe(helpCopy.fontSize);
    expect(copy.lineHeight).toBe(helpCopy.lineHeight);
    expect(copy.unclipped).toBe(true);
  }
  const languageBox = await ui.getByRole('combobox', { name: 'Language', exact: true }).boundingBox();
  expect(Math.abs(languageBox!.x - durationBox!.x)).toBeLessThan(1);
  expect(durationBox!.height).toBe(languageBox!.height);
  await ui.locator('.settings-body').evaluate(node => { node.scrollTop = 0; });
  await ui.locator('.settings-view').screenshot({ path: test.info().outputPath('settings-overview-en.png') });
  await ui.getByRole('tab', { name: 'Labs', exact: true }).click();
  // A failed status read must not prevent saving; a failed write keeps the old value.
  await ui.evaluate(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = ((message: { type?: string }) => message.type === 'tuck-status'
      ? Promise.resolve({ ok: false, error: 'Status unavailable' }) : send(message)) as typeof chrome.runtime.sendMessage;
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    let fail = true;
    chrome.storage.local.set = (async (items: Record<string, unknown>) => {
      if (fail && items.preferences) { fail = false; throw new Error('Write failed'); }
      return set(items);
    }) as typeof chrome.storage.local.set;
  });
  await ui.getByRole('button', { name: 'Refresh status' }).click();
  const feedback = ui.locator('.palette-footer .operation-feedback');
  await expect(feedback).toHaveAttribute('role', 'alert');
  await expect(feedback).toContainText('Could not read auto tuck status. Refresh to retry.');
  await duration.click();
  await ui.getByRole('option', { name: '12 hours', exact: true }).click();
  await expect(feedback).toHaveAttribute('role', 'alert');
  await expect(feedback).toContainText('Could not save settings. Please try again.');
  await expect(duration).toHaveText('1 hour');
  await duration.click();
  await ui.getByRole('option', { name: '12 hours', exact: true }).click();
  await expect(duration).toHaveText('12 hours');
  await expect(feedback).toHaveAttribute('role', 'status');
  await expect(feedback).toContainText('Tuck after 12 hours saved');
  await expect.poll(() => worker.evaluate(async () => ((await chrome.storage.local.get('preferences')).preferences as { autoTuckAfterHours: number }).autoTuckAfterHours)).toBe(12);
});

test('English disabling automatic tuck releases its own tabs and keeps a same-name user group', async () => {
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

test('English tuck preserves a user rename made while a page is joining the group', async () => {
  const [alpha, beta] = await seed('Rename-Alpha', 'Rename-Beta');
  await execute('tuck', alpha);
  const owned = await groupId(alpha);
  await worker.evaluate(owned => {
    const original = chrome.tabs.group.bind(chrome.tabs);
    chrome.tabs.group = (async (options: chrome.tabs.GroupOptions) => {
      const group = await original(options);
      if (options.groupId === owned) await chrome.tabGroups.update(group, { title: 'My renamed group', color: 'blue' });
      return group;
    }) as typeof chrome.tabs.group;
  }, owned);
  await execute('tuck', beta);
  expect(await worker.evaluate(id => chrome.tabGroups.get(id), owned)).toMatchObject({ title: 'My renamed group', color: 'blue' });
  const snapshot = await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'snapshot' }));
  expect(snapshot.ok).toBe(true);
  expect(snapshot.data.tabs.find((tab: { id: number }) => tab.id === alpha).tucked).toBe(false);
  expect(snapshot.data.tabs.find((tab: { id: number }) => tab.id === beta).tucked).toBe(false);
});

test('English disabling tuck releases other pages after a transient failure and retries the remaining page', async () => {
  const [alpha, beta] = await seed('Retry-Alpha', 'Retry-Beta');
  await enableAutomaticTucking();
  await execute('tuck', alpha); await execute('tuck', beta);
  const owned = await groupId(alpha);
  await worker.evaluate(alpha => {
    const original = chrome.tabs.ungroup.bind(chrome.tabs);
    let failed = false;
    chrome.tabs.ungroup = (async (tabIds: number | [number, ...number[]]) => {
      if (!failed && tabIds === alpha) { failed = true; throw new Error('Temporary test tab failure'); }
      return original(tabIds);
    }) as typeof chrome.tabs.ungroup;
  }, alpha);
  await worker.evaluate(async () => {
    const { preferences } = await chrome.storage.local.get('preferences');
    await chrome.storage.local.set({ preferences: { ...(preferences as Record<string, unknown>), autoTuck: false } });
  });
  await expect.poll(() => groupId(beta)).toBe(-1);
  expect(await groupId(alpha)).toBe(owned);
  // Toolbar theme sync also uses a 30-second alarm; only tuck's alarm proves
  // that the failed release was scheduled for retry and subsequently stopped.
  await expect.poll(() => worker.evaluate(async () => (await chrome.alarms.get('justonehop-auto-tuck'))?.periodInMinutes)).toBe(0.5);
  await runIdleScan();
  await expect.poll(() => groupId(alpha)).toBe(-1);
  await expect.poll(() => worker.evaluate(() => chrome.alarms.get('justonehop-auto-tuck'))).toBeUndefined();
});

test('settings shows remaining releases while automatic tucking is disabled', async () => {
  const [alpha] = await seed('Pending-Release');
  await enableAutomaticTucking();
  await execute('tuck', alpha);
  await worker.evaluate(() => {
    const original = chrome.tabs.ungroup.bind(chrome.tabs);
    (globalThis as unknown as { __restoreUngroup: () => void }).__restoreUngroup = () => { chrome.tabs.ungroup = original; };
    chrome.tabs.ungroup = (async () => { throw new Error('Temporary release failure'); }) as typeof chrome.tabs.ungroup;
  });
  await ui.reload();
  const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await search.fill('auto tuck'); await search.press('Enter');
  await ui.getByRole('switch').click();
  await expect(ui.getByRole('switch')).not.toBeChecked();
  await expect(ui.locator('.tuck-status-copy')).toContainText('Tabs still awaiting return: 1. Retrying automatically.');
  expect(await groupId(alpha)).not.toBe(-1);
  await worker.evaluate(() => (globalThis as unknown as { __restoreUngroup: () => void }).__restoreUngroup());
  await ui.getByRole('button', { name: 'Refresh status' }).click();
  await expect(ui.locator('.tuck-status-copy')).toHaveCount(0);
  expect(await groupId(alpha)).toBe(-1);
});

test('temporary native label failure keeps automatic tuck ownership and undo after reconciliation', async () => {
  const [alpha] = await seed('Label-Failure');
  await enableAutomaticTucking();
  await worker.evaluate(() => {
    const update = chrome.tabGroups.update.bind(chrome.tabGroups);
    let fail = true;
    chrome.tabGroups.update = (async (id: number, changes: chrome.tabGroups.UpdateProperties) => {
      if (fail && changes.title === 'Tuck Away') { fail = false; throw new Error('Temporary label failure'); }
      return update(id, changes);
    }) as typeof chrome.tabGroups.update;
  });
  await runIdleScan();
  await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'tuck-status' }));
  await expect.poll(() => groupId(alpha)).not.toBe(-1);
  const owned = await groupId(alpha);
  await expect.poll(async () => (await recoverySnapshot()).tabs.find((tab: { id: number }) => tab.id === alpha)?.tucked).toBe(true);
  expect((await recoverySnapshot()).canUndoTuck).toBe(true);
  await expect.poll(() => worker.evaluate(id => chrome.tabGroups.get(id), owned)).toMatchObject({ title: 'Tuck Away' });
  await execute('undoTuck');
  expect(await groupId(alpha)).toBe(-1);
});

test('single-tab return preserves a group taken over during its final read', async () => {
  const [alpha, beta] = await seed('Return-Race-Alpha', 'Return-Race-Beta');
  await execute('tuck', alpha); await execute('tuck', beta);
  const owned = await groupId(alpha);
  await worker.evaluate(({ alpha, owned }) => {
    const get = chrome.tabs.get.bind(chrome.tabs);
    let reads = 0;
    chrome.tabs.get = (async (id: number) => {
      if (id === alpha && ++reads === 2) await chrome.tabGroups.update(owned, { title: 'My group', color: 'blue' });
      return get(id);
    }) as typeof chrome.tabs.get;
  }, { alpha, owned });
  await worker.evaluate(id => chrome.tabs.update(id, { active: true }), alpha);
  await expect.poll(() => worker.evaluate(id => chrome.tabGroups.get(id), owned)).toMatchObject({ title: 'My group', color: 'blue' });
  await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'tuck-status' }));
  expect(await groupId(alpha)).toBe(owned);
  expect(await groupId(beta)).toBe(owned);
  expect((await recoverySnapshot()).tabs.find((tab: { id: number }) => tab.id === alpha).tucked).toBe(false);
});

for (const operation of ['disable', 'undo'] as const) {
  test(`${operation} stops releasing when the user takes over the native group mid-operation`, async () => {
    const [alpha, beta] = await seed('Takeover-Alpha', 'Takeover-Beta');
    await enableAutomaticTucking();
    await runIdleScan();
    await expect.poll(() => groupId(beta)).not.toBe(-1);
    const owned = await groupId(beta);
    await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'tuck-status' }));
    await worker.evaluate(({ alpha, owned }) => {
      const original = chrome.tabs.ungroup.bind(chrome.tabs);
      chrome.tabs.ungroup = (async (ids: number | [number, ...number[]]) => {
        await original(ids);
        if (ids === alpha) await chrome.tabGroups.update(owned, { title: 'User took over', color: 'blue' });
      }) as typeof chrome.tabs.ungroup;
    }, { alpha, owned });
    if (operation === 'undo') await execute('undoTuck');
    else {
      await worker.evaluate(async () => {
        const { preferences } = await chrome.storage.local.get('preferences');
        await chrome.storage.local.set({ preferences: { ...(preferences as Record<string, unknown>), autoTuck: false } });
      });
    }
    await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'tuck-status' }));
    expect(await groupId(alpha)).toBe(-1);
    expect(await groupId(beta)).toBe(owned);
    expect(await worker.evaluate(id => chrome.tabGroups.get(id), owned)).toMatchObject({ title: 'User took over', color: 'blue' });
    const snapshot = await recoverySnapshot();
    expect(snapshot.tabs.find((tab: { id: number }) => tab.id === beta).tucked).toBe(false);
    expect(snapshot.canUndoTuck).toBe(false);
  });
}

for (const operation of ['disable', 'undo'] as const) for (const restart of ['worker', 'browser'] as const) {
  test(`partial ${operation} failure preserves safe recovery across a ${restart} restart`, async () => {
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
    if (operation === 'disable') {
      await worker.evaluate(async () => {
        const { preferences } = await chrome.storage.local.get('preferences');
        await chrome.storage.local.set({ preferences: { ...(preferences as Record<string, unknown>), autoTuck: false } });
      });
      await expect.poll(() => worker.evaluate(async () => (await chrome.alarms.get('justonehop-auto-tuck'))?.periodInMinutes)).toBe(0.5);
    } else {
      const reply = await ui.evaluate(windowId => chrome.runtime.sendMessage({ source: 'justonehop', type: 'execute',
        payload: { action: 'undoTuck', windowId } }), windowId);
      expect(reply.ok).toBe(false);
    }
    expect(await groupId(alpha)).toBe(-1);
    expect(await groupId(beta)).toBe(owned);
    await expect.poll(() => worker.evaluate(async ({ windowId, beta }) => {
      const state = (await chrome.storage.session.get('justonehopTabTuckSession')).justonehopTabTuckSession as {
        groups: { members: number[] }[]; undo: Record<number, { ids: number[] }>;
      };
      return { members: state.groups.flatMap(group => group.members), undo: state.undo[windowId]?.ids };
    }, { windowId, beta })).toEqual({ members: [beta], undo: [beta] });
    if (restart === 'browser') {
      await restartChrome();
      const restored = () => ui.evaluate(origin => chrome.tabs.query({}).then(tabs => tabs.filter(tab =>
        tab.url === `${origin}/Partial-Alpha` || tab.url === `${origin}/Partial-Beta`)), origin);
      await expect.poll(async () => (await restored()).length).toBe(2);
      const pages = await restored();
      const returned = pages.find(tab => tab.url!.endsWith('/Partial-Alpha'))!;
      const remaining = pages.find(tab => tab.url!.endsWith('/Partial-Beta'))!;
      expect(returned.groupId).toBe(-1);
      expect((await recoverySnapshot()).canUndoTuck).toBe(false);
      let snapshot = await recoverySnapshot();
      test.info().annotations.push({ type: 'restart-recovery', description: snapshot.tuckRecoveries.length
        ? 'Native metadata incomplete: explicit recovery confirmation exercised'
        : 'Native metadata complete: automatic recovery exercised' });
      if (!snapshot.tuckRecoveries.length && operation === 'disable') {
        await expect.poll(() => groupId(remaining.id!)).toBe(-1);
      }
      if (snapshot.tuckRecoveries.length) {
        // Incomplete native metadata requires explicit approval, including when
        // the saved preference is off. Review must never silently move pages.
        expect(remaining.groupId).not.toBe(-1);
        const pending = snapshot.tuckRecoveries[0];
        const candidate = pending.candidates.find((item: { id: number }) => item.id === remaining.groupId);
        expect(candidate).toBeDefined();
        const reply = await ui.evaluate(payload => chrome.runtime.sendMessage({ source: 'justonehop', type: 'execute', payload }), {
          action: 'resumeTuck', windowId: remaining.windowId, recoveryId: pending.id,
          groupId: candidate.id, fingerprint: candidate.fingerprint,
        });
        expect(reply.ok).toBe(true);
      }
      snapshot = await recoverySnapshot();
      expect(snapshot.tuckRecoveries).toEqual([]);
      expect(snapshot.canUndoTuck).toBe(false);
      windowId = remaining.windowId;
      // Undo is session-only. After explicit recovery, activation is still a
      // supported way to return a page even with automatic tucking disabled.
      if ((await worker.evaluate(id => chrome.tabs.get(id), remaining.id!)).groupId !== -1) {
        await worker.evaluate(id => chrome.tabs.update(id, { active: true }), remaining.id!);
      }
      await expect.poll(() => groupId(remaining.id!)).toBe(-1);
      expect(await groupId(returned.id!)).toBe(-1);
      return;
    }
    await restartTuckWorker();
    if (operation === 'undo') {
      expect(await groupId(beta)).toBe(owned);
      expect((await recoverySnapshot()).canUndoTuck).toBe(true);
      await execute('undoTuck');
    }
    await expect.poll(() => groupId(beta)).toBe(-1);
    expect(await groupId(alpha)).toBe(-1);
    expect((await recoverySnapshot()).canUndoTuck).toBe(false);
    if (operation === 'disable') {
      expect(await worker.evaluate(() => chrome.alarms.get('justonehop-auto-tuck'))).toBeUndefined();
    }
  });
}

test.describe(() => {
  test.use({ startupStorageFailure: true });
  test('English startup storage failure leaves the command palette available', async () => {
    const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
    await search.fill('new tab');
    await expect(ui.getByRole('option').first()).toContainText('New Tab');
    const snapshot = await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'snapshot' }));
    expect(snapshot.ok).toBe(true);
    expect(snapshot.data.tabs.length).toBeGreaterThan(0);
  });
});

test('English tuck gives a long-running active page a fresh grace period when the user leaves it', async () => {
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
  // Model persisted evidence requiring explicit review (also used by migration).
  // The real Chrome restart still restores native tabs/groups; their metadata
  // need not be lost for this record to require the user's confirmation.
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
  // This headless Chrome restores members but drops group title/collapsed state.
  // If a browser preserves all metadata, automatic reconciliation is valid too.
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

test('English recovery requires explicit keyboard confirmation and keeps the candidate name and color managed', async () => {
  const [a, b] = await seed('Confirm-Alpha', 'Confirm-Beta');
  await execute('tuck', a); await execute('tuck', b);
  // Require review independently of whether this Chrome version restores names.
  await requireRecoveryConfirmation();
  await restartChrome();
  await expect.poll(async () => (await recoverySnapshot()).tuckRecoveries.length).toBe(1);
  await expect.poll(async () => (await recoverySnapshot()).tuckRecoveries[0].candidates.length).toBe(1);
  const candidate = (await recoverySnapshot()).tuckRecoveries[0].candidates[0];
  await worker.evaluate(id => chrome.tabGroups.update(id, { title: 'Read when ready', color: 'purple' }), candidate.id);
  await expect.poll(async () => (await recoverySnapshot()).tuckRecoveries[0].candidates[0].title).toBe('Read when ready');
  const search = ui.getByRole('combobox', { name: 'Search commands, tabs, bookmarks, and history' });
  await search.fill('recover tucked tabs');
  await expect(ui.getByRole('option').filter({ hasText: 'Review Tucked Away Groups' }).first()).toHaveAttribute('aria-selected', 'true');
  await search.press('Enter');
  const list = ui.getByRole('listbox');
  await expect(list).toBeFocused();
  await expect(list.getByRole('option', { selected: true })).toContainText('Read when ready');
  await ui.keyboard.press('Enter');
  await expect(ui.locator('.tuck-recovery')).toBeVisible();
  let snapshot = await recoverySnapshot();
  expect(snapshot.tuckRecoveries).toHaveLength(1);
  expect(snapshot.tabs.filter((tab: { tucked?: boolean }) => tab.tucked)).toHaveLength(0);
  expect(await worker.evaluate(id => chrome.tabGroups.get(id), candidate.id)).toMatchObject({ title: 'Read when ready', color: 'purple' });
  await ui.keyboard.press('Control+n');
  await ui.keyboard.press('Control+p');
  await ui.keyboard.press('Shift+Tab');
  await expect(ui.locator('.tuck-recovery .task-back')).toBeFocused();
  await ui.keyboard.press('Tab');
  await ui.keyboard.press('Tab');
  await expect(ui.getByRole('button', { name: 'Continue Managing This Group', exact: true })).toBeFocused();
  await ui.keyboard.press('Enter');
  await expect.poll(async () => (await recoverySnapshot()).tuckRecoveries.length).toBe(0);
  snapshot = await recoverySnapshot();
  expect(snapshot.tabs.filter((tab: { tucked?: boolean }) => tab.tucked)).toHaveLength(2);
  expect(await worker.evaluate(id => chrome.tabGroups.get(id), candidate.id)).toMatchObject({ title: 'Read when ready', color: 'purple' });
  const [extra] = await seed('Confirm-Extra');
  await execute('tuck', extra);
  expect(await groupId(extra)).toBe(candidate.id);
  const alpha = snapshot.tabs.find((tab: { url: string }) => tab.url === `${origin}/Confirm-Alpha`);
  await worker.evaluate(id => chrome.tabs.update(id, { active: true }), alpha.id);
  await expect.poll(() => groupId(alpha.id)).toBe(-1);
  expect(await worker.evaluate(id => chrome.tabGroups.get(id), candidate.id)).toMatchObject({ title: 'Read when ready', color: 'purple' });
  await expect.poll(() => worker.evaluate(async () => {
    const { justonehopTabTuckRecovery } = await chrome.storage.local.get('justonehopTabTuckRecovery');
    return (justonehopTabTuckRecovery as { records: { title: string; color: string; customTitle: boolean; urls: string[] }[] }).records;
  })).toEqual([expect.objectContaining({ title: 'Read when ready', color: 'purple', customTitle: true,
    urls: expect.arrayContaining([`${origin}/Confirm-Beta`, `${origin}/Confirm-Extra`]) })]);
});

for (const restoreMetadata of [true, false]) test(`multiple same-name groups recover after real Chrome restart ${restoreMetadata ? 'with metadata completion' : 'without intervention'}`, { tag: '@windows' }, async () => {
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
  // This Chromium can drop group metadata on restart. Supply only the missing
  // native metadata; the extension must infer ownership from persisted evidence.
  if (restoreMetadata) for (const tab of [a, b]) {
    await ui.evaluate(async id => {
      const group = await chrome.tabGroups.get(id);
      if (group.title !== 'Tuck Away' || group.color !== 'grey') {
        await chrome.tabGroups.update(id, { title: 'Tuck Away', color: 'grey' });
      }
    }, tab.groupId);
  }
  const pending = (await recoverySnapshot()).tuckRecoveries;
  if (!restoreMetadata && pending.length) {
    test.info().annotations.push({ type: 'multiwindow-restart', description: 'Unassisted restart: incomplete evidence safely awaits confirmation' });
    const before = await ui.evaluate(() => chrome.tabGroups.query({}));
    windowId = a.windowId;
    const [nextA] = await seed('Blocked-After-Restart-A');
    windowId = b.windowId;
    const [nextB] = await seed('Blocked-After-Restart-B');
    await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'tuck-status' }));
    await runIdleScan();
    await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'tuck-status' }));
    expect(await groupId(nextA)).toBe(-1);
    expect(await groupId(nextB)).toBe(-1);
    expect(await groupId(a.id!)).toBe(a.groupId);
    expect(await groupId(b.id!)).toBe(b.groupId);
    expect(await ui.evaluate(() => chrome.tabGroups.query({}))).toEqual(before);
    expect((await recoverySnapshot()).tuckRecoveries.length).toBe(pending.length);
    return;
  }
  if (!restoreMetadata) test.info().annotations.push({ type: 'multiwindow-restart', description: 'Unassisted restart: automatic ownership recovery and subsequent batch exercised' });
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

test('English late restored group metadata reconnects automatically without creating a new group', async () => {
  await prepareRestart();
  const snapshot = await recoverySnapshot();
  if (snapshot.tuckRecoveries.length) {
    const pending = snapshot.tuckRecoveries[0];
    await ui.evaluate(({ id, title }) => chrome.tabGroups.update(id, { title, color: 'grey' }),
      { id: pending.candidates[0].id, title: pending.title });
  }
  await expect.poll(async () => (await recoverySnapshot()).tabs.filter((tab: { tucked?: boolean }) => tab.tucked).length).toBe(2);
  expect((await recoverySnapshot()).tuckRecoveries).toEqual([]);
  // Query native state through the live page after Chrome restarts.
  expect(await ui.evaluate(() => chrome.tabGroups.query({}).then(groups => groups.length))).toBe(1);
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

test('justonehop group edits preserve tuck ownership and persist custom title and color', async () => {
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
});
