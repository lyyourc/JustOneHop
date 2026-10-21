import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acquireResource } from './support/resourceLock';

test('shared resource excludes another owner and becomes available after release', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'justonehop-resource-'));
  const path = join(directory, 'clipboard.lock');
  try {
    const release = await acquireResource(path);
    await assert.rejects(acquireResource(path, 1), /Timed out/);
    await Promise.all([release(), release()]);
    const next = await acquireResource(path);
    // A late duplicate cleanup must not release the next owner's lock.
    await release();
    await assert.rejects(acquireResource(path, 1), /Timed out/);
    await next();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
