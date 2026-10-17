import { defineConfig } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunDirectory } from './scripts/validation.ts';

const root = dirname(fileURLToPath(import.meta.url));
const runDirectory = process.env.ZING_E2E_RUN_DIR ?? createRunDirectory(root);
// Workers and fixtures can resolve run-scoped artifacts without depending on cwd.
process.env.ZING_E2E_RUN_DIR = runDirectory;
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', workers: 1, timeout: 30_000,
  outputDir: join(runDirectory, 'artifacts'),
  reporter: [['list'], ['./scripts/validation-reporter.ts', { directory: runDirectory }]],
  use: { trace: 'retain-on-failure' },
});
