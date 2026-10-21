import { defineConfig } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunDirectory } from './scripts/validation.ts';

const root = dirname(fileURLToPath(import.meta.url));
const runDirectory = process.env.JUSTONEHOP_E2E_RUN_DIR ?? createRunDirectory(root);
// Workers and fixtures can resolve run-scoped artifacts without depending on cwd.
process.env.JUSTONEHOP_E2E_RUN_DIR = runDirectory;
// Parallel browser execution is opt-in until the full suite proves isolation and startup stability.
const parallel = process.env.JUSTONEHOP_E2E_PARALLEL === '1';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', workers: parallel ? 2 : 1, timeout: 30_000,
  projects: [
    { name: 'ui', testMatch: '**/*.ui.spec.ts', workers: 1 },
    ...(parallel ? [
      { name: 'headed', testIgnore: '**/*.ui.spec.ts', grep: /@headed\b/, workers: 1 },
      { name: 'clipboard', testIgnore: '**/*.ui.spec.ts', grep: /@clipboard\b/, grepInvert: /@headed\b/, workers: 1, fullyParallel: true },
      { name: 'windows', testIgnore: '**/*.ui.spec.ts', grep: /@windows\b/, grepInvert: /@(headed|clipboard)\b/, workers: 1, fullyParallel: true },
      { name: 'parallel', testIgnore: '**/*.ui.spec.ts', grepInvert: /@(headed|clipboard|windows)\b/, workers: 2, fullyParallel: true },
    ] : [{ name: 'serial', testIgnore: '**/*.ui.spec.ts', workers: 1 }]),
  ],
  outputDir: join(runDirectory, 'artifacts'),
  reporter: [['list'], ['./scripts/validation-reporter.ts', { directory: runDirectory }]],
  use: { trace: 'retain-on-failure' },
});
