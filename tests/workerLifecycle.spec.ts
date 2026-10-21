import { expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { test, defaults, origin, context, ui, popupUrl, setUI, registerPaletteFixture } from './support/paletteFixture';

// Chrome 156 crashed at CHECK(storage_partition_) in Network.getResponseBody
// during this stress loop. Trace snapshots asynchronously read response bodies;
// retain action tracing and lifecycle diagnostics without that collection.
test.use({
  environment: { ...defaults, locale: 'en-US', commands: true },
  trace: { mode: 'retain-on-failure', snapshots: false },
});
registerPaletteFixture();

test('English palette launch worker lifecycle repeatedly wakes and reloads without script load errors', async () => {
  test.setTimeout(90_000);
  const monitor = await context.newPage(); await monitor.goto('chrome://extensions');
  const developerMode = monitor.getByRole('switch', { name: 'Developer mode', exact: true });
  await expect(developerMode).toBeVisible();
  await developerMode.setChecked(true);
  await expect(developerMode).toBeChecked();
  await monitor.goto(origin);
  const client = await context.newCDPSession(monitor);
  const errors: unknown[] = [];
  const workerUrl = popupUrl.replace('popup.html', 'background.js');
  const versions = new Map<string, { versionId: string; scriptURL: string; runningStatus: string; status: string }>();
  const events: { event: string; atMs: number }[] = [];
  const started = performance.now();
  const record = (event: string) => events.push({ event, atMs: Math.round(performance.now() - started) });
  context.on('close', () => record('context closed'));
  context.browser()?.on('disconnected', () => record('browser disconnected'));
  const watchPage = (page: Page) => {
    page.on('close', () => record('extension page closed'));
    page.on('crash', () => record('extension page crashed'));
  };
  watchPage(ui);
  client.on('ServiceWorker.workerErrorReported', event => errors.push(event.errorMessage));
  client.on('ServiceWorker.workerVersionUpdated', event => {
    for (const version of event.versions) if (version.scriptURL === workerUrl) {
      versions.set(version.versionId, version);
      record(`worker ${version.versionId}: ${version.runningStatus}`);
    }
  });
  await client.send('ServiceWorker.enable');
  const timings: { round: number; phase: string; ms: number }[] = [];
  let phase = 'ready', round = 0;
  let stops = 0, wakes = 0, reloads = 0, readyWorkers = 0;
  let completed = false;
  const timed = async <T,>(name: string, operation: () => Promise<T>): Promise<T> => {
    phase = name;
    const start = performance.now();
    try { return await operation(); }
    finally { timings.push({ round, phase: name, ms: Math.round(performance.now() - start) }); }
  };
  try {
    for (round = 0; round < 100; round++) {
      // Stop only this extension, and observe the stopped state before sending
      // the wake message; a global CDP stop can hang without identifying a target.
      await timed('stop', async () => {
        await expect.poll(() => [...versions.values()].some(version => version.status === 'activated' && version.runningStatus === 'running')).toBe(true);
        const version = [...versions.values()].find(version => version.status === 'activated' && version.runningStatus === 'running')!;
        // CDP's running state can precede Playwright's asynchronous debugger setup.
        // evaluate waits for both the execution context and workerScriptLoaded.
        const activeWorker = context.serviceWorkers().find(candidate => candidate.url() === workerUrl)
          ?? await context.waitForEvent('serviceworker', { predicate: candidate => candidate.url() === workerUrl, timeout: 5000 });
        expect(await activeWorker.evaluate(() => chrome.runtime.getURL('background.js'))).toBe(workerUrl);
        readyWorkers++;
        record(`worker ${version.versionId}: inspector ready`);
        // Chrome retains the inspector target across stops; Worker.close is not
        // a stop signal. Subscribe before stopping to capture the brief CDP state.
        let onVersion: (event: { versions: { versionId: string; runningStatus: string }[] }) => void;
        let onContextClose: () => void;
        let timer: ReturnType<typeof setTimeout>;
        const stopped = new Promise<void>((resolve, reject) => {
          onVersion = event => {
            if (event.versions.some(item => item.versionId === version.versionId && item.runningStatus === 'stopped')) resolve();
          };
          onContextClose = () => reject(new Error(`Browser context closed while stopping worker ${version.versionId} in round ${round}`));
          client.on('ServiceWorker.workerVersionUpdated', onVersion);
          context.on('close', onContextClose);
          timer = setTimeout(() => reject(new Error(`Worker ${version.versionId} did not stop in round ${round}`)), 5000);
        });
        try {
          await Promise.all([client.send('ServiceWorker.stopWorker', { versionId: version.versionId }), stopped]);
          stops++;
        } finally {
          clearTimeout(timer!);
          client.off('ServiceWorker.workerVersionUpdated', onVersion!);
          context.off('close', onContextClose!);
        }
      });
      const reply = await timed('wake', () => ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'snapshot' })));
      expect(reply.ok, `wake ${round}: ${JSON.stringify(errors)}`).toBe(true);
      await expect.poll(() => [...versions.values()].some(version => version.status === 'activated' && version.runningStatus === 'running')).toBe(true);
      wakes++;
      if (round % 5 === 4) {
        // runtime.reload() can return before the old extension page is torn down.
        // Do not start the next cycle against that still-unloading extension.
        await timed('reload', async () => {
          const previousUi = ui;
          await Promise.all([
            previousUi.waitForEvent('close', { timeout: 5000 }),
            previousUi.evaluate(() => chrome.runtime.reload()).catch(error => {
              if (!previousUi.isClosed()) throw error;
            }),
          ]);
          setUI(await context.newPage());
          watchPage(ui);
          await expect.poll(async () => {
            try { await ui.goto(popupUrl); return await ui.evaluate(() => chrome.runtime.sendMessage({ source: 'justonehop', type: 'snapshot' })).then(reply => reply.ok); }
            catch { return false; }
          }, { message: JSON.stringify(errors) }).toBe(true);
          reloads++;
        });
      }
    }
    expect({ stops, wakes, reloads, readyWorkers }).toEqual({ stops: 100, wakes: 100, reloads: 20, readyWorkers: 100 });
    expect(errors).toEqual([]);
    completed = true;
  } finally {
    test.info().annotations.push({ type: 'worker-lifecycle-timing', description: JSON.stringify({
      stops, wakes, reloads, readyWorkers, round, phase, loopMs: Math.round(performance.now() - started),
    }) });
    const diagnosticPath = test.info().outputPath('worker-lifecycle.json');
    await writeFile(diagnosticPath, JSON.stringify({ timings, events, versions: [...versions.values()], errors }, null, 2));
    await test.info().attach('worker-lifecycle', { path: diagnosticPath, contentType: 'application/json' });
    try { await client.detach(); }
    catch (error) {
      if (completed) throw error;
      test.info().annotations.push({ type: 'worker-cleanup-error', description: String(error) });
    }
  }
});
