import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageStore, stripSourceMapComment } from '../scripts/package-store.ts';

test('release cleanup removes trailing JS/CSS map comments without changing runtime strings', () => {
  const js = 'const text = "//# sourceMappingURL=keep.map";';
  assert.equal(stripSourceMapComment(`${js}\n//# sourceMappingURL=app.js.map\n`), `${js}\n`);
  assert.equal(stripSourceMapComment('body{color:red}\r\n/*# sourceMappingURL=app.css.map */\r\n'), 'body{color:red}\n');
  assert.equal(stripSourceMapComment(js), js);
  const earlier = '//# sourceMappingURL=earlier.map\nconsole.log("keep");\n';
  assert.equal(stripSourceMapComment(earlier), earlier);
});

test('store archive replaces old entries, keeps local maps, and preserves previous ZIP on failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'justonehop-package-test-'));
  const dist = join(root, 'dist'), output = join(root, 'release.zip');
  try {
    await mkdir(join(dist, '_locales/en'), { recursive: true });
    await writeFile(join(dist, 'manifest.json'), '{"manifest_version":3,"version":"0.1.0"}');
    await writeFile(join(dist, '_locales/en/messages.json'), '{}');
    const source = 'console.log("ready");\n//# sourceMappingURL=app.js.map\n';
    await writeFile(join(dist, 'app.js'), source);
    await writeFile(join(dist, 'app.js.map'), '{}');
    await writeFile(join(dist, 'app.css'), 'body{}\n/*# sourceMappingURL=app.css.map */\n');
    const icon = Buffer.from([0, 255, 128, 42]);
    await writeFile(join(dist, 'icon.png'), icon);
    await writeFile(join(dist, 'obsolete.txt'), 'old');
    await packageStore(dist, output);
    await rm(join(dist, 'obsolete.txt'));
    await packageStore(dist, output);
    const names = execFileSync('unzip', ['-Z1', output], { encoding: 'utf8' }).trim().split('\n').filter(name => !name.endsWith('/')).sort();
    assert.deepEqual(names, ['_locales/en/messages.json', 'app.css', 'app.js', 'icon.png', 'manifest.json']);
    assert.equal(execFileSync('unzip', ['-p', output, 'app.js'], { encoding: 'utf8' }), 'console.log("ready");\n');
    assert.equal(execFileSync('unzip', ['-p', output, 'app.css'], { encoding: 'utf8' }), 'body{}\n');
    assert.deepEqual(execFileSync('unzip', ['-p', output, 'icon.png']), icon);
    assert.equal(await readFile(join(dist, 'app.js'), 'utf8'), source);
    assert.equal(await readFile(join(dist, 'app.js.map'), 'utf8'), '{}');
    const previous = await readFile(output);
    await rm(join(dist, 'manifest.json'));
    await assert.rejects(packageStore(dist, output));
    assert.deepEqual(await readFile(output), previous);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
