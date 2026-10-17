import type { ActionId } from './types';

export function keepsPaletteOpen(action: ActionId, targetId: number | undefined, sourceId: number) {
  switch (action) {
    case 'close': case 'closeOthers': case 'closeRight': case 'pin': case 'mute':
    case 'undoTuck': case 'ungroupTab': case 'updateGroup': return true;
    case 'tuck': case 'reload': return targetId !== sourceId;
    default: return false;
  }
}

/** Keep identity across reordering; after removal prefer the next surviving row. */
export function nearbySelection(previous: string[], current: string[], selected: string | null): string | null {
  if (selected === null) return null;
  if (current.includes(selected)) return selected;
  const index = previous.indexOf(selected);
  if (index >= 0) {
    const remaining = new Set(current);
    for (const id of previous.slice(index + 1)) if (remaining.has(id)) return id;
    for (const id of previous.slice(0, index).reverse()) if (remaining.has(id)) return id;
  }
  return current[0] ?? '';
}
