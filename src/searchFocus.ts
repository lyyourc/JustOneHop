export function hasControlFocus(scope: HTMLElement): boolean {
  const root = scope.getRootNode() as Document | ShadowRoot;
  const focused = root.activeElement as HTMLElement | null;
  return !!focused && scope.contains(focused) && !focused.closest('[inert]') &&
    !focused.hasAttribute('disabled') && (focused.matches('input, textarea, select, button, a[href], [contenteditable="true"]') || focused.tabIndex >= 0);
}

export function availableSearchButton(root: HTMLElement): HTMLButtonElement | undefined {
  const dialog = [...root.querySelectorAll<HTMLElement>('[aria-modal="true"]')].at(-1);
  return [...(dialog || root).querySelectorAll<HTMLButtonElement>('[data-focus-search]')]
    .find(node => !node.disabled && !node.closest('[inert]') && node.getClientRects().length > 0);
}
