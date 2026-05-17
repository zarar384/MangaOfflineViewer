import { Injectable, signal, computed, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Detects device and browser capabilities for reader behavior.
 */
@Injectable({ providedIn: 'root' })
export class DeviceCapabilitiesService {
  private readonly platformId = inject(PLATFORM_ID);
  private get isBrowser(): boolean { return isPlatformBrowser(this.platformId); }

  readonly isIOS = signal(this.detectIOS());
  readonly isSafari = signal(this.detectSafari());
  readonly isMobile = signal(this.detectMobile());
  readonly isTouch = signal(this.detectTouch());
  readonly pixelRatio = signal(this.isBrowser ? (window.devicePixelRatio || 1) : 1);

  readonly supportsCreateImageBitmap = signal(
    this.isBrowser && typeof createImageBitmap !== 'undefined'
  );
  readonly supportsImageDecode = signal(
    this.isBrowser && 'decode' in HTMLImageElement.prototype
  );
  readonly supportsDvh = signal(this.checkDvhSupport());
  readonly supportsWakeLock = signal(
    this.isBrowser && 'wakeLock' in navigator
  );

  readonly viewportWidth = signal(this.isBrowser ? window.innerWidth : 0);
  readonly viewportHeight = signal(this.isBrowser ? window.innerHeight : 0);
  readonly isPortrait = computed(() => this.viewportHeight() >= this.viewportWidth());

  // Read once at startup.
  readonly safeAreaTop = signal(0);
  readonly safeAreaBottom = signal(0);
  readonly safeAreaLeft = signal(0);
  readonly safeAreaRight = signal(0);

  constructor() {
    if (!this.isBrowser) return;
    this.readSafeArea();
  }

  /** Call on resize or orientation change. */
  updateViewport(): void {
    if (!this.isBrowser) return;
    this.viewportWidth.set(window.innerWidth);
    this.viewportHeight.set(window.innerHeight);
  }

  private detectIOS(): boolean {
    if (!this.isBrowser) return false;
    return (
      /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
  }

  private detectSafari(): boolean {
    if (!this.isBrowser) return false;
    return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  }

  private detectMobile(): boolean {
    if (!this.isBrowser) return false;
    return /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  private detectTouch(): boolean {
    if (!this.isBrowser) return false;
    return navigator.maxTouchPoints > 0;
  }

  private checkDvhSupport(): boolean {
    if (!this.isBrowser) return false;
    try {
      const el = document.createElement('div');
      el.style.height = '1dvh';
      document.body.appendChild(el);
      const supported = el.style.height === '1dvh';
      document.body.removeChild(el);
      return supported;
    } catch {
      return false;
    }
  }

  /**
   * Reads CSS safe-area env values using a temporary element.
   */
  private readSafeArea(): void {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed',
      'top:env(safe-area-inset-top,0px)',
      'right:env(safe-area-inset-right,0px)',
      'bottom:env(safe-area-inset-bottom,0px)',
      'left:env(safe-area-inset-left,0px)',
      'width:0',
      'height:0',
      'pointer-events:none',
      'visibility:hidden',
    ].join(';');
    document.body.appendChild(el);

    const cs = getComputedStyle(el);
    this.safeAreaTop.set(parseInt(cs.top) || 0);
    this.safeAreaRight.set(parseInt(cs.right) || 0);
    this.safeAreaBottom.set(parseInt(cs.bottom) || 0);
    this.safeAreaLeft.set(parseInt(cs.left) || 0);

    document.body.removeChild(el);
  }
}
