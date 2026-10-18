import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock, createRunDirectory, environment, gitState, hashDirectory, now, updateValidation } from './validation.ts';

interface Command { executable: string; args: string[] }
interface RunnerOptions { root?: string; build?: Command; playwright?: Command }

export async function runE2E(args: string[], options: RunnerOptions = {}): Promise<number> {
  // These switches would bypass the reporter/output contract. Other Playwright selectors pass through unchanged.
  if (args.some(arg => /^(--(?:config|reporter|output)|-c)(?:=|$)/.test(arg) || /^-c.+/.test(arg))) {
    console.error('Use the repository Playwright config, reporter and output directory. Pass test files, --grep, --project, --list or other selectors to npm run test:e2e -- instead.');
    return 2;
  }
  const root = options.root ?? resolve(fileURLToPath(new URL('..', import.meta.url)));
  const playwrightArgs = [...args];
  const reuseOptions = args.filter(arg => arg === '--reuse-build' || arg.startsWith('--reuse-build='));
  const reuseIndex = args.findIndex(arg => arg === '--reuse-build' || arg.startsWith('--reuse-build='));
  const reusePath = reuseIndex < 0 ? undefined : args[reuseIndex] === '--reuse-build' ? args[reuseIndex + 1] : args[reuseIndex].slice('--reuse-build='.length);
  if (reuseOptions.length > 1 || (reuseIndex >= 0 && (!reusePath || reusePath.startsWith('-')))) {
    console.error('Use one --reuse-build <previous validation.json> to verify and reuse a prior build.');
    return 2;
  }
  if (reuseIndex >= 0) playwrightArgs.splice(reuseIndex, args[reuseIndex] === '--reuse-build' ? 2 : 1);
  const lastFailedOptions = args.filter(arg => arg === '--last-failed-file' || arg.startsWith('--last-failed-file='));
  if (lastFailedOptions.length > 1 || (lastFailedOptions.length && !args.includes('--last-failed'))) {
    console.error('Use exactly one --last-failed-file together with --last-failed.');
    return 2;
  }
  const lastFailedIndex = args.findIndex(arg => arg === '--last-failed-file' || arg.startsWith('--last-failed-file='));
  let lastFailedContent: string | undefined;
  if (args.includes('--last-failed')) {
    const file = lastFailedIndex < 0 ? undefined : args[lastFailedIndex] === '--last-failed-file' ? args[lastFailedIndex + 1] : args[lastFailedIndex].slice('--last-failed-file='.length);
    try {
      if (!file) throw new Error('missing --last-failed-file');
      lastFailedContent = readFileSync(resolve(root, file), 'utf8');
      const state = JSON.parse(lastFailedContent);
      if (!state || !['passed', 'failed', 'timedout', 'interrupted'].includes(state.status)
        || !Array.isArray(state.failedTests) || !state.failedTests.every((id: unknown) => typeof id === 'string')) {
        throw new Error('invalid last-run JSON');
      }
    } catch (error) {
      console.error(`--last-failed requires an explicit --last-failed-file pointing to a valid previous run artifacts/.last-run.json: ${String(error)}`);
      return 2;
    }
  }
  const directory = createRunDirectory(root);
  if (lastFailedContent !== undefined) {
    const copiedState = join(directory, 'last-failed.json');
    writeFileSync(copiedState, lastFailedContent);
    const index = playwrightArgs.findIndex(arg => arg === '--last-failed-file' || arg.startsWith('--last-failed-file='));
    playwrightArgs.splice(index, playwrightArgs[index] === '--last-failed-file' ? 2 : 1, `--last-failed-file=${copiedState}`);
  }
  const build = options.build ?? { executable: process.execPath, args: [join(root, 'build.mjs')] };
  const playwright = options.playwright ?? { executable: process.execPath, args: [join(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test'] };
  const mode = args.includes('--list') ? 'list' : args.some(arg => arg === '--help' || arg === '-h') ? 'help' : 'run';
  updateValidation(directory, {
    schemaVersion: 1, startedAt: now(), mode, command: ['npm', 'run', 'test:e2e', '--', ...args], cwd: root,
    environment: environment(), status: 'starting', build: { status: 'not-started', command: [build.executable, ...build.args] },
  });
  console.log(`E2E validation: ${join(directory, 'validation.json')}`);
  const started = performance.now();
  const timings: Record<string, number> = {};
  async function timed<T>(phase: string, action: () => T | Promise<T>): Promise<T> {
    const start = performance.now();
    try { return await action(); }
    finally { timings[phase] = Math.round(performance.now() - start); }
  }
  let release: (() => void) | undefined;
  let interrupted: NodeJS.Signals | undefined;
  let activeChild: ReturnType<typeof spawn> | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const signalChild = (signal: NodeJS.Signals) => {
    if (!activeChild?.pid) return;
    try {
      if (process.platform === 'win32') activeChild.kill(signal);
      else process.kill(-activeChild.pid, signal);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  };
  const interrupt = (signal: NodeJS.Signals) => {
    interrupted = signal;
    signalChild(signal);
    if (!killTimer) killTimer = setTimeout(() => signalChild('SIGKILL'), 3000);
  };
  const onInt = () => interrupt('SIGINT');
  const onTerm = () => interrupt('SIGTERM');
  const execute = (command: Command, extraArgs: string[] = []) => new Promise<number>((done, reject) => {
    activeChild = spawn(command.executable, [...command.args, ...extraArgs], {
      cwd: root, stdio: 'inherit', detached: process.platform !== 'win32',
      env: { ...process.env, JUSTONEHOP_E2E_RUN_DIR: directory, JUSTONEHOP_E2E_RUNNER: '1', JUSTONEHOP_E2E_MODE: mode },
    });
    activeChild.once('error', reject);
    activeChild.once('close', (code, signal) => {
      activeChild = undefined;
      if (killTimer) { clearTimeout(killTimer); killTimer = undefined; }
      done(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1));
    });
  });
  try {
    process.on('SIGINT', onInt);
    process.on('SIGTERM', onTerm);
    // Discovery loads test declarations only; it neither reads nor writes dist/.
    if (mode !== 'run') {
      updateValidation(directory, { status: mode === 'list' ? 'listing' : 'help', build: { status: 'not-required' } });
      const exitCode = await timed('discoveryMs', () => execute(playwright, playwrightArgs));
      const finalExitCode = interrupted ? interrupted === 'SIGINT' ? 130 : 143 : exitCode;
      updateValidation(directory, { status: interrupted ? 'interrupted' : exitCode !== 0 ? 'failed' : mode === 'list' ? 'listed' : 'help',
        exitCode: finalExitCode, playwrightExitCode: exitCode });
      return finalExitCode;
    }
    release = acquireLock(root, directory);
    const initialGit = await timed('sourceBeforeMs', () => gitState(root));
    if (initialGit.error) {
      console.error(`Cannot verify source state: ${initialGit.error}`);
      updateValidation(directory, { git: initialGit, status: 'source-unverified', exitCode: 1, sourceChangedDuringRun: null, error: initialGit.error });
      return 1;
    }
    const dist = join(root, 'dist');
    let distHash: string;
    updateValidation(directory, { git: initialGit });
    if (reusePath) {
      try {
        distHash = await timed('reuseCheckMs', () => {
          const prior = JSON.parse(readFileSync(resolve(root, reusePath), 'utf8'));
          if (prior.mode !== 'run' || !['completed', 'failed'].includes(prior.status)
            || !['passed', 'reused'].includes(prior.build?.status) || prior.cwd !== root
            || prior.sourceChangedDuringRun !== false || prior.distAfter?.changedDuringRun !== false
            || prior.git?.head !== initialGit.head || prior.git?.stateHash !== initialGit.stateHash) {
            throw new Error('Previous run must verify the same repository, HEAD and working tree.');
          }
          const hash = hashDirectory(dist);
          if (hash !== prior.dist?.hash || hash !== prior.distAfter.hash) throw new Error('dist/ differs from the verified build.');
          return hash;
        });
      } catch (error) {
        console.error(`Build reuse rejected: ${String(error)}`);
        updateValidation(directory, { status: 'reuse-rejected', exitCode: 1, error: String(error) });
        return 1;
      }
      updateValidation(directory, { build: { status: 'reused', from: resolve(root, reusePath) } });
    } else {
      updateValidation(directory, { status: 'building', build: { status: 'running', command: [build.executable, ...build.args] } });
      const buildCode = await timed('buildMs', () => execute(build));
      updateValidation(directory, { build: { status: buildCode === 0 ? 'passed' : 'failed', exitCode: buildCode, command: [build.executable, ...build.args] } });
      if (buildCode !== 0 || interrupted) {
        const exitCode = interrupted ? interrupted === 'SIGINT' ? 130 : 143 : buildCode;
        updateValidation(directory, { status: interrupted ? 'interrupted' : 'build-failed', exitCode });
        return exitCode;
      }
      if (!existsSync(dist)) throw new Error('Build completed without dist/. Playwright was not started.');
      distHash = await timed('distBeforeMs', () => hashDirectory(dist));
    }
    updateValidation(directory, { dist: { path: dist, hash: distHash, algorithm: 'sha256', freshlyBuilt: !reusePath }, status: 'running' });
    const exitCode = await timed('testsMs', () => execute(playwright, playwrightArgs));
    const finalDistHash = await timed('distAfterMs', () => hashDirectory(dist));
    const distChanged = finalDistHash !== distHash;
    const finalGit = await timed('sourceAfterMs', () => gitState(root));
    const sourceChanged = finalGit.error ? null : initialGit.head !== finalGit.head || initialGit.stateHash !== finalGit.stateHash;
    if (finalGit.error) console.error(`Cannot verify final source state: ${finalGit.error}`);
    if (distChanged || sourceChanged) console.error('Source or dist/ changed during validation. This run cannot validate one revision/build; stop other edits/build/watch processes and retry.');
    const finalExitCode = interrupted ? interrupted === 'SIGINT' ? 130 : 143 : exitCode || (distChanged || sourceChanged || finalGit.error ? 1 : 0);
    updateValidation(directory, {
      status: interrupted ? 'interrupted' : finalGit.error ? 'source-unverified' : distChanged ? 'dist-changed' : sourceChanged ? 'source-changed' : exitCode !== 0 ? 'failed' : 'completed',
      exitCode: finalExitCode, playwrightExitCode: exitCode, gitAfter: finalGit, sourceChangedDuringRun: sourceChanged,
      distAfter: { hash: finalDistHash, changedDuringRun: distChanged },
      ...(finalGit.error ? { error: finalGit.error } : {}),
    });
    return finalExitCode;
  } catch (error) {
    console.error(String(error));
    updateValidation(directory, { status: mode !== 'run' || release ? 'runner-error' : 'lock-rejected', exitCode: 1, error: String(error) });
    return 1;
  } finally {
    if (killTimer) clearTimeout(killTimer);
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
    release?.();
    timings.totalMs = Math.round(performance.now() - started);
    updateValidation(directory, { finishedAt: now(), timings, ...(interrupted ? { signal: interrupted } : {}) });
    console.log(`Validation timing: ${Object.entries(timings).map(([phase, ms]) => `${phase}=${ms}ms`).join(', ')}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runE2E(process.argv.slice(2));
}
