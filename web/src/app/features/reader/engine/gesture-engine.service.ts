import { Injectable, OnDestroy } from '@angular/core';

export type GestureType =
  | 'swipe-next'
  | 'swipe-prev'
  | 'tap';

export interface GestureEvent {
  type: GestureType;
  scale?: number;
  deltaX?: number;
  deltaY?: number;
  x?: number;
  y?: number;
}

type GestureCb = (e: GestureEvent) => void;

interface VelocityPoint { x: number; y: number; t: number; }

/**
 * Handles touch input for the reader and emits semantic gestures.
 */
@Injectable({ providedIn: 'root' })
export class GestureEngineService implements OnDestroy {
  private element: HTMLElement | null = null;
  private callback: GestureCb | null = null;

  private startX = 0;
  private startY = 0;
  private lastTapTime = 0;
  private velPoints: VelocityPoint[] = [];
  private touch0: Touch | null = null;

  // Keep bound refs so can remove listeners correctly.
  private onStartBound!: (e: TouchEvent) => void;
  private onMoveBound!:  (e: TouchEvent) => void;
  private onEndBound!:   (e: TouchEvent) => void;

  attach(element: HTMLElement, cb: GestureCb): void {
    this.detach();
    this.element = element;
    this.callback = cb;

    this.onStartBound = this.onTouchStart.bind(this);
    this.onMoveBound = this.onTouchMove.bind(this);
    this.onEndBound = this.onTouchEnd.bind(this);

    element.addEventListener('touchstart', this.onStartBound, { passive: false });
    element.addEventListener('touchmove',  this.onMoveBound,  { passive: true  });
    element.addEventListener('touchend',   this.onEndBound,   { passive: true  });
  }

  detach(): void {
    if (!this.element) return;
    this.element.removeEventListener('touchstart', this.onStartBound);
    this.element.removeEventListener('touchmove',  this.onMoveBound);
    this.element.removeEventListener('touchend',   this.onEndBound);
    this.element = null;
    this.callback = null;
  }

  private onTouchStart(e: TouchEvent): void {
    this.touch0 = e.touches[0];
    this.startX = this.touch0.clientX;
    this.startY = this.touch0.clientY;
    this.velPoints = [{ x: this.startX, y: this.startY, t: performance.now() }];
  }

  private onTouchMove(e: TouchEvent): void {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      this.velPoints.push({ x: t.clientX, y: t.clientY, t: performance.now() });
      if (this.velPoints.length > 12) this.velPoints.shift();
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    if (!this.touch0) return;

    const last = e.changedTouches[0];
    const dx = last.clientX - this.startX;
    const dy = last.clientY - this.startY;

    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      this.callback?.({ type: 'tap', x: last.clientX, y: last.clientY });
      this.touch0 = null;
      return;
    }

    this.detectSwipe(dx, dy);

    this.touch0 = null;
  }

  private detectSwipe(dx: number, dy: number): void {
    const DIST_THRESHOLD = 40;
    const VEL_THRESHOLD = 0.25;

    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDx <= absDy) return;
    if (absDx < DIST_THRESHOLD) {
      // Short movement still counts as swipe if the flick is fast enough.
      if (this.velPoints.length < 2) return;
      const p0 = this.velPoints[0];
      const p1 = this.velPoints[this.velPoints.length - 1];
      const dt = p1.t - p0.t;
      const vel = dt > 0 ? Math.abs(p1.x - p0.x) / dt : 0;
      if (vel < VEL_THRESHOLD) return;
    }

    const isNext = dx < 0;

    this.callback?.({ type: isNext ? 'swipe-next' : 'swipe-prev', deltaX: dx });
  }

  ngOnDestroy(): void { this.detach(); }
}
