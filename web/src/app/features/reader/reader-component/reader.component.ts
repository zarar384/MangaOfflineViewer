import { AfterViewInit, Component, QueryList, ViewChildren, ElementRef, OnDestroy, effect, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Page, PageMeta } from '../../../core/models/page.model';
import { ObjectUrlService } from '../../../core/services/object-url.service';
import { LoadingService } from '../../../core/services/loading.service';
import { ReaderService } from '../../../core/services/reader.service';
import { PagesRepository } from '../../../core/repositories/pages.repository';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

// number of pages kept from previous chapter when merging
// needed to keep visual continuity and avoid empty jump
const TAIL_PAGES = 10;

@Component({
  selector: 'manga-reader',
  templateUrl: './reader.component.html',
  styleUrls: ['./reader.component.css'],
  standalone: true,
  imports: [CommonModule],
})
export class ReaderComponent implements AfterViewInit, OnDestroy {

  /**
   * references to rendered <img> elements
   * used for observer + scroll control
   */
  @ViewChildren('imgRef')
  imgRefs!: QueryList<ElementRef<HTMLImageElement>>;

  /**
   * lazy loading entry point
   * observes visibility of images
   */
  private observer!: IntersectionObserver;

  /**
   * cache for Blob URLs
   * avoids recreating object URLs for same page
   */
  private pageUrls = new Map<number, string>();

  /**
   * pageId -> index in full list
   * used for window shift logic and cleanup
   */
  private pageIndexMap = new Map<number, number>();

  /**
   * pageId -> DOM element
   * used for scroll and anchor calculations
   */
  private imgMap = new Map<number, HTMLImageElement>();

  /**
   * lookup for currently visible pages only
   * avoids searching in full array
   */
  private visiblePagesMap = new Map<number, Page>();

  /**
   * max number of parallel image loads
   * prevents network and UI overload
   */
  private MAX_LOAD = 12;

  /**
   * current number of active loads
   */
  private loadingCount = 0;

  /**
   * tracks pages that are currently loading
   * prevents duplicate requests
   */
  private loadingSet = new Set<number>();

  /**
   * controls loader visibility
   */
  private isLoaderVisible = false;

  /**
   * distance from current index to keep images in memory
   * everything outside will be released
   */
  private CLEANUP_RADIUS = 30;

  /**
   * cancels outdated async operations
   * incremented on each state reset
   */
  private loadToken = 0;

  /**
   * threshold before shifting virtual window
   * prevents too frequent updates
   */
  private BUFFER = 5;

  /**
   * currently rendered subset of pages
   * main virtual window
   */
  visiblePages: Page[] = [];

  /**
   * prevents scroll reset during internal updates
   * used when merging chapters
   */
  private suppressNavigation = false;

  /**
   * page that should be scrolled after DOM update
   * used when page is not yet rendered
   */
  private pendingScrollPageId: number | null = null;

  constructor(
    private urlService: ObjectUrlService,
    private loading: LoadingService,
    public reader: ReaderService,
    private pagesRepo: PagesRepository,
    private destroyRef: DestroyRef
  ) {

    // reacts to reader state changes (open / setPages)
    // full reinitialization of component state
    effect(() => {
      const pages = this.reader.pages();
      if (!pages?.length) return;

      // revoke all existing object URLs to prevent memory leaks
      this.pageUrls.forEach((_, id) => { this.urlService.revokeUrl(String(id)); });
      this.pageUrls.clear();

      // rebuild global index map
      this.pageIndexMap.clear();
      pages.forEach((p, i) => this.pageIndexMap.set(p.id!, i));

      const currentPageId = this.reader.currentPageId();

      // start window around current page if exists
      const startIndex = currentPageId
        ? (this.pageIndexMap.get(currentPageId) ?? 0)
        : 0;

      // initialize visible window
      this.updateVisiblePages(startIndex);

      // reset loading pipeline and invalidate previous async work
      this.loadingSet.clear();
      this.loadingCount = 0;
      this.loadToken++;

      if (!this.suppressNavigation) {
        // full reset only on fresh open
        // internal navigation keeps scroll position
        const container = document.querySelector('.reader-container');
        if (container) (container as HTMLElement).scrollTop = 0;

        this.pendingScrollPageId = currentPageId ?? null;
      }

      // ensure loader visible until first images load
      if (!this.isLoaderVisible) {
        this.loading.show();
        this.isLoaderVisible = true;
      }

      // observer must be attached after DOM update
      requestAnimationFrame(() => {
        this.setupObserver();
        this.observeImages();
      });
    });
  }

  ngAfterViewInit(): void {
    this.setupObserver();

    this.imgRefs.changes
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        // rebuild DOM lookup after every render
        this.imgMap.clear();
        this.imgRefs.forEach(ref => {
          const el = ref.nativeElement;
          const id = Number(el.dataset['pageId']);
          this.imgMap.set(id, el);
        });

        this.observeImages();

        // scroll only after elements exist in DOM
        if (this.pendingScrollPageId != null) {
          const targetId = this.pendingScrollPageId;
          this.pendingScrollPageId = null;

          requestAnimationFrame(() => {
            const target = this.imgMap.get(targetId);
            if (target) {
              target.scrollIntoView({ behavior: 'auto', block: 'start' });
            }
            this.suppressNavigation = false;
          });
        } else {
          this.suppressNavigation = false;
        }
      });
  }

  private destroyed = false;

  // cleanup: stop observer + release URLs
  ngOnDestroy(): void {
    this.destroyed = true;
    this.observer?.disconnect();
    this.pageUrls.forEach((_, id) => { this.urlService.revokeUrl(String(id)); });
    this.pageUrls.clear();
  }

  private setupObserver() {
    this.observer?.disconnect();

    // preload ~1.5(1200px) screens ahead so images load before they enter viewport
    const margin = Math.round(window.innerHeight * 1.5);

    this.observer = new IntersectionObserver(async (entries) => {

      const token = this.loadToken;

      // limit processing to avoid frame drops
      const visible = entries.filter(e => e.isIntersecting).slice(0, this.MAX_LOAD);
      if (!visible.length) return;

      for (const entry of visible) {

        // stop if state changed during async work
        if (token !== this.loadToken) return;

        const img = entry.target as HTMLImageElement;
        const id = Number(img.dataset['pageId']);

        const globalIndex = this.pageIndexMap.get(id);

        // check if window shift is needed
        // happens near edges of current virtual window
        if (globalIndex !== undefined && entry.isIntersecting) {
          const first = this.visiblePages[0]?.id;
          const last = this.visiblePages[this.visiblePages.length - 1]?.id;
          const firstIndex = this.pageIndexMap.get(first!);
          const lastIndex = this.pageIndexMap.get(last!);

          if (
            firstIndex === undefined ||
            lastIndex === undefined ||
            globalIndex < firstIndex + this.BUFFER ||
            globalIndex > lastIndex - this.BUFFER
          ) {
            // preserve scroll before DOM changes
            this.preserveScroll(id, () => {
              // load next/prev chapter if needed
              this.checkChapterEdges(globalIndex);

              // shift virtual window
              this.updateVisiblePages(globalIndex);
            });
          }
        }

        const page = this.visiblePagesMap.get(id);

        // skip invalid / duplicate / overflow
        if (!page) continue;
        if (this.loadingSet.has(id)) continue;
        if (this.loadingCount >= this.MAX_LOAD) continue;

        if (!this.isLoaderVisible) {
          this.loading.show();
          this.isLoaderVisible = true;
        }

        this.loadingSet.add(id);
        this.loadingCount++;

        try {
          // lazy load page data (src might not exist yet)
          await this.ensurePageLoaded(page);
          if (this.destroyed || token !== this.loadToken) return;

          const url = await this.getOrCreateUrl(page);
          if (this.destroyed || token !== this.loadToken) return;
          if (!url) continue;

          // assign src and wait for load
          await this.loadImage(img, url);
          if (this.destroyed) return;

          // free memory outside active range
          this.cleanupFarImages(id);

        } finally {
          this.loadingSet.delete(id);
          this.loadingCount--;

          // hide loader when nothing is loading
          if (this.loadingSet.size === 0 && this.isLoaderVisible) {
            this.loading.hide();
            this.isLoaderVisible = false;
          }
        }
      }

    }, {
      rootMargin: `${margin}px`,
      threshold: 0.01
    });
  }

  // attaches observer to current DOM elements
  private observeImages() {
    this.observer.disconnect();
    this.imgRefs.forEach(ref => this.observer.observe(ref.nativeElement));
  }

  // loads image and waits until ready (with fallback timeout)
  private async loadImage(img: HTMLImageElement, url: string) {
    if (img.src === url && img.complete) return;
    img.src = url;
    if (img.complete) return;

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 10000);
      const done = () => {
        clearTimeout(timeout);
        img.onload = null;
        img.onerror = null;
        resolve();
      };
      img.onload = done;
      img.onerror = done;
    });
  }

  // ensures page has src (lazy fetch from repository)
  private async ensurePageLoaded(page: Page) {
    if (page.src) return;
    const full = await this.pagesRepo.get(page.id!);
    if (full) {
      page.src = full.src;
      page.pageNumber = full.pageNumber;
    }
  }

  // resolves final URL (string or Blob)
  private async getOrCreateUrl(page: Page): Promise<string> {
    if (typeof page.src === 'string') return page.src;
    if (!(page.src instanceof Blob) || page.id == null) return '';

    if (!this.pageUrls.has(page.id)) {
      const url = await this.urlService.createUrl(`${page.id}`, page.src);
      this.pageUrls.set(page.id, url);
    }
    return this.pageUrls.get(page.id)!;
  }

  // removes images far from current position to reduce memory usage
  private cleanupFarImages(currentId: number) {
    if (this.pageUrls.size === 0) return;
    const currentIndex = this.pageIndexMap.get(currentId);
    if (currentIndex === undefined) return;

    const min = currentIndex - this.CLEANUP_RADIUS;
    const max = currentIndex + this.CLEANUP_RADIUS;

    this.imgRefs.forEach(ref => {
      const img = ref.nativeElement;
      const id = Number(img.dataset['pageId']);
      const index = this.pageIndexMap.get(id);
      if (index === undefined) return;

      if (index < min || index > max) {
        if (this.pageUrls.has(id)) {
          this.urlService.revokeUrl(String(id));
          this.pageUrls.delete(id);
        }
        this.loadingSet.delete(id);
      }
    });
  }

  scrollToPage(pageId: number) {
    const existing = this.imgMap.get(pageId);

    // fast path: already rendered
    if (existing) {
      existing.scrollIntoView({ behavior: 'auto', block: 'start' });
      return;
    }

    // force window shift, scroll after render
    const index = this.pageIndexMap.get(pageId);
    if (index !== undefined) {
      this.updateVisiblePages(index);
    }
    this.pendingScrollPageId = pageId;
  }

  // updates virtual window around current index
  // keeps DOM small and stable
  private updateVisiblePages(centerIndex: number) {
    const start = Math.max(0, centerIndex - 40);
    const end = Math.min(this.pages.length, centerIndex + 40);

    const newStartId = this.pages[start]?.id;
    const newEndId = this.pages[end - 1]?.id;

    // skip update if window didn't change
    if (
      this.visiblePages[0]?.id === newStartId &&
      this.visiblePages[this.visiblePages.length - 1]?.id === newEndId
    ) return;

    const newSlice = this.pages.slice(start, end);
    const newIds = new Set(newSlice.map(p => p.id));

    // drop URLs outside window
    this.pageUrls.forEach((_, id) => {
      if (!newIds.has(id)) {
        this.urlService.revokeUrl(String(id));
        this.pageUrls.delete(id);
      }
    });

    this.visiblePages = newSlice;
    this.visiblePagesMap.clear();
    this.visiblePages.forEach(p => { if (p.id != null) this.visiblePagesMap.set(p.id, p); });
  }

  // keeps scroll stable when DOM changes
  // prevents visible jumps during window shift
  private preserveScroll(anchorId: number, callback: () => void) {
    const anchorEl = this.imgMap.get(anchorId);
    if (!anchorEl) { callback(); return; }

    const prevTop = anchorEl.getBoundingClientRect().top;
    callback();

    requestAnimationFrame(() => {
      const newEl = this.imgMap.get(anchorId);
      if (!newEl) return;
      window.scrollBy(0, newEl.getBoundingClientRect().top - prevTop);
    });
  }

  private checkChapterEdges(globalIndex: number) {
    const total = this.pages.length;
    if (total === 0) return;

    // near end => load next chapter
    if (globalIndex > total - 5) this.loadNextChapter();

    // near start => load previous chapter
    if (globalIndex < 5) this.loadPrevChapter();
  }

  private isLoadingNextChapter = false;
  private isLoadingPrevChapter = false;

  // merges current tail with next chapter
  private buildMergedNext(current: PageMeta[], next: PageMeta[]): PageMeta[] | null {
    const existingIds = new Set(current.map(p => p.id));
    const newPages = next.filter(p => !existingIds.has(p.id));
    if (!newPages.length) return null;
    return [...current.slice(-TAIL_PAGES), ...newPages];
  }

  // merges previous chapter with current head
  private buildMergedPrev(current: PageMeta[], prev: PageMeta[]): PageMeta[] | null {
    const existingIds = new Set(current.map(p => p.id));
    const newPages = prev.filter(p => !existingIds.has(p.id));
    if (!newPages.length) return null;
    return [...newPages, ...current.slice(0, TAIL_PAGES)];
  }

  private async loadNextChapter() {
    if (this.isLoadingNextChapter) return;
    const snapshot = this.reader.getSnapshot();
    if (!snapshot.mangaId) return;

    this.isLoadingNextChapter = true;
    try {
      const maxChapterId = Math.max(...this.pages.map(p => p.chapterId!));
      const nextPages = await this.pagesRepo.getMeta(snapshot.mangaId, maxChapterId + 1);
      if (!nextPages.length) return;

      const merged = this.buildMergedNext(this.pages, nextPages);
      if (!merged) return;

      // set before setPages to keep correct scroll target
      this.reader.setCurrentPage(this.pendingScrollPageId!) ?? null;

      // prevent scroll reset
      this.suppressNavigation = true;

      this.reader.setPages(merged, nextPages[0].chapterId!);
    } finally {
      this.isLoadingNextChapter = false;
    }
  }

  private async loadPrevChapter() {
    if (this.isLoadingPrevChapter) return;

    const snapshot = this.reader.getSnapshot();
    if (!snapshot.mangaId) return;

    this.isLoadingPrevChapter = true;

    try {
      const minChapterId = Math.min(...this.pages.map(p => p.chapterId!));
      if (minChapterId <= 1) return;

      const prevPages = await this.pagesRepo.getMeta(snapshot.mangaId, minChapterId - 1);
      if (!prevPages.length) return;

      const merged = this.buildMergedPrev(this.pages, prevPages);
      if (!merged) return;

      const currentPageId = this.reader.currentPageId();

      // required to restore position after prepend
      this.pendingScrollPageId = currentPageId ?? null;

      // prevent scroll reset
      this.suppressNavigation = true;

      this.reader.setCurrentPage(currentPageId!);
      this.reader.setPages(merged, prevPages[0].chapterId!);

    } finally {
      this.isLoadingPrevChapter = false;
    }
  }


  // GETTERS FOR TEMPLATE AND INTERNAL USE
  /**
   * current pages from reader state
   * source of truth for rendering
   */
  get pages(): PageMeta[] { return this.reader.pages(); }

  /**
   * current reading mode (scroll / page)
   * controls layout behavior
   */
  get readerMode() { return this.reader.mode(); }

  /**
   * current zoom level
   * applied to image scaling
   */
  get readerZoom() { return this.reader.zoom(); }

  /**
   * gap between pages
   * affects spacing in scroll mode
   */
  get readerGap() { return this.reader.gap(); }

}
