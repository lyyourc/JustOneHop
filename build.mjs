import { build, context } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
// Both Chinese browser locales use our current Simplified Chinese translation.
await cp('public/_locales/zh_CN', 'dist/_locales/zh_TW', { recursive: true });
for (const size of [16, 32, 128]) {
  await sharp('public/icon.svg').resize(size).png().toFile(`dist/icon${size}.png`);
}
const shared = {
  bundle: true, target: 'chrome127', sourcemap: true,
  define: { 'process.env.NODE_ENV': '"production"' }, minify: true,
  legalComments: 'eof',
};
const jobs = [
  { ...shared, entryPoints: ['src/recent-keys.ts'], outfile: 'dist/recent-keys.js', format: 'iife' },
  { ...shared, entryPoints: ['src/switcher.tsx'], outfile: 'dist/switcher.js', format: 'iife' },
  { ...shared, entryPoints: ['src/cookie-access.tsx'], outfile: 'dist/cookie-access.js', format: 'iife' },
  { ...shared, entryPoints: ['src/background.ts'], outfile: 'dist/background.js', format: 'esm' },
  { ...shared, entryPoints: ['src/content.tsx'], outfile: 'dist/content.js', format: 'iife', loader: { '.css': 'text' } },
  { ...shared, entryPoints: ['src/popup.tsx'], outfile: 'dist/popup.js', format: 'iife' },
];
if (process.argv.includes('--watch')) {
  await Promise.all(jobs.map(async options => { const ctx = await context(options); await ctx.watch(); }));
  console.log('Watching src/. Reload the extension after changes.');
} else {
  await Promise.all(jobs.map(options => build(options)));
  // Keep the bundled license notices together in the distributable.
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  await writeFile('dist/BUILD.txt', `zing ${pkg.version}\nBuilt locally. No remote code or services.\n`);
  console.log('Built extension → dist/');
}
