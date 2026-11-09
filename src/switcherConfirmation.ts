/** Confirmation is synchronous even when React has not rendered the busy state.
 * Loading, search mode and IME composition are independent input conditions.
 * Closing is terminal: a late Chrome reply cannot reopen or close another view.
 */
export class SwitcherConfirmation {
  private phase: 'selecting' | 'confirming' | 'returning-focus' | 'closed' = 'selecting';

  get canSelect() { return this.phase === 'selecting'; }
  get closed() { return this.phase === 'closed'; }
  get returningFocus() { return this.phase === 'returning-focus'; }

  begin() {
    if (!this.canSelect) return false;
    this.phase = 'confirming';
    return true;
  }

  returnFocus() {
    if (this.phase !== 'confirming') return false;
    this.phase = 'returning-focus';
    return true;
  }

  fail() {
    if (this.phase !== 'confirming' && this.phase !== 'returning-focus') return false;
    this.phase = 'selecting';
    return true;
  }

  close() { this.phase = 'closed'; }
}
