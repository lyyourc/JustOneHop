import { createContext } from 'react';

// Keep the overlay mounted for the entire binding guide lifetime.
// The returned callback releases retention when the guide is left or unmounted.
export const BindingNavigation = createContext<() => () => void>(() => () => {});
