import { gestureFromPath, type Gesture, type Point2 } from './ballistics';

export interface InputHandlers {
  onStart(p: Point2): void;
  onDrag(g: Gesture, p: Point2): void;
  onRelease(g: Gesture): void;
  onCancel(): void;
}

/** Swipe / mouse-flick capture. The shot fires when the finger or mouse button lifts. */
export class ShotInput {
  enabled = false;
  private path: (Point2 & { t: number })[] = [];
  private pointerId: number | null = null;

  constructor(el: HTMLElement, private h: InputHandlers) {
    el.addEventListener('pointerdown', this.down);
    window.addEventListener('pointermove', this.move, { passive: false });
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.cancel);
    el.addEventListener('touchstart', (e) => this.enabled && e.preventDefault(), { passive: false });
  }

  private down = (e: PointerEvent) => {
    if (!this.enabled || this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.path = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    this.h.onStart({ x: e.clientX, y: e.clientY });
  };

  private move = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    const now = performance.now();
    this.path.push({ x: e.clientX, y: e.clientY, t: now });
    if (this.path.length > 200) this.path.splice(1, 1);
    this.h.onDrag(this.gesture(), { x: e.clientX, y: e.clientY });
  };

  private up = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    const g = this.gesture();
    this.path = [];
    this.h.onRelease(g);
  };

  private cancel = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.path = [];
    this.h.onCancel();
  };

  /** Uses the stretch of the path from its lowest point, so wiggling down first doesn't count. */
  private gesture(): Gesture {
    let startIdx = 0;
    for (let i = 1; i < this.path.length; i++) if (this.path[i].y > this.path[startIdx].y) startIdx = i;
    return gestureFromPath(this.path.slice(startIdx), window.innerHeight);
  }

  get active(): boolean {
    return this.pointerId !== null;
  }
}
