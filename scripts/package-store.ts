import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// esbuild emits these as standalone trailing comments. Leave strings and earlier comments intact.
export function stripSourceMapComment(text: string): string {
  return text.replace(/(?:^|\r?\n)(?:\/\/# sourceMappingURL=[^\r\n]*|\/\*# sourceMappingURL=[^\r\n]* \*\/)\s*$/, '\n');
}

export async function packageStore(dist: string, output: string) {
  await mkdir(dirname(output), { recursive: true });
  const temporary = await mkdtemp(join(dirname(output), '.store-package-'));
  const staging = join(temporary, 'extension');
  try {
    async function copyDirectory(source: string, target: string) {
      await mkdir(target, { recursive: true });
      for (const entry of await readdir(source, { withFileTypes: true })) {
        const from = join(source, entry.name), to = join(target, entry.name);
        if (entry.isDirectory()) await copyDirectory(from, to);
        else if (entry.isFile()) {
          if (entry.name.endsWith('.map')) continue;
          const bytes = await readFile(from);
          await writeFile(to, /\.(js|css)$/.test(entry.name) ? stripSourceMapComment(bytes.toString('utf8')) : bytes);
        } else throw new Error(`Unsupported release entry: ${from}`);
      }
    }
    await copyDirectory(dist, staging);
    await readFile(join(staging, 'manifest.json'));
    const archive = join(temporary, 'extension.zip');
    execFileSync('zip', ['-qr', archive, '.'], { cwd: staging });
    execFileSync('unzip', ['-tq', archive]);
    await rename(archive, output);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const manifest = JSON.parse(await readFile(join(root, 'dist/manifest.json'), 'utf8'));
  if (!/^\d+(?:\.\d+){0,3}$/.test(manifest.version)) throw new Error('Invalid release version');
  const output = join(root, 'releases', `justonehop-${manifest.version}.zip`);
  await packageStore(join(root, 'dist'), output);
  console.log(`Packaged extension without source maps → ${output}`);
}
