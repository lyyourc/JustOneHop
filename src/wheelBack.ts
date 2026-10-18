// Wheel input has no finger-up event. Keep ownership through the quiet period
// after returning so the momentum tail cannot dismiss another layer.
export const WHEEL_BACK_IDLE_MS = 140;
export const WHEEL_BACK_THRESHOLD = 100;

type Ownership = 'pending' | 'scroll' | 'back';
export class WheelBackGesture {
  private ownership: Ownership = 'pending';
  private x = 0;
  private y = 0;
  private reverse = 0;
  private armed = false;
  private cancelled = false;
  private consumed = false;

  consume() {
    if (this.ownership !== 'back' || !this.armed || this.cancelled || this.consumed) return false;
    this.consumed = true;
    return true;
  }

  block() { this.ownership = 'scroll'; this.armed = false; }

  update(dx: number, dy: number, excluded = false) {
    if (this.consumed) return { capture: true, progress: 0 };
    if (excluded) this.block();
    if (this.ownership === 'scroll') return { capture: false, progress: 0 };
    this.x += dx;
    this.y += Math.abs(dy);
    if (this.ownership === 'pending') {
      // Claim horizontal input immediately so Chrome cannot begin history
      // navigation while we wait for the distance threshold.
      if (dx < 0 && Math.abs(dx) > Math.abs(dy) * 2) this.ownership = 'back';
      else if (dx !== 0 || dy !== 0) this.block();
    }
    if (this.ownership !== 'back') return { capture: false, progress: 0 };
    this.reverse += Math.max(0, dx);
    if (this.y > Math.abs(this.x) / 2 || this.reverse > 4) this.cancelled = true;
    if (this.cancelled) return { capture: true, progress: 0 };
    if (-this.x >= WHEEL_BACK_THRESHOLD) this.armed = true;
    return { capture: true, progress: this.armed ? 1 : Math.min(.99, Math.max(0, -this.x / WHEEL_BACK_THRESHOLD)) };
  }

  finish() {
    const back = this.consume();
    this.ownership = 'pending'; this.x = 0; this.y = 0; this.reverse = 0; this.armed = false; this.cancelled = false; this.consumed = false;
    return back;
  }
}

/** The whole sequence belongs to a horizontal reader, even at its boundary. */
export function wheelNeedsScrolling(event: WheelEvent, surface: HTMLElement) {
  const view = surface.ownerDocument.defaultView!;
  for (const target of event.composedPath()) {
    if (target === surface) break;
    // DOM constructors belong to the iframe, not the content-script realm.
    if (!(target instanceof view.Element)) continue;
    const element = target as HTMLElement;
    if (element.isContentEditable) return true;
    if (element.scrollWidth <= element.clientWidth + 1) continue;
    const overflow = view.getComputedStyle(element).overflowX;
    if (/^(auto|scroll)$/.test(overflow) || /^(INPUT|TEXTAREA)$/.test(element.tagName)) return true;
  }
  return false;
}
