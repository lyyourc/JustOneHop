import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { acquireLock, hashDirectory } from '../scripts/validation.ts';
import { runE2E } from '../scripts/run-e2e.ts';
import ValidationReporter from '../scripts/validation-reporter.ts';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
function temporary(t: { after: (fn: () => void) => void }) {
  const path = mkdtempSync(join(tmpdir(), 'zing-validation-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet', path]);
  writeFileSync(join(path, '.gitignore'), 'dist/\ntest-results/\n');
  execFileSync('git', ['add', '.gitignore'], { cwd: path });
  execFileSync('git', ['-c', 'user.name=Validation Test', '-c', 'user.email=validation@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Initialize test repository'], { cwd: path });
  return path;
}
function command(code: string) { return { executable: process.execPath, args: ['-e', code, '--'] }; }
const build = command("require('fs').mkdirSync('dist', { recursive: true }); require('fs').writeFileSync('dist/app.js', 'built');");
function reports(path: string) {
  return readdirSync(join(path, 'test-results', 'runs')).map(run => JSON.parse(readFileSync(join(path, 'test-results', 'runs', run, 'validation.json'), 'utf8')));
}

test('failed build records failure, never launches Playwright, and releases the lock', async t => {
  const path = temporary(t);
  const result = await runE2E(['--grep', 'focused'], { root: path, build: command('process.exit(9)'),
    playwright: command("require('fs').writeFileSync('browser-started', '')") });
  assert.equal(result, 9);
  assert.equal(existsSync(join(path, 'browser-started')), false);
  assert.equal(existsSync(join(path, 'test-results', '.e2e.lock')), false);
  const report = reports(path)[0];
  assert.equal(report.status, 'build-failed');
  assert.equal(report.build.exitCode, 9);
  assert.ok(report.finishedAt);
});

test('runner builds first, forwards selectors literally, preserves failure, and isolates output', async t => {
  const path = temporary(t);
  const playwright = command("const fs = require('fs'); if (fs.readFileSync('dist/app.js', 'utf8') !== 'built') process.exit(99); fs.writeFileSync(require('path').join(process.env.ZING_E2E_RUN_DIR, 'args.json'), JSON.stringify(process.argv.slice(1))); process.exit(4);");
  const args = ['--grep', 'mouse | keyboard; $literal'];
  assert.equal(await runE2E(args, { root: path, build, playwright }), 4);
  assert.equal(await runE2E(['--list'], { root: path, build, playwright: command('process.exit(0)') }), 0);
  const runs = readdirSync(join(path, 'test-results', 'runs'));
  assert.equal(runs.length, 2);
  const report = reports(path).find(report => report.status === 'failed');
  assert.deepEqual(report.command.slice(4), args);
  assert.equal(report.dist.freshlyBuilt, true);
  assert.equal(report.dist.hash, hashDirectory(join(path, 'dist')));
  const run = runs.find(run => existsSync(join(path, 'test-results', 'runs', run, 'args.json')))!;
  assert.deepEqual(JSON.parse(readFileSync(join(path, 'test-results', 'runs', run, 'args.json'), 'utf8')), args);
  assert.equal(reports(path).find(report => report.mode === 'list').status, 'listed');
});

test('last-failed requires valid explicit state and never falls back to all tests', async t => {
  const path = temporary(t);
  const statePath = join(path, 'previous.json');
  for (const args of [['--last-failed'], ['--last-failed', '--last-failed-file', statePath],
    ['--last-failed-file', statePath], ['--last-failed', '--last-failed-file', statePath, `--last-failed-file=${statePath}`]]) {
    assert.equal(await runE2E(args, { root: path, build }), 2);
  }
  for (const content of ['{', '{}', '{"status":"failed","failedTests":[123]}', '{"status":"invalid","failedTests":[]}']) {
    writeFileSync(statePath, content);
    assert.equal(await runE2E(['--last-failed', `--last-failed-file=${statePath}`], { root: path, build }), 2);
  }
  assert.equal(existsSync(join(path, 'dist')), false);
  assert.equal(existsSync(join(path, 'test-results')), false);
});

test('last-failed copies selector state into the new run and preserves prior evidence', async t => {
  const path = temporary(t);
  const statePath = join(path, 'previous.json');
  const original = JSON.stringify({ status: 'failed', failedTests: ['previous-failure'] });
  writeFileSync(statePath, original);
  const playwright = command("const fs = require('fs'); const arg = process.argv.slice(1).find(arg => arg.startsWith('--last-failed-file=')); const state = arg.slice('--last-failed-file='.length); if (!state.startsWith(process.env.ZING_E2E_RUN_DIR) || JSON.parse(fs.readFileSync(state, 'utf8')).failedTests[0] !== 'previous-failure') process.exit(99); fs.writeFileSync(state, JSON.stringify({ status: 'passed', failedTests: [] }));");
  for (const fileArgs of [['--last-failed-file', statePath], [`--last-failed-file=${statePath}`]]) {
    assert.equal(await runE2E(['--last-failed', ...fileArgs], { root: path, build, playwright }), 0);
    assert.equal(readFileSync(statePath, 'utf8'), original);
  }
});

test('unavailable initial Git state prevents building and never claims unchanged source', async t => {
  const path = temporary(t);
  rmSync(join(path, '.git'), { recursive: true });
  assert.equal(await runE2E([], { root: path, build }), 1);
  assert.equal(existsSync(join(path, 'dist')), false);
  assert.equal(existsSync(join(path, 'test-results', '.e2e.lock')), false);
  const report = reports(path)[0];
  assert.equal(report.status, 'source-unverified');
  assert.equal(report.build.status, 'not-started');
  assert.equal(report.sourceChangedDuringRun, null);
  assert.ok(report.git.error);
});

test('unavailable final Git state invalidates an otherwise successful test run', async t => {
  const path = temporary(t);
  assert.equal(await runE2E([], { root: path, build,
    playwright: command("require('fs').rmSync('.git', { recursive: true })") }), 1);
  const report = reports(path)[0];
  assert.equal(report.status, 'source-unverified');
  assert.equal(report.playwrightExitCode, 0);
  assert.equal(report.sourceChangedDuringRun, null);
  assert.ok(report.gitAfter.error);
});

test('tracked and untracked source edits invalidate an otherwise successful run', async t => {
  for (const file of ['.gitignore', 'new-source.ts']) {
    const path = temporary(t);
    assert.equal(await runE2E([], { root: path, build,
      playwright: command(`require('fs').appendFileSync(${JSON.stringify(file)}, '\\nchanged')`) }), 1);
    const report = reports(path)[0];
    assert.equal(report.status, 'source-changed');
    assert.equal(report.sourceChangedDuringRun, true);
  }
});

test('live and malformed locks fail fast; release only removes its own lock', t => {
  const path = temporary(t);
  const release = acquireLock(path, path);
  assert.throws(() => acquireLock(path, path), /E2E is locked.*PID/s);
  const lockPath = join(path, 'test-results', '.e2e.lock');
  writeFileSync(lockPath, '{}');
  release();
  assert.ok(existsSync(lockPath));
  assert.throws(() => acquireLock(path, path), /owner is unknown/);
  writeFileSync(lockPath, JSON.stringify({ pid: 2147483647, hostname: hostname() }));
  assert.throws(() => acquireLock(path, path), /owner is no longer running.*rm --/s);
});

test('a competing runner fails without starting build and retains a rejection report', async t => {
  const path = temporary(t);
  const release = acquireLock(path, path);
  try {
    assert.equal(await runE2E([], { root: path, build: command("require('fs').writeFileSync('build-started', '')") }), 1);
    assert.equal(existsSync(join(path, 'build-started')), false);
    assert.equal(reports(path)[0].status, 'lock-rejected');
  } finally { release(); }
});

test('dist mutations during a test run invalidate otherwise successful results', async t => {
  const path = temporary(t);
  const code = await runE2E([], { root: path, build,
    playwright: command("require('fs').writeFileSync('dist/app.js', 'changed')") });
  assert.equal(code, 1);
  assert.equal(reports(path)[0].status, 'dist-changed');
  assert.equal(reports(path)[0].distAfter.changedDuringRun, true);
});

test('SIGTERM stops the child and releases the lock before exiting', { timeout: 10_000 }, async t => {
  const path = temporary(t);
  const childCode = "process.stdout.write('CHILD_READY\\n'); setInterval(() => {}, 1000)";
  const source = `import { runE2E } from ${JSON.stringify(join(root, 'scripts', 'run-e2e.ts'))}; process.exitCode = await runE2E([], ${JSON.stringify({ root: path, build: command(childCode), playwright: command('process.exit(0)') })});`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let output = '';
  child.stdout.on('data', data => {
    output += data.toString();
    if (output.includes('CHILD_READY')) child.kill('SIGTERM');
  });
  const code = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  assert.equal(code, 143);
  assert.equal(existsSync(join(path, 'test-results', '.e2e.lock')), false);
  assert.equal(reports(path)[0].status, 'interrupted');
});

function fakeTest(id: string, outcome: ReturnType<TestCase['outcome']> = 'expected', expectedStatus: TestCase['expectedStatus'] = 'passed'): TestCase {
  return { id, titlePath: () => ['suite', id], location: { file: 'focused.spec.ts', line: 1, column: 1 }, expectedStatus,
    annotations: [], outcome: () => outcome } as unknown as TestCase;
}
function fakeResult(status: TestResult['status'], annotations: TestResult['annotations'] = []): TestResult {
  return { retry: 0, status, duration: 12, errors: status === 'failed' ? [{ message: 'failure' }] : [], annotations, attachments: [] } as unknown as TestResult;
}
const config = { rootDir: root, version: 'test', workers: 1, projects: [] } as unknown as FullConfig;
const result = { status: 'passed', duration: 100, startTime: new Date() } as FullResult;

test('reporter records selected, executed, skipped, failure and browser annotation evidence', t => {
  const path = temporary(t);
  const reporter = new ValidationReporter({ directory: path });
  const tests = [fakeTest('pass'), fakeTest('fail', 'unexpected'), fakeTest('skip', 'skipped', 'skipped'), fakeTest('not-reached')];
  reporter.onBegin(config, { allTests: () => tests } as Suite);
  reporter.onTestBegin(tests[0]);
  reporter.onTestEnd(tests[0], fakeResult('passed', [{ type: 'browser-version', description: 'Chromium 123' }]));
  reporter.onTestBegin(tests[1]);
  reporter.onTestEnd(tests[1], fakeResult('failed'));
  reporter.onTestEnd(tests[2], fakeResult('skipped', [{ type: 'skip', description: 'Vimium unavailable' }]));
  reporter.onError({ message: 'worker error' });
  reporter.onEnd({ ...result, status: 'failed' });
  const report = JSON.parse(readFileSync(join(path, 'validation.json'), 'utf8'));
  assert.deepEqual(report.results.counts, { selected: 4, executed: 2, skipped: 1, failed: 1, flaky: 0, notRun: 1 });
  assert.equal(report.results.tests[0].attempts[0].annotations[0].description, 'Chromium 123');
  assert.equal(report.results.tests[2].annotations[0].description, 'Vimium unavailable');
  assert.deepEqual(report.results.errors, ['worker error']);
});

test('reporter distinguishes blocked tests from intentional skips and retains artifact paths', t => {
  const path = temporary(t);
  const reporter = new ValidationReporter({ directory: path });
  const tests = [fakeTest('blocked-after-setup-failure', 'skipped'), fakeTest('intentional-skip', 'skipped', 'skipped'), fakeTest('failure', 'unexpected')];
  reporter.onBegin(config, { allTests: () => tests } as Suite);
  for (const test of tests.slice(0, 2)) {
    reporter.onTestBegin(test);
    reporter.onTestEnd(test, fakeResult('skipped'));
  }
  const failed = fakeResult('failed');
  failed.attachments = [{ name: 'native-window-lifecycle', contentType: 'application/json', path: join(path, 'lifecycle.json') }];
  reporter.onTestBegin(tests[2]);
  reporter.onTestEnd(tests[2], failed);
  reporter.onEnd({ ...result, status: 'failed' });
  const report = JSON.parse(readFileSync(join(path, 'validation.json'), 'utf8'));
  assert.deepEqual(report.results.counts, { selected: 3, executed: 1, skipped: 1, failed: 1, flaky: 0, notRun: 1 });
  assert.equal(report.results.tests[0].notRun, true);
  assert.equal(report.results.tests[0].skipped, false);
  assert.deepEqual(report.results.tests[2].attempts[0].attachments, failed.attachments);
});

test('list mode enumerates tests without claiming execution, skips or success', t => {
  const path = temporary(t);
  const reporter = new ValidationReporter({ directory: path, listOnly: true });
  reporter.onBegin(config, { allTests: () => [fakeTest('pass'), fakeTest('skip', 'skipped', 'skipped')] } as Suite);
  reporter.onEnd(result);
  const report = JSON.parse(readFileSync(join(path, 'validation.json'), 'utf8'));
  assert.equal(report.build.status, 'unverified');
  assert.equal(report.results.status, 'listed');
  assert.deepEqual(report.results.counts, { selected: 2, executed: 0, skipped: 0, failed: 0, flaky: 0, notRun: 0 });
});

test('runner refuses overrides that would bypass its validation contract', async t => {
  const path = temporary(t);
  assert.equal(await runE2E(['--reporter=json'], { root: path }), 2);
  assert.equal(existsSync(join(path, 'test-results')), false);
});
