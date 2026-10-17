import { useLayoutEffect, useRef, useState } from 'react';
import { nearbySelection } from './paletteActions';

export function useResultSelection<T extends { id: string }>(items: T[], query: string, sourceId?: number, initial: string | null = '') {
  const [selection, setSelection] = useState<string | null>(initial);
  const previous = useRef<{ ids: string[]; query: string; sourceId?: number }>({ ids: [], query, sourceId });
  const sourceChanged = previous.current.sourceId !== undefined && sourceId !== previous.current.sourceId;
  const id = sourceChanged ? null : !items.length && !previous.current.ids.length && query === previous.current.query ? selection
    : nearbySelection(previous.current.ids, items.map(item => item.id), query !== previous.current.query ? '' : selection);
  useLayoutEffect(() => {
    previous.current = { ids: items.map(item => item.id), query, sourceId };
    if (id !== selection) setSelection(id);
  });
  return { selected: items.find(item => item.id === id), selection: id, setSelection };
}
