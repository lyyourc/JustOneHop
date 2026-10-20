import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRelease } from '../scripts/check-release.ts';

test('release metadata rejects mismatched versions, missing notes, and incorrect tags', async () => {
  const root = await mkdtemp(join(tmpdir(), 'justonehop-release-test-'));
  const json = (path: string, value: unknown) => writeFile(join(root, path), JSON.stringify(value));
  try {
    await mkdir(join(root, 'public'));
    await json('package.json', { version: '0.2.0' });
    await json('package-lock.json', { version: '0.2.0', packages: { '': { version: '0.2.0' } } });
    await json('public/manifest.json', { version: '0.2.0' });
    await writeFile(join(root, 'CHANGELOG.md'), '# Changelog\n\n## [0.2.0] - Unreleased\n');
    assert.equal(await checkRelease(root, 'v0.2.0'), '0.2.0');
    await assert.rejects(checkRelease(root, 'v0.1.0'), /Expected tag/);
    await json('public/manifest.json', { version: '0.1.0' });
    await assert.rejects(checkRelease(root), /public\/manifest.json/);
    await json('public/manifest.json', { version: '0.2.0' });
    await json('package-lock.json', { version: '0.1.0', packages: { '': { version: '0.2.0' } } });
    await assert.rejects(checkRelease(root), /package-lock.json/);
    await json('package-lock.json', { version: '0.2.0', packages: { '': { version: '0.1.0' } } });
    await assert.rejects(checkRelease(root), /package-lock.json root/);
    await json('package-lock.json', { version: '0.2.0', packages: { '': { version: '0.2.0' } } });
    await writeFile(join(root, 'CHANGELOG.md'), '# Changelog\n\n## [0.1.0] - Unreleased\n');
    await assert.rejects(checkRelease(root), /missing the 0.2.0 release entry/);
    for (const version of ['0.2.0-beta.1', '01.2.0', '65536.0.0', '0.0.0']) {
      await json('package.json', { version });
      await assert.rejects(checkRelease(root), /Chrome-compatible/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
