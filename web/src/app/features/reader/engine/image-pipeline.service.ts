import { Injectable, inject, OnDestroy } from '@angular/core';
import { ObjectUrlService } from '../../../core/services/object-url.service';
import { PagesRepository } from '../../../core/repositories/pages.repository';
import { DeviceCapabilitiesService } from './device-capabilities.service';
import { Page } from '../../../core/models/page.model';

/**
 * Handles payload loading, url caching and image element loading.
 */
@Injectable({ providedIn: 'root' })
export class ImagePipelineService implements OnDestroy {
  private readonly urlService = inject(ObjectUrlService);
  private readonly pagesRepo = inject(PagesRepository);
  private readonly device = inject(DeviceCapabilitiesService);

  // pageId to object url cache
  private readonly pageUrls = new Map<number, string>();

  // page ids currently loading
  private readonly loadingSet = new Set<number>();

  isLoading(pageId: number): boolean { return this.loadingSet.has(pageId); }
  hasUrl(pageId: number): boolean    { return this.pageUrls.has(pageId); }
  markLoading(pageId: number): void  { this.loadingSet.add(pageId); }
  markDone(pageId: number): void     { this.loadingSet.delete(pageId); }

  /**
   * Clears stale loading flags after mode switch or reopen.
   * This prevents pages from getting stuck in loading state.
   */
  clearAllLoadingMarks(): void { this.loadingSet.clear(); }

  /** Ensures page has full payload with src. */
  async ensurePayload(page: Page): Promise<void> {
    if (page.src) return;
    const full = await this.pagesRepo.get(page.id!);
    if (full) {
      page.src = full.src;
      page.order = full.order;
    }
  }

  /** Returns direct src for strings or cached object url for blobs. */
  async getUrl(page: Page): Promise<string> {
    if (typeof page.src === 'string') return page.src;
    if (!(page.src instanceof Blob) || page.id == null) return '';

    if (!this.pageUrls.has(page.id)) {
      const url = await this.urlService.createUrl(`${page.id}`, page.src);
      this.pageUrls.set(page.id, url);
    }

    return this.pageUrls.get(page.id)!;
  }

  /** Assigns url to image element and waits for load or timeout. */
  async loadIntoElement(img: HTMLImageElement, url: string): Promise<void> {
    // Skip if already loaded with same source.
    if (img.src === url && img.complete && img.naturalHeight > 0) return;

    return new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 12_000);

      const cleanup = () => clearTimeout(timeout);

      img.onload = () => { cleanup(); resolve(); };
      img.onerror = () => { cleanup(); resolve(); };

      img.src = url;

      // decode helps avoid jank on large pages.
      if (this.device.supportsImageDecode()) {
        img.decode().catch(() => {});
      }
    });
  }

  /** Full convenience pipeline for one page. */
  async loadPage(page: Page, img: HTMLImageElement): Promise<void> {
    await this.ensurePayload(page);
    const url = await this.getUrl(page);
    if (url) await this.loadIntoElement(img, url);
  }

  /**
 * Releases the cached URL for a page.
 * Always use this method to keep the local cache in sync with ObjectUrlService.
 * Otherwise a revoked blob URL may be returned later.
 */
  releaseUrl(pageId: number): void {
    this.urlService.revokeUrl(String(pageId));
    this.pageUrls.delete(pageId);
    this.loadingSet.delete(pageId);
  }

  /**
   * Revokes urls for pages outside the active radius around current page.
   */
  evictFarPages(
    currentId: number,
    pageIndexMap: Map<number, number>,
    radius: number
  ): void {
    const currentIndex = pageIndexMap.get(currentId);
    if (currentIndex === undefined) return;

    const min = currentIndex - radius;
    const max = currentIndex + radius;

    for (const [id] of this.pageUrls) {
      const idx = pageIndexMap.get(id);
      if (idx === undefined || idx < min || idx > max) {
        this.releaseUrl(id);
      }
    }
  }

  /** Revokes all cached urls. */
  revokeAll(): void {
    for (const id of this.pageUrls.keys()) {
      this.urlService.revokeUrl(String(id));
    }
    this.pageUrls.clear();
    this.loadingSet.clear();
  }

  ngOnDestroy(): void {
    this.revokeAll();
  }
}
