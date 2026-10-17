import { useEffect, useRef, useState } from 'react';
import { searchHistory } from './api';
import { resolveHistoryQuery, type HistoryQueryOutcome } from './historyQuery';

const empty: HistoryQueryOutcome = { items: [], limited: false, state: 'ready' };

export function useHistoryQuery(query: string, scope: 'week' | 'all', enabled = true) {
  const [attempt, retry] = useState(0);
  const active = enabled && !!query.trim();
  const key = `${scope}:${active}:${attempt}:${query}`;
  const current = useRef({ key });
  if (current.current.key !== key) current.current = { key };
  const request = current.current;
  const [result, setResult] = useState<{ request: typeof request; outcome: HistoryQueryOutcome }>();
  const pending = active && result?.request !== request;
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void resolveHistoryQuery(searchHistory(query, scope), scope === 'week' ? 100 : 15000).then(outcome => {
      if (alive && current.current === request) setResult({ request, outcome });
    });
    return () => { alive = false; };
  }, [request]);
  return { outcome: active ? result?.outcome ?? empty : empty, pending, retry: () => retry(value => value + 1) };
}
