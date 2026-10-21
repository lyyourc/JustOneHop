import { open, readFile, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

// Run-scoped cross-process ownership; browser profiles do not isolate the OS clipboard.
export async function acquireResource(path: string, timeout = 120_000): Promise<() => Promise<void>> {
  const started = performance.now();
  while (true) {
    try {
      const file = await open(path, 'wx');
      try { await file.writeFile(String(process.pid)); }
      finally { await file.close(); }
      // Repeated cleanup must not remove a lock acquired by the next owner.
      let released: Promise<void> | undefined;
      return () => released ??= rm(path, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const pid = Number(await readFile(path, 'utf8'));
        if (Number.isInteger(pid) && pid > 0) {
          try { process.kill(pid, 0); }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ESRCH') throw new Error(`Shared test resource owner ${pid} exited: ${path}`);
            else throw error;
          }
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (performance.now() - started >= timeout) throw new Error(`Timed out waiting for shared test resource: ${path}`);
      await delay(25);
    }
  }
}
