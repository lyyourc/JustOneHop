import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, lstatSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname, release } from 'node:os';
import { join, relative, resolve } from 'node:path';

export type Validation = Record<string, unknown>;
export const now = () => new Date().toISOString();
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export function createRunDirectory(root: string): string {
  const directory = join(root, 'test-results', 'runs', `${now().replace(/[:.]/g, '-')}-${process.pid}-${randomUUID().slice(0, 8)}`);
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function updateValidation(directory: string, changes: Validation): void {
  const path = join(directory, 'validation.json');
  const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Validation : {};
  writeFileSync(path, `${JSON.stringify({ ...previous, ...changes }, null, 2)}\n`);
}

export function hashDirectory(directory: string): string {
  const hash = createHash('sha256');
  function walk(path: string) {
    for (const entry of readdirSync(path).sort()) {
      const fullPath = join(path, entry);
      const stat = lstatSync(fullPath);
      if (stat.isDirectory()) walk(fullPath);
      else {
        const content = stat.isSymbolicLink() ? Buffer.from(readlinkSync(fullPath)) : readFileSync(fullPath);
        hash.update(JSON.stringify([relative(directory, fullPath), stat.isSymbolicLink() ? 'link' : 'file', content.length]));
        hash.update(content);
      }
    }
  }
  walk(directory);
  return hash.digest('hex');
}

export function gitState(root: string) {
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    const status = git('status', '--porcelain=v1', '-z');
    const diff = git('diff', 'HEAD', '--binary');
    const hash = createHash('sha256').update(status).update(diff);
    for (const file of git('ls-files', '--others', '--exclude-standard', '-z').toString().split('\0').filter(Boolean).sort()) {
      const path = join(root, file);
      const content = lstatSync(path).isSymbolicLink() ? Buffer.from(readlinkSync(path)) : readFileSync(path);
      hash.update(JSON.stringify([file, content.length])).update(content);
    }
    return { head: git('rev-parse', 'HEAD').toString().trim(), dirty: status.length > 0,
      status: status.toString().split('\0').filter(Boolean), diffHash: digest(diff), stateHash: hash.digest('hex') };
  } catch (error) {
    return { error: String(error) };
  }
}

export function environment() {
  return { node: process.version, platform: process.platform, arch: process.arch, osRelease: release(), hostname: hostname(), ci: Boolean(process.env.CI) };
}

export function acquireLock(root: string, runDirectory: string): () => void {
  const path = join(root, 'test-results', '.e2e.lock');
  mkdirSync(join(root, 'test-results'), { recursive: true });
  const token = randomUUID();
  let descriptor: number;
  try {
    descriptor = openSync(path, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    let owner: { pid?: number; hostname?: string; startedAt?: string; runDirectory?: string } = {};
    try { owner = JSON.parse(readFileSync(path, 'utf8')); } catch { /* A concurrent writer may still be initializing the lock. */ }
    let alive = true;
    if (Number.isInteger(owner.pid) && owner.pid! > 0 && owner.hostname === hostname()) {
      try { process.kill(owner.pid!, 0); }
      catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
    }
    const details = `PID ${owner.pid ?? 'unknown'}, host ${owner.hostname ?? 'unknown'}, started ${owner.startedAt ?? 'unknown'}; artifacts: ${owner.runDirectory ?? 'unknown'}`;
    const advice = alive
      ? 'Wait for that run to finish or stop its process. If the owner is unknown, verify no E2E/Chrome processes remain before removing the lock.'
      : 'The recorded owner is no longer running. Verify no orphan E2E/Chrome processes remain, then remove the stale lock and retry.';
    throw new Error(`E2E is locked (${details}). ${advice}\nLock: ${path}\nCleanup after verification: rm -- '${path.replaceAll("'", "'\\''")}'`);
  }
  try { writeFileSync(descriptor, JSON.stringify({ token, pid: process.pid, hostname: hostname(), startedAt: now(), runDirectory: resolve(runDirectory) })); }
  catch (error) { unlinkSync(path); throw error; }
  finally { closeSync(descriptor); }
  return () => {
    try {
      if ((JSON.parse(readFileSync(path, 'utf8')) as { token?: string }).token === token) unlinkSync(path);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  };
}
