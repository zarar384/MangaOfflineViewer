import { Injectable } from '@angular/core';
import { ReadingMode } from './interfaces/reader-settings.interface';
import { PageMeta } from 'src/app/shared/models/page-meta.model';

export interface ImgRef {
  el: HTMLElement;
  pageId: number;
}

/**
 * Centralized scroll math used by the reader.
 */
@Injectable({ providedIn: 'root' })
export class ScrollControllerService {
  /**
   * Scroll to a specific page without animation.
   */
  scrollToPage(
    pageId: number,
    getEl: (id: number) => HTMLElement | undefined,
    container: HTMLElement | null,
    mode: ReadingMode,
    progress = 0
  ): void {
    if (!container) return;
    const target = getEl(pageId);
    if (!target) return;

    const targetRect = target.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    if (mode === 'horizontal' || mode === 'dual') {
      const scrollLeft = Math.max(0, targetRect.left - containerRect.left + container.scrollLeft);

      container.scrollLeft = scrollLeft;
    } else {
      const newTop = target.offsetTop + target.offsetHeight * progress;
      container.scrollTop = newTop;
    }
  }

  /** Returns page id closest to viewport center. */
  getViewportAnchorId(
    refs: ImgRef[],
    container: HTMLElement | null
  ): number | null {
    if (!refs.length) return null;

    const containerRect = container?.getBoundingClientRect();
    const centreY = containerRect
      ? containerRect.top + containerRect.height / 2
      : window.innerHeight / 2;

    let bestId = 0;
    let bestDistance = Infinity;

    for (const { el, pageId } of refs) {
      const r = el.getBoundingClientRect();
      const centre = r.top + r.height / 2;
      const distance = Math.abs(centre - centreY);
      if (distance < bestDistance) { bestDistance = distance; bestId = pageId; }
    }

    return bestId || null;
  }

  /** Returns page id with the largest visible overlap. */
  getMostVisibleId(
    refs: ImgRef[],
    container: HTMLElement | null
  ): number | null {
    if (!refs.length) return null;

    const rect = container?.getBoundingClientRect();
    const top = rect?.top ?? 0;
    const bottom = rect?.bottom ?? window.innerHeight;

    let bestId = 0;
    let bestOverlap = 0;

    for (const { el, pageId } of refs) {
      const r = el.getBoundingClientRect();
      const overlapTop = Math.max(r.top,    top);
      const overlapBot = Math.min(r.bottom, bottom);
      const overlap = Math.max(0, overlapBot - overlapTop);
      if (overlap > bestOverlap) { bestOverlap = overlap; bestId = pageId; }
    }

    return bestId || null;
  }

  /**
   * Picks a stable anchor so reading position does not jump backwards.
   */
  getStableScrollAnchorId(
    refs: ImgRef[],
    container: HTMLElement | null,
    currentPageId: number | undefined,
    pages: PageMeta[],
    direction: 'up' | 'down' | null = null
  ): number | null {
    if (!refs.length) return null;

    const viewportId = this.getViewportAnchorId(refs, container)
      ?? this.getMostVisibleId(refs, container)
      ?? null;

    if (currentPageId == null || viewportId == null) {
      return viewportId;
    }

    const currentIndex = pages.findIndex(page => page.id === currentPageId);
    if (currentIndex < 0) return viewportId;

    const viewportIndex = pages.findIndex(page => page.id === viewportId);
    if (direction == null) return viewportId;
    if (direction === 'down' && viewportIndex >= currentIndex) return viewportId;
    if (direction === 'up' && viewportIndex <= currentIndex) return viewportId;

    const containerRect = container?.getBoundingClientRect();
    const centreY = containerRect
      ? containerRect.top + containerRect.height / 2
      : window.innerHeight / 2;

    let bestId: number | null = null;
    let bestDistance = Infinity;

    for (const { el, pageId } of refs) {
      const pageIndex = pages.findIndex(page => page.id === pageId);
      if (direction === 'down' && pageIndex < currentIndex) continue;
      if (direction === 'up' && pageIndex > currentIndex) continue;

      const r = el.getBoundingClientRect();
      const centre = r.top + r.height / 2;
      const distance = Math.abs(centre - centreY);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = pageId;
      }
    }

    return bestId ?? viewportId;
  }

  /** Returns true when image overlaps the visible area. */
  isInViewport(img: HTMLImageElement, container: HTMLElement | null): boolean {
    const cRect = container?.getBoundingClientRect();
    const iRect = img.getBoundingClientRect();
    if (!cRect) {
      return iRect.bottom > 0 && iRect.top < window.innerHeight;
    }
    return iRect.bottom > cRect.top && iRect.top < cRect.bottom;
  }
}
