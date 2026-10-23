import { createContext } from 'react';

// Retain an overlay while a task needs another tab. Release when that task ends.
export const OverlayRetention = createContext<() => () => void>(() => () => {});
