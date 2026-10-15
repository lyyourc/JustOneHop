// Observational benchmark: run with ./node_modules/.bin/tsx tests/search-benchmark.ts.
// Synthetic data only; results are comparable on the same machine, not a UI SLA.
import { entries, search } from '../src/model.ts';

for (const size of [1000, 5000]) {
  const items = entries({
    windowId: 1, currentTabId: 1, shortcut: '',
    tabs: Array.from({ length: 100 }, (_, i) => ({
      id: i + 1, windowId: 1, index: i, title: `Workspace ${i} dashboard`,
      url: `https://app.example.test/${i}`, active: i === 0, pinned: false, muted: false, audible: false,
    })),
    bookmarks: Array.from({ length: size }, (_, i) => ({
      id: String(i), title: `Reference ${i} developer documentation`,
      url: `https://docs.example.test/${i}`, folder: 'Engineering',
    })),
  });
  const samples: number[] = [];
  for (let i = 0; i < 24; i++) {
    const start = performance.now();
    search(items, ['ref', 'refer', 'reference', 'reference 42', 'new tab', 'iam'][i % 6]);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({ size, medianMs: Math.round(samples[12]), p95Ms: Math.round(samples[22]), maxMs: Math.round(samples[23]) }));
}
