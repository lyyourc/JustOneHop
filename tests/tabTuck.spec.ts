import { test as base, expect, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { access, cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { homedir, tmpdir } from 'node:os';
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

async function browserPath() {
  if (process.env.JUSTONEHOP_CHROMIUM_PATH) return process.env.JUSTONEHOP_CHROMIUM_PATH;
  try { await access(chromium.executablePath()); return chromium.executablePath(); } catch {}
  if (process.platform === 'darwin') {
    const cache = join(homedir(), 'Library/Caches/ms-playwright');
    for (const directory of (await readdir(cache)).filter(name => /^chromium-\d+$/.test(name)).sort().reverse()) {
      const path = join(cache, directory, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
      try { await access(path); return path; } catch {}
    }
  }
  return chromium.executablePath();
}

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
  profile = await mkdtemp(join(tmpdir(), 'justonehop-tuck-e2e-'));
  const extension = join(profile, 'extension');
  await cp(resolve('dist'), extension, { recursive: true });
  // Advance only this disposable worker's clock and dispatch the real registered
  // alarm callback. No test RPC or clock controls are shipped in the extension.
  const background = join(extension, 'background.js');
  const hook = `
    globalThis.__tuckClockOffset = 0;
    globalThis.__tuckAlarms = [];
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
  context = await chromium.launchPersistentContext(join(profile, 'browser'), {
    executablePath: await browserPath(), headless: true, locale: 'en-US', reducedMotion: 'reduce',
    ignoreDefaultArgs: process.platform === 'darwin' ? ['about:blank'] : [],
    viewport: { width: 1100, height: 760 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  worker = context.serviceWorkers().find(item => item.url().endsWith('/background.js'))
    || await context.waitForEvent('serviceworker', item => item.url().endsWith('/background.js'));
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
});
test.afterEach(async () => {
  await context?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
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
  await expect.poll(() => worker.evaluate(async () => (await chrome.alarms.getAll()).length)).toBeGreaterThan(0);
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
  await expect(ui.getByRole('option').filter({ hasText: 'Tuck Alpha' }).first()).toBeVisible();
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
  await expect(row).toContainText('Tucked');
  await row.click();
  await expect.poll(() => groupId(alpha)).toBe(-1);
  expect(await groupId(beta)).toBe(tuckedGroup);
  await expect.poll(() => worker.evaluate(id => chrome.tabGroups.get(id).then(group => group.collapsed), tuckedGroup)).toBe(true);
  expect(await alphaPage.locator('input').inputValue()).toBe('Keep this unsaved note');
});

test('English tuck preview navigation and Escape do not move a tucked tab', async () => {
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
  await worker.evaluate(() => { (globalThis as unknown as { __tuckClockOffset: number }).__tuckClockOffset = 8 * 24 * 60 * 60 * 1000; });
  const fresh = await seed('Fresh-Left', 'Fresh-Right');
  const ordinary = (await liveTabs()).sort((a, b) => a.index - b.index).filter(tab => ![closed, regrouped, restored, retained].includes(tab.id!)).map(tab => tab.id);
  await runIdleScan();
  await expect.poll(() => groupId(restored)).not.toBe(-1);
  const tuckedGroup = await groupId(restored);
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

test('English automatic tuck stops the batch when the user becomes active', async () => {
  const ids = await seed('Resume-First', 'Resume-Second', 'Resume-Third');
  await enableAutomaticTucking();
  await worker.evaluate(() => {
    const original = chrome.tabs.group.bind(chrome.tabs);
    chrome.tabs.group = (async (options: chrome.tabs.GroupOptions) => {
      const id = await original(options);
      chrome.idle.queryState = (async () => 'active') as typeof chrome.idle.queryState;
      return id;
    }) as typeof chrome.tabs.group;
  });
  await runIdleScan();
  await expect.poll(async () => (await liveTabs()).filter(tab => ids.includes(tab.id!) && tab.groupId !== -1).length).toBe(1);
  await expect.poll(() => worker.evaluate(async () => {
    const stored = (await chrome.storage.session.get('justonehopTabTuckSession')).justonehopTabTuckSession as { undo: Record<number, { ids: number[] }> };
    return Object.values(stored.undo).flatMap(batch => batch.ids).length;
  })).toBe(1);
  expect(await groupId(ids[1])).toBe(-1);
  expect(await groupId(ids[2])).toBe(-1);
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
  await expect.poll(() => worker.evaluate(async () => (await chrome.alarms.getAll()).some(alarm => alarm.periodInMinutes === 0.5))).toBe(true);
  await runIdleScan();
  await expect.poll(() => groupId(alpha)).toBe(-1);
  await expect.poll(() => worker.evaluate(async () => (await chrome.alarms.getAll()).length)).toBe(0);
});

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

async function prepareRestart() {
  const [alpha, beta] = await seed('Restart-Alpha', 'Restart-Beta');
  await execute('tuck', alpha); await execute('tuck', beta);
  await expect.poll(() => worker.evaluate(async () => ((await chrome.storage.local.get('justonehopTabTuckRecovery')).justonehopTabTuckRecovery as { records: unknown[] }).records.length)).toBe(1);
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
    await ui.keyboard.press('Tab');
    await expect(ui.locator('.tuck-recovery .footer-back')).toBeFocused();
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
  await worker.evaluate(async () => {
    const { justonehopTabTuckRecovery } = await chrome.storage.local.get('justonehopTabTuckRecovery');
    const saved = justonehopTabTuckRecovery as { records: { requiresConfirmation?: boolean }[] };
    saved.records.forEach(record => { record.requiresConfirmation = true; });
    await chrome.storage.local.set({ justonehopTabTuckRecovery: saved });
  });
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
  await ui.keyboard.press('Tab');
  await expect(ui.locator('.tuck-recovery .footer-back')).toBeFocused();
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
  expect(await worker.evaluate(() => chrome.tabGroups.query({}).then(groups => groups.length))).toBe(1);
});

test('English recovery rejects stale confirmation and forgetting leaves native pages and groups untouched', async () => {
  await prepareRestart();
  const snapshot = await recoverySnapshot();
  expect(snapshot.tuckRecoveries).toHaveLength(1);
  const pending = snapshot.tuckRecoveries[0], candidate = pending.candidates[0];
  await ui.evaluate(id => chrome.tabGroups.update(id, { title: 'My changed group', color: 'blue' }), candidate.id);
  const stale = await ui.evaluate(payload => chrome.runtime.sendMessage({ source: 'justonehop', type: 'execute', payload }),
    { action: 'resumeTuck', windowId, recoveryId: pending.id, groupId: candidate.id, fingerprint: candidate.fingerprint });
  expect(stale.ok).toBe(false);
  expect(await ui.evaluate(id => chrome.tabGroups.get(id), candidate.id)).toMatchObject({ title: 'My changed group', color: 'blue' });
  const before = await liveTabs();
  await openRecovery();
  await expect(ui.locator('.tuck-recovery .settings-header')).toHaveCount(0);
  await expect(ui.locator('.tuck-recovery .footer-back')).toHaveAccessibleName('Back · Review Tucked Away Groups');
  const selected = ui.locator('.recovery-candidate[aria-selected=true]');
  const selectedId = await selected.getAttribute('id');
  await selected.click({ button: 'right' });
  await expect(ui.getByRole('dialog')).toBeVisible();
  await ui.locator('.tuck-recovery .footer-back').click();
  await expect(ui.getByRole('dialog')).toHaveCount(0);
  await expect(ui.locator('.tuck-recovery .palette-footer-title')).toHaveText('Review Tucked Away Groups');
  await expect(ui.getByRole('listbox')).toBeFocused();
  await expect(selected).toHaveAttribute('id', selectedId!);
  expect((await recoverySnapshot()).tuckRecoveries).toHaveLength(1);
  await ui.locator('.tuck-recovery .footer-back').click();
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
