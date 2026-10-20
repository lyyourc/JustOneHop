import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function checkRelease(root: string, tag?: string): Promise<string> {
  const readJSON = async (path: string) => JSON.parse(await readFile(join(root, path), 'utf8'));
  const [pkg, lock, manifest, changelog] = await Promise.all([
    readJSON('package.json'), readJSON('package-lock.json'), readJSON('public/manifest.json'),
    readFile(join(root, 'CHANGELOG.md'), 'utf8'),
  ]);
  const version = pkg.version;
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
    || version.split('.').some(part => Number(part) > 65535) || version === '0.0.0') {
    throw new Error('Use a Chrome-compatible major.minor.patch release version');
  }
  for (const [source, actual] of [
    ['package-lock.json', lock.version], ['package-lock.json root', lock.packages?.['']?.version],
    ['public/manifest.json', manifest.version],
  ]) {
    if (actual !== version) throw new Error(`${source}: expected ${version}, got ${actual}`);
  }
  if (!changelog.split(/\r?\n/).some(line => line.startsWith(`## [${version}] - `))) {
    throw new Error(`CHANGELOG.md is missing the ${version} release entry`);
  }
  if (tag !== undefined && tag !== `v${version}`) throw new Error(`Expected tag v${version}, got ${tag}`);
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const version = await checkRelease(root, process.argv[2]);
  console.log(`Release metadata aligned: ${version}`);
}
