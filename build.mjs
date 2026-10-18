import { build, context } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
// Both Chinese browser locales use our current Simplified Chinese translation.
await cp('public/_locales/zh_CN', 'dist/_locales/zh_TW', { recursive: true });
// Keep the toolbar mark transparent at every density; management/store icons use the plate.
for (const size of [16, 32, 48, 128]) {
  for (const theme of ['light', 'dark']) {
    const name = size <= 32 ? `icon${size}` : `toolbar${size}`;
    await sharp(`docs/brand/logo-small-${theme}.svg`, { density: 576 }).trim({ threshold: 0 })
      .resize(size, size, { fit: 'contain', background: '#00000000' }).png()
      .toFile(`dist/${name}${theme === 'dark' ? '-dark' : ''}.png`);
  }
  if (size > 32) await sharp('docs/brand/logo-app.svg', { density: 576 }).resize(size, size).png().toFile(`dist/icon${size}.png`);
}
const shared = {
  bundle: true, target: 'chrome127', sourcemap: true, loader: { '.svg': 'text' },
  define: { 'process.env.NODE_ENV': '"production"' }, minify: true,
  legalComments: 'eof',
};
const jobs = [
  { ...shared, entryPoints: ['src/recent-keys.ts'], outfile: 'dist/recent-keys.js', format: 'iife' },
  { ...shared, entryPoints: ['src/switcher.tsx'], outfile: 'dist/switcher.js', format: 'iife' },
  { ...shared, entryPoints: ['src/cookie-access.tsx'], outfile: 'dist/cookie-access.js', format: 'iife' },
  // The worker is a single self-contained bundle; no runtime module graph is needed.
  { ...shared, entryPoints: ['src/background.ts'], outfile: 'dist/background.js', format: 'iife' },
  { ...shared, entryPoints: ['src/toolbarTheme.ts'], outfile: 'dist/toolbarTheme.js', format: 'iife' },
  { ...shared, entryPoints: ['src/content.tsx'], outfile: 'dist/content.js', format: 'iife', loader: { ...shared.loader, '.css': 'text' } },
  { ...shared, entryPoints: ['src/popup.tsx'], outfile: 'dist/popup.js', format: 'iife' },
  { ...shared, entryPoints: ['src/help.tsx'], outfile: 'dist/help.js', format: 'iife' },
];
if (process.argv.includes('--watch')) {
  await Promise.all(jobs.map(async options => { const ctx = await context(options); await ctx.watch(); }));
  console.log('Watching src/. Reload the extension after changes.');
} else {
  await Promise.all(jobs.map(options => build(options)));
  // Keep the bundled license notices together in the distributable.
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  await writeFile('dist/BUILD.txt', `JustOneHop ${pkg.version}\nBuilt locally. No remote code or services.\n`);
  console.log('Built extension → dist/');
}
