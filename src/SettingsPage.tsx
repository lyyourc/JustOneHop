import { createContext, useContext, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { PaletteFooter } from './PaletteFooter';

// Settings owns the search, navigation and footer space; detail views keep
// their form state while search results temporarily cover their content.
export const SettingsPage = createContext<{ active: boolean; title: string; footer: HTMLElement | null } | null>(null);

export function SettingsPageFooter(props: ComponentProps<typeof PaletteFooter>) {
  const page = useContext(SettingsPage);
  if (!page) return <PaletteFooter {...props} />;
  return page.active && page.footer ? createPortal(<PaletteFooter {...props} title={page.title} />, page.footer) : null;
}
