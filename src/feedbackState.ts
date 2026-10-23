export type OperationStatus = { kind: 'pending' | 'success' | 'error'; message: string } | null;

/** One session owns feedback so returning from a view does not discard its result. */
export function createOperationFeedback() {
  let status: OperationStatus = null;
  let version = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  function publish(next: OperationStatus) { status = next; listeners.forEach(listener => listener()); }
  function cancelTimer() { clearTimeout(timer); }
  return {
    getSnapshot: () => status,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    begin(message: string) {
      const id = ++version;
      cancelTimer();
      timer = setTimeout(() => { if (id === version) publish({ kind: 'pending', message }); }, 150);
      return id;
    },
    success(id: number, message: string | null) {
      if (id !== version) return;
      cancelTimer();
      publish(message === null ? null : { kind: 'success', message });
      if (message !== null) timer = setTimeout(() => publish(null), 4000);
    },
    error(id: number, message: string) {
      if (id !== version) return;
      cancelTimer();
      publish({ kind: 'error', message });
    },
    dismiss() { ++version; cancelTimer(); publish(null); },
    dispose() { ++version; cancelTimer(); },
  };
}
