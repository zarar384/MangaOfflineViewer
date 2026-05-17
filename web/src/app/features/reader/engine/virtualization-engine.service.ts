import { Injectable, signal } from '@angular/core';
import { PageMeta } from '../../../shared/models/page-meta.model';

/**
 * Manages sliding render window for reader pages.
 */
@Injectable({ providedIn: 'root' })
export class VirtualizationEngineService {
  /** Half size of render window. */
  private readonly WINDOW = 60;

  /** Big jump threshold for replacing full window. */
  private readonly JUMP_THRESHOLD = 50;

  /** Rendered page slice used by template. */
  readonly visiblePages = signal<PageMeta[]>([], {
    // Prevent rerender when page ids are the same.
    equal: (a, b) =>
      a.length === b.length && a.every((p, i) => p.id === b[i].id),
  });

  /** pageId to index in full page buffer. */
  readonly pageIndexMap = new Map<number, number>();

  /** Rebuild index from full pages list. */
  rebuildIndex(pages: PageMeta[]): void {
    this.pageIndexMap.clear();
    pages.forEach((p, i) => {
      if (p.id != null) this.pageIndexMap.set(p.id, i);
    });
  }

  /** Rebuild after merge to keep indices correct after prepend. */
  extendIndex(pages: PageMeta[]): void {
    pages.forEach((p, i) => {
      if (p.id != null && !this.pageIndexMap.has(p.id)) {
        // No-op branch kept for clarity.
      }
    });
    this.rebuildIndex(pages);
  }

  /** Recomputes visible slice around center index. */
  updateWindow(
    pages: PageMeta[],
    centerIndex: number,
    onEvict?: (evictedIds: number[]) => void
  ): void {
    const total = pages.length;
    let start = centerIndex - this.WINDOW;
    let end = centerIndex + this.WINDOW;

    if (end >= total) {
      end = total;
      start = Math.max(0, end - this.WINDOW * 2);
    }
    if (start <= 0) {
      start = 0;
      end = Math.min(total, this.WINDOW * 2);
    }

    const newSlice = pages.slice(start, end);
    const current = this.visiblePages();

    if (!current.length) {
      this.visiblePages.set(newSlice);
      return;
    }

    const firstIndex = this.pageIndexMap.get(current[0]?.id!);
    const lastIndex = this.pageIndexMap.get(current[current.length - 1]?.id!);

    if (firstIndex === undefined || lastIndex === undefined) {
      this.visiblePages.set(newSlice);
      return;
    }

    const currentCenter = Math.floor((firstIndex + lastIndex) / 2);
    const distance = Math.abs(centerIndex - currentCenter);

    if (distance >= this.JUMP_THRESHOLD) {
      const newIds = new Set(newSlice.map(p => p.id));
      const evicted = current.filter(p => !newIds.has(p.id)).map(p => p.id!);
      if (evicted.length) onEvict?.(evicted);
      this.visiblePages.set(newSlice);
      return;
    }

    if (
      current.length === newSlice.length &&
      current.every((p, i) => p.id === newSlice[i].id)
    ) return;

    const newIds = new Set(newSlice.map(p => p.id));
    const evicted = current.filter(p => !newIds.has(p.id)).map(p => p.id!);
    if (evicted.length) onEvict?.(evicted);
    this.visiblePages.set(newSlice);
  }

  /** Clears window and index. */
  reset(): void {
    this.visiblePages.set([]);
    this.pageIndexMap.clear();
  }
}
