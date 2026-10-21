import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserPath } from './support/browserPath';

test('browser selection uses the matching executable or an explicit override', async () => {
  assert.equal(await browserPath(process.execPath, ''), process.execPath);
  assert.equal(await browserPath('/missing/matching-browser', process.execPath), process.execPath);
});

test('missing matching browser fails with installation guidance instead of a cache fallback', async () => {
  await assert.rejects(browserPath('/missing/matching-browser', ''), /npx playwright install chromium --no-shell --no-remove/);
});

test('invalid override fails rather than silently using the matching browser', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'justonehop-browser-path-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(browserPath(process.execPath, join(directory, 'missing')), /Correct or unset the override/);
  if (process.platform !== 'win32') {
    const file = join(directory, 'not-executable');
    await writeFile(file, '', { mode: 0o600 });
    await assert.rejects(browserPath(process.execPath, file), /not executable/);
  }
});
