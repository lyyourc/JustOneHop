export function hasControlFocus(scope: HTMLElement): boolean {
  const root = scope.getRootNode() as Document | ShadowRoot;
  const focused = root.activeElement as HTMLElement | null;
  return !!focused && scope.contains(focused) && !focused.closest('[inert]') &&
    !focused.hasAttribute('disabled') && (focused.matches('input, textarea, select, button, a[href], [contenteditable="true"]') || focused.tabIndex >= 0);
}

export function availableSearchInput(root: HTMLElement): HTMLInputElement | undefined {
  const dialog = [...root.querySelectorAll<HTMLElement>('[aria-modal="true"]')].at(-1);
  return [...(dialog || root).querySelectorAll<HTMLInputElement>('input[data-back-on-empty]')]
    .find(node => !node.disabled && !node.closest('[inert]') && node.getClientRects().length > 0);
}
