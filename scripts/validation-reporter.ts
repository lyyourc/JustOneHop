import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestError, TestResult } from '@playwright/test/reporter';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { environment, gitState, hashDirectory, now, updateValidation } from './validation.ts';

interface Attempt {
  retry: number;
  status: TestResult['status'];
  durationMs: number;
  errors: string[];
  annotations: TestCase['annotations'];
  attachments: { name: string; contentType: string; path?: string }[];
}
interface RecordEntry {
  id: string;
  title: string[];
  location: TestCase['location'];
  expectedStatus: TestCase['expectedStatus'];
  annotations: TestCase['annotations'];
  attempts: Attempt[];
  started: boolean;
}

export default class ValidationReporter implements Reporter {
  private tests = new Map<string, RecordEntry>();
  private errors: string[] = [];
  private suite?: Suite;
  private listOnly = process.env.JUSTONEHOP_E2E_MODE === 'list' || process.argv.includes('--list');
  private directory: string;

  constructor(options: { directory?: string; listOnly?: boolean } = {}) {
    this.directory = options.directory ?? process.env.JUSTONEHOP_E2E_RUN_DIR!;
    if (options.listOnly !== undefined) this.listOnly = options.listOnly;
  }

  printsToStdio() { return false; }

  onBegin(config: FullConfig, suite: Suite) {
    this.suite = suite;
    if (!process.env.JUSTONEHOP_E2E_RUNNER) {
      const root = config.rootDir.endsWith('/tests') ? join(config.rootDir, '..') : config.rootDir;
      const dist = join(root, 'dist');
      console.warn('Direct Playwright invocation: build freshness is unverified. Use npm run test:e2e -- <selectors> for a fresh build and coordinated browser execution.');
      updateValidation(this.directory, {
        schemaVersion: 1, startedAt: now(), mode: this.listOnly ? 'list' : 'run', command: process.argv,
        git: gitState(root), environment: environment(), build: { status: 'unverified' },
        dist: { path: dist, hash: existsSync(dist) ? hashDirectory(dist) : null, freshlyBuilt: false },
      });
    }
    for (const test of suite.allTests()) {
      this.tests.set(test.id, { id: test.id, title: test.titlePath(), location: test.location,
        expectedStatus: test.expectedStatus, annotations: [...test.annotations], attempts: [], started: false });
    }
    updateValidation(this.directory, {
      playwright: { version: config.version, workers: config.workers, maxFailures: config.maxFailures, projects: config.projects.map(project => ({ name: project.name, outputDir: project.outputDir, retries: project.retries })) },
    });
    this.save('running');
  }

  onTestBegin(test: TestCase) {
    const entry = this.tests.get(test.id);
    if (entry) entry.started = true;
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const entry = this.tests.get(test.id)!;
    entry.expectedStatus = test.expectedStatus;
    entry.annotations = [...result.annotations];
    entry.attempts.push({ retry: result.retry, status: result.status, durationMs: result.duration,
      errors: result.errors.map(error => error.message ?? String(error.value)), annotations: [...result.annotations],
      attachments: result.attachments.map(({ name, contentType, path }) => ({ name, contentType, ...(path ? { path } : {}) })) });
    this.save('running');
  }

  onError(error: TestError) {
    this.errors.push(error.message ?? String(error.value));
    this.save('error');
  }

  onEnd(result: FullResult) {
    this.save(this.listOnly && result.status === 'passed' ? 'listed' : result.status, result);
  }

  private save(status: string, result?: FullResult) {
    const outcomes = new Map(this.suite?.allTests().map(test => [test.id, test.outcome()]));
    const tests = [...this.tests.values()].map(test => {
      const final = test.attempts.at(-1);
      const outcome = outcomes.get(test.id);
      return { ...test, outcome: final ? outcome : null,
        executed: test.attempts.some(attempt => attempt.status !== 'skipped'),
        skipped: !this.listOnly && (!final || final.status === 'skipped') && test.expectedStatus === 'skipped',
        failed: outcome === 'unexpected' || outcome === 'flaky',
        notRun: !this.listOnly && (!final || final.status === 'skipped') && test.expectedStatus !== 'skipped',
      };
    });
    updateValidation(this.directory, {
      results: {
        status, listOnly: this.listOnly, ...(result ? { durationMs: result.duration } : {}),
        counts: { selected: tests.length, executed: tests.filter(test => test.executed).length,
          skipped: tests.filter(test => test.skipped).length, failed: tests.filter(test => test.failed).length,
          flaky: tests.filter(test => test.outcome === 'flaky').length, notRun: tests.filter(test => test.notRun).length },
        tests, errors: this.errors,
      },
      ...(result ? { finishedAt: now() } : {}),
    });
  }
}
