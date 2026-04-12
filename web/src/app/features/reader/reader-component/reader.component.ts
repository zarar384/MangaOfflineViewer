import { AfterViewInit, Component, QueryList, ViewChildren, ElementRef, OnDestroy, effect, DestroyRef, untracked, } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Page, PageMeta } from '../../../core/models/page.model';
import { ObjectUrlService } from '../../../core/services/object-url.service';
import { LoadingService } from '../../../core/services/loading.service';
import { ReaderService } from '../../../core/services/reader.service';
import { isIOS } from '../../../shared/utils/constants';
import { PagesRepository } from '../../../core/repositories/pages.repository';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChaptersRepository } from 'src/app/core/repositories/chapters.repository';

@Component({
  selector: 'manga-reader',
  templateUrl: './reader.component.html',
  styleUrls: ['./reader.component.css'],
  standalone: true,
  imports: [CommonModule],
})
export class ReaderComponent implements AfterViewInit, OnDestroy {

  /**
   * References to rendered <img> elements.
   * Used for observer attachment and scroll calculations.
   */
  @ViewChildren('imgRef')
  imgRefs!: QueryList<ElementRef<HTMLImageElement>>;

  /** Intersection observer for lazy loading */
  private observer!: IntersectionObserver;

  /**
   * Set of page ids currently being observed.
   * Used to add only NEW elements to the observer without disconnecting it,
   * which would cancel all pending intersection callbacks.
   */
  private observedPageIds = new Set<number>();

  /** Blocks observer logic during programmatic navigation */
  private isNavigating = false;

  /** Cache of generated object URLs: pageId -> url */
  private pageUrls = new Map<number, string>();

  /** pageId -> index in full pages buffer, used for fast lookup and window logic */
  private pageIndexMap = new Map<number, number>();

  /** Max number of parallel image loads */
  private MAX_LOAD = 12;

  /** Current number of active loads */
  private loadingCount = 0;

  /** Pages currently being loaded - prevents duplicate requests */
  private loadingSet = new Set<number>();

  /** Tracks global loader visibility */
  private isLoaderVisible = false;

  /** Page used as scroll focus center during navigation */
  private focusPageId: number | null = null;

  /**
   * Radius for keeping image URLs in memory.
   * URLs outside this range are revoked to free memory.
   */
  private CLEANUP_RADIUS = 30;

  /**
   * Incremented to cancel outdated async work after state resets.
   * Only bumped on clean opens - merges must not cancel in-flight loads.
   */
  private loadToken = 0;

  /** Distance from window edge (in pages) that triggers a window shift */
  private BUFFER = 15;

  /**
   * Distance from the END of the full pages buffer that triggers
   * an adjacent chapter fetch. Measured against total buffer length,
   * so it correctly scales as new chapters are appended.
   */
  private CHAPTER_TRIGGER = 20;

  /** Currently rendered subset of pages (~120 pages max) */
  visiblePages: Page[] = [];

  /**
   * Chapter ids already loaded into the pages buffer.
   * Prevents re-fetching the same chapter on repeated observer callbacks.
   * Reset only on clean open.
   */
  private loadedChapterIds = new Set<number>();

  /**
   * chapter id -> { firstPageId, lastPageId }
   * Used to detect when the bookmark crosses a chapter boundary
   * so we can update reader.chapterId() correctly.
   */
  private chapterPageRanges = new Map<number, { first: number; last: number }>();

  /**
   * Guards against concurrent fetch for the same direction.
   * Cleared on completion (success or failure) so retries are possible.
   */
  private fetchingNext = false;
  private fetchingPrev = false;

  /**
   * Manual scroll listener for upward scroll preloading.
   *
   * IntersectionObserver with rootMargin does not reliably fire callbacks
   * for elements above the viewport during upward scroll on some browsers.
   * This listener imperatively checks which unloaded images are close to
   * the viewport on every scroll event and loads them directly.
   *
   * Attached to the reader-container element.
   */
  private scrollPreloadListener: (() => void) | null = null;

  /**
   * Throttle flag for the scroll preload listener.
   * Prevents running the check on every single scroll event.
   */
  private scrollPreloadThrottled = false;

  constructor(
    private urlService: ObjectUrlService,
    private loading: LoadingService,
    public reader: ReaderService,
    private pagesRepo: PagesRepository,
    private chaptersRepo: ChaptersRepository,
    private destroyRef: DestroyRef
  ) {

    //  EFFECT: pages buffer changed 
    //
    // Fires on both clean opens AND seamless merges.
    // `pagesUpdateKind()` is tracked together with `pages()`, so this branch
    // selection stays reliable even when Angular schedules effects later.

    effect(() => {
      const pages = this.reader.pages();
      const pagesUpdateKind = this.reader.pagesUpdateKind();
      if (!pages?.length) return;

      this.pageIndexMap.clear();
      pages.forEach((p, i) => this.pageIndexMap.set(p.id!, i));
      this.rebuildChapterTracking(pages);

      if (pagesUpdateKind === 'merge') {
        //  seamless merge: minimal update, no scroll reset 
        //
        // Recalculate the visible window without losing scroll position,
        // and re-attach the observer to any newly rendered elements.

        const anchorId = untracked(() => this.reader.currentPageBookmark());
        const anchorIndex = anchorId
          ? (this.pageIndexMap.get(anchorId) ?? 0)
          : 0;

        this.preserveScroll(anchorId ?? 0, () => {
          this.updateVisiblePages(anchorIndex);
        });

        requestAnimationFrame(() => {
          this.observeNewImages();

          // After prev-merge, new elements land above the viewport.
          // The observer may not fire for them because their intersection
          // state didn't change from the browser's perspective (they went
          // from "not in DOM" to "above viewport" without crossing the edge).
          // Manually trigger a load pass for everything near the viewport.
          this.loadVisibleRange();
        });
        return;
      }

      //  clean open: full reset 

      this.pageUrls.forEach((_, id) => { this.urlService.revokeUrl(String(id)); });
      this.pageUrls.clear();

      const currentPageId = untracked(() => this.reader.currentPageId());
      const startIndex = currentPageId
        ? (this.pageIndexMap.get(currentPageId) ?? 0)
        : 0;

      this.updateVisiblePages(startIndex);

      this.loadingSet.clear();
      this.loadingCount = 0;
      this.focusPageId = null;

      this.fetchingNext = false;
      this.fetchingPrev = false;

      this.loading.show();
      this.isLoaderVisible = true;

      this.loadToken++;

      const container = document.querySelector('.reader-container');
      if (container) container.scrollTop = 0;

      requestAnimationFrame(() => {
        // full observer reset only on clean open
        this.setupObserver();
        this.observeAllImages();
        this.setupScrollPreloadListener();

        // user opened reader in a chapter other than the first one
        // try to load adjacent chapters immediately
        if (this.reader.isOpen()) {
          this.reader.resetIsOpen();

          this.tryLoadAdjacentChapters(startIndex);
        }
      });
    });


    //  EFFECT: navigation to specific page 

    effect(() => {
      const pages = this.reader.pages();
      this.reader.navTick();
      const pageId = untracked(() => this.reader.currentPageId());

      if (!pageId || !pages.length) return;

      this.handleNavigation(pageId);
    });
  }


  ngAfterViewInit(): void {
    this.setupObserver();

    this.imgRefs.changes
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        // only observe elements that aren't watched yet
        this.observeNewImages();
      });
  }

  private destroyed = false;

  ngOnDestroy(): void {
    this.destroyed = true;
    this.observer?.disconnect();
    this.observedPageIds.clear();
    this.teardownScrollPreloadListener();
    this.pageUrls.forEach((_, id) => { this.urlService.revokeUrl(String(id)); });
    this.pageUrls.clear();
  }


  //  OBSERVER 

  private setupObserver() {
    this.observer?.disconnect();
    this.observedPageIds.clear();

    this.observer = new IntersectionObserver(async (entries) => {

      if (this.isNavigating) return;

      const token = this.loadToken;

      let centerY = window.innerHeight / 2;

      if (this.focusPageId !== null) {
        const el = this.imgRefs.find(r =>
          Number(r.nativeElement.dataset['pageId']) === this.focusPageId
        )?.nativeElement;

        if (el) {
          const rect = el.getBoundingClientRect();
          centerY = rect.top + rect.height / 2;
        }
      }

      const visible = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => {
          const aCenter = a.boundingClientRect.top + a.boundingClientRect.height / 2;
          const bCenter = b.boundingClientRect.top + b.boundingClientRect.height / 2;
          return Math.abs(aCenter - centerY) - Math.abs(bCenter - centerY);
        })
        .slice(0, this.MAX_LOAD * 2);

      // save the current reading position from the visible page
      if (!this.isNavigating && this.focusPageId === null && visible.length > 0) {
        const id = Number((visible[0].target as HTMLImageElement).dataset['pageId']);

        if (
          id &&
          (
            this.reader.currentPageId() !== id ||
            this.reader.currentPageBookmark() !== id
          )
        ) {
          this.reader.setCurrentPage(id);
          this.reader.setCurrentPageBookmark(id);
          this.updateActiveChapter(id);
        }
      }

      let windowUpdated = false;

      for (const entry of visible) {

        if (token !== this.loadToken) return;

        const img = entry.target as HTMLImageElement;
        const id = Number(img.dataset['pageId']);
        const globalIndex = this.pageIndexMap.get(id);

        if (globalIndex !== undefined && !windowUpdated) {

          const first = this.visiblePages[0]?.id;
          const last = this.visiblePages[this.visiblePages.length - 1]?.id;

          if (
            first === undefined ||
            last === undefined ||
            globalIndex < this.pageIndexMap.get(first)! + this.BUFFER ||
            globalIndex > this.pageIndexMap.get(last)! - this.BUFFER
          ) {
            this.preserveScroll(id, () => { this.updateVisiblePages(globalIndex); });
            windowUpdated = true;
          }

          // fire-and-forget: preload adjacent chapters if near buffer edges
          this.tryLoadAdjacentChapters(globalIndex);
        }

        const page = this.visiblePages.find(p => p.id === id);
        if (!page) continue;

        // skip duplicate / overflow
        if (this.loadingSet.has(id)) continue;
        if (this.loadingCount >= this.MAX_LOAD) continue;

        if (!this.isLoaderVisible) {
          this.loading.show();
          this.isLoaderVisible = true;
        }

        this.loadingSet.add(id);
        this.loadingCount++;

        try {

          // ensure page data is loaded
          await this.ensurePageLoaded(page);
          if (this.destroyed) return;

          if (token !== this.loadToken) return;

          const alreadyExists = this.pageUrls.has(page.id!);

          // get or create object URL
          const url = await this.getOrCreateUrl(page);
          if (this.destroyed) return;

          // if outdated -> cleanup created URL
          if (token !== this.loadToken) {
            if (!alreadyExists && url) this.urlService.revokeUrl(url);
            return;
          }

          if (!url) continue;

          // load image into DOM
          await this.loadImage(img, url);
          if (this.destroyed) return;

          // cleanup far images to save memory
          this.cleanupFarImages(id);

        } finally {
          this.loadingSet.delete(id);
          this.loadingCount--;

          // hide loader when all done
          if (this.loadingSet.size === 0 && this.isLoaderVisible) {
            this.loading.hide();
            this.isLoaderVisible = false;
          }
        }
      }

    }, {
      rootMargin: isIOS ? '600px' : '1200px',
      threshold: isIOS ? 0.1 : 0.01,
    });
  }

  /**
   * Attaches observer to ALL current img elements.
   * Only called on clean open (full observer reset).
   * Clears observedPageIds so the additive path works correctly after.
   */
  private observeAllImages() {
    this.observedPageIds.clear();

    this.imgRefs.forEach(ref => {
      const id = Number(ref.nativeElement.dataset['pageId']);
      this.observer.observe(ref.nativeElement);
      this.observedPageIds.add(id);
    });
  }

  /**
   * Attaches observer ONLY to img elements not yet observed.
   * Used after merges and DOM changes - does NOT disconnect the observer,
   * preserving pending intersection callbacks for off-screen elements
   * (e.g. pages above viewport preloaded via rootMargin).
   */
  private observeNewImages() {
    this.imgRefs.forEach(ref => {
      const id = Number(ref.nativeElement.dataset['pageId']);

      if (!this.observedPageIds.has(id)) {
        this.observer.observe(ref.nativeElement);
        this.observedPageIds.add(id);
      }
    });

    // unobserve elements that are no longer in the DOM
    // (pages that left the virtual window)
    const currentIds = new Set(
      this.imgRefs.map(r => Number(r.nativeElement.dataset['pageId']))
    );

    this.observedPageIds.forEach(id => {
      if (!currentIds.has(id)) {
        this.observedPageIds.delete(id);
        // element is already removed from DOM, observer auto-drops it
      }
    });
  }


  // SCROLL PRELOAD 

  /**
   * Attaches a scroll listener to the reader container that manually checks
   * for unloaded images within a preload distance of the viewport and loads
   * them imperatively — complementing the IntersectionObserver which does
   * not reliably preload elements above the viewport during upward scroll
   * on some browsers (notably Safari).
   */
  private setupScrollPreloadListener() {
    this.teardownScrollPreloadListener();

    const container = document.querySelector('.reader-container') as HTMLElement;
    if (!container) return;

    this.scrollPreloadListener = () => {
      if (this.scrollPreloadThrottled || this.isNavigating) return;

      this.scrollPreloadThrottled = true;

      requestAnimationFrame(() => {
        this.loadVisibleRange();
        this.scrollPreloadThrottled = false;
      });
    };

    container.addEventListener('scroll', this.scrollPreloadListener, { passive: true });
  }

  private teardownScrollPreloadListener() {
    if (!this.scrollPreloadListener) return;

    const container = document.querySelector('.reader-container') as HTMLElement;
    container?.removeEventListener('scroll', this.scrollPreloadListener!);
    this.scrollPreloadListener = null;
  }

  /**
   * Scans all visible img refs and imperatively loads any image within
   * PRELOAD_PX of the viewport that hasn't been loaded yet.
   *
   * Complements the observer's rootMargin preloading, which is unreliable
   * for upward scroll on some browsers.
   */
  private loadVisibleRange() {
    const PRELOAD_PX = 1200;
    const token = this.loadToken;

    this.imgRefs.forEach(ref => {
      if (this.destroyed) return;
      if (token !== this.loadToken) return;

      const img = ref.nativeElement;
      const id = Number(img.dataset['pageId']);

      // skip already loaded images
      if (img.src && img.complete && img.naturalHeight > 0) return;
      if (this.loadingSet.has(id)) return;
      if (this.loadingCount >= this.MAX_LOAD) return;

      const rect = img.getBoundingClientRect();

      // check if within preload range (above or below viewport)
      const inRange =
        rect.bottom >= -PRELOAD_PX &&
        rect.top <= window.innerHeight + PRELOAD_PX;

      if (!inRange) return;

      const page = this.visiblePages.find(p => p.id === id);
      if (!page) return;

      // load imperatively — same pipeline as the observer
      this.loadingSet.add(id);
      this.loadingCount++;

      if (!this.isLoaderVisible) {
        this.loading.show();
        this.isLoaderVisible = true;
      }

      this.ensurePageLoaded(page)
        .then(() => {
          if (this.destroyed || token !== this.loadToken) return;
          return this.getOrCreateUrl(page);
        })
        .then(url => {
          if (!url || this.destroyed || token !== this.loadToken) return;
          return this.loadImage(img, url);
        })
        .then(() => {
          if (this.destroyed) return;
          this.cleanupFarImages(id);
        })
        .catch(() => { /* silent — observer will retry on next scroll */ })
        .finally(() => {
          this.loadingSet.delete(id);
          this.loadingCount--;

          if (this.loadingSet.size === 0 && this.isLoaderVisible) {
            this.loading.hide();
            this.isLoaderVisible = false;
          }
        });
    });
  }


  // CHAPTER TRACKING

  /**
   * Rebuilds chapter ranges from the current pages buffer.
   * This keeps boundary detection correct after clean opens, restored sessions,
   * and seamless prev/next chapter merges.
   */
  private rebuildChapterTracking(pages: PageMeta[]): void {
    this.loadedChapterIds.clear();
    this.chapterPageRanges.clear();

    for (const page of pages) {
      const chapterId = page.chapterId;
      const pageId = page.id;

      if (chapterId == null || pageId == null) continue;

      this.loadedChapterIds.add(chapterId);

      const range = this.chapterPageRanges.get(chapterId);
      if (!range) {
        this.chapterPageRanges.set(chapterId, {
          first: pageId,
          last: pageId,
        });
        continue;
      }

      range.last = pageId;
    }
  }


  //  CHAPTER BOUNDARY TRACKING 

  /**
   * Checks if the bookmark has entered a different chapter's page range
   * and updates reader.chapterId() accordingly.
   *
   * This is the ONLY place chapterId is updated during reading.
   * mergePages() never touches chapterId - it only manages the page buffer.
   *
   * @param currentPageId - page id of the current bookmark
   */
  private updateActiveChapter(currentPageId: number): void {
    const pageIndex = this.pageIndexMap.get(currentPageId);
    if (pageIndex === undefined) return;

    for (const [chapterId, range] of this.chapterPageRanges.entries()) {
      const firstIndex = this.pageIndexMap.get(range.first);
      const lastIndex = this.pageIndexMap.get(range.last);

      if (firstIndex === undefined || lastIndex === undefined) continue;

      if (pageIndex >= firstIndex && pageIndex <= lastIndex) {
        if (this.reader.chapterId() !== chapterId) {
          this.reader.setChapterId(chapterId);
        }
        return;
      }
    }
  }


  //  SEAMLESS CHAPTER LOADING 

  /**
   * Checks if user is near buffer edges and preloads adjacent chapters.
   *
   * Design decisions:
   *
   * 1. reader.chapterId() = chapter the user is READING (from bookmark position),
   *    not the last merged chapter. So getNextChapter / getPrevChapter always
   *    use the correct anchor regardless of how many chapters are in the buffer.
   *
   * 2. loadedChapterIds tracks which chapters are already in the buffer by id.
   *    Works correctly from any starting chapter.
   *
   * 3. globalIndex is measured against the FULL buffer length (not visiblePages),
   *    so CHAPTER_TRIGGER remains meaningful as the buffer grows.
   *
   * 4. fetchingNext / fetchingPrev prevent concurrent fetches.
   *    Always cleared on completion so failed fetches can be retried.
   *
   * 5. Called without await - does not block the observer loop.
   *
   * @param globalIndex - current page index in the full pages buffer
   */
  private tryLoadAdjacentChapters(globalIndex: number): void {
    const total = this.reader.pages().length;
    const chapterId = this.reader.chapterId();

    if (!chapterId) return;

    //  next chapter 

    if (!this.fetchingNext && globalIndex >= total - this.CHAPTER_TRIGGER) {
      this.fetchingNext = true;

      this.chaptersRepo.getNextChapter(chapterId)
        .then(next => {
          if (!next || this.loadedChapterIds.has(next.id!)) {
            // no next chapter or already in buffer - nothing to do
            this.fetchingNext = false;
            return;
          }

          return this.pagesRepo.getMetaByChapter(next.id!).then(newPages => {
            if (!newPages?.length) { this.fetchingNext = false; return; }

            // register before merging to block duplicate fetches
            this.loadedChapterIds.add(next.id!);

            this.reader.mergePages(newPages, 'next');

            this.fetchingNext = false;
          });
        })
        .catch(() => { this.fetchingNext = false; });
    }

    //  previous chapter 

    if (!this.fetchingPrev && globalIndex <= this.CHAPTER_TRIGGER) {
      this.fetchingPrev = true;

      this.chaptersRepo.getPrevChapter(chapterId)
        .then(prev => {
          if (!prev || this.loadedChapterIds.has(prev.id!)) {
            this.fetchingPrev = false;
            return;
          }

          return this.pagesRepo.getMetaByChapter(prev.id!).then(newPages => {
            if (!newPages?.length) { this.fetchingPrev = false; return; }

            this.loadedChapterIds.add(prev.id!);

            this.reader.mergePages(newPages, 'prev');

            this.fetchingPrev = false;
          });
        })
        .catch(() => { this.fetchingPrev = false; });
    }
  }


  //  IMAGE LOADING 

  /**
   * Sets img.src and waits until the image is ready.
   * Includes a 10s fallback timeout for stuck loads (especially on iOS).
   */
  private async loadImage(img: HTMLImageElement, url: string): Promise<void> {
    return new Promise<void>((resolve) => {
      if (img.src === url && img.complete) { resolve(); return; }

      const timeout = setTimeout(resolve, 10000);

      img.onload = () => { clearTimeout(timeout); resolve(); };
      img.onerror = () => { clearTimeout(timeout); resolve(); };

      img.src = url;
    });
  }

  /**
   * Lazily fetches full page data if src is missing.
   * Mutates the page object in-place.
   */
  private async ensurePageLoaded(page: Page): Promise<void> {
    if (page.src) return;

    const full = await this.pagesRepo.get(page.id!);

    if (full) {
      page.src = full.src;
      page.pageNumber = full.pageNumber;
    }
  }

  /**
   * Returns a usable URL for the page src.
   * Handles both string URLs and Blob objects.
   * Caches object URLs to avoid duplicate allocations.
   */
  private async getOrCreateUrl(page: Page): Promise<string> {
    if (typeof page.src === 'string') return page.src;
    if (!(page.src instanceof Blob) || page.id == null) return '';

    if (!this.pageUrls.has(page.id)) {
      const url = await this.urlService.createUrl(`${page.id}`, page.src);
      this.pageUrls.set(page.id, url);
    }

    return this.pageUrls.get(page.id)!;
  }

  /**
   * Revokes object URLs for images outside the cleanup radius.
   * Called after each successful image load to keep memory bounded.
   */
  private cleanupFarImages(currentId: number): void {
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


  //  NAVIGATION 

  /**
   * Handles programmatic navigation to a specific page.
   * Preloads nearby pages then scrolls to target.
   */
  private async handleNavigation(pageId: number): Promise<void> {
    this.isNavigating = true;
    this.focusPageId = pageId;

    if (!this.isLoaderVisible) {
      this.loading.show();
      this.isLoaderVisible = true;
    }

    await this.waitForImages();

    const index = this.pageIndexMap.get(pageId);
    if (index === undefined) return;

    this.updateVisiblePages(index);

    await new Promise(r => requestAnimationFrame(r));
    await this.waitForImages();

    const PRELOAD_BEFORE = this.MAX_LOAD * 2;
    const PRELOAD_AFTER = this.MAX_LOAD;

    const start = Math.max(0, index - PRELOAD_BEFORE);
    const end = Math.min(this.visiblePages.length, index + PRELOAD_AFTER);
    const toLoad = this.visiblePages.slice(start, end);

    await Promise.all(
      toLoad.map(async (page) => {
        if (this.loadingSet.has(page.id!)) return;
        this.loadingSet.add(page.id!);

        try {
          await this.ensurePageLoaded(page);
          if (this.destroyed) return;

          const url = await this.getOrCreateUrl(page);
          if (this.destroyed) return;
          if (!url) return;

          const img = this.imgRefs.find(r =>
            Number(r.nativeElement.dataset['pageId']) === page.id
          )?.nativeElement;

          if (!img) return;

          await this.loadImage(img, url);
          if (this.destroyed) return;

        } finally {
          this.loadingSet.delete(page.id!);
        }
      })
    );

    // two frames to let layout settle before measuring offsets
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));

    const container = document.querySelector('.reader-container') as HTMLElement;
    const target = await this.waitForTarget(pageId);

    if (target && container) {
      container.scrollTo({ top: target.offsetTop - container.offsetTop, behavior: 'auto' });
    }

    this.reader.setCurrentPage(pageId);
    this.reader.setCurrentPageBookmark(pageId);
    this.updateActiveChapter(pageId);

    this.isNavigating = false;
    this.focusPageId = null;

    if (this.isLoaderVisible) {
      this.loading.hide();
      this.isLoaderVisible = false;
    }
  }

  /**
   * Scroll helper with retry logic for cases when the DOM isn't ready yet.
   */
  async scrollToPage(pageId: number): Promise<void> {
    this.focusPageId = pageId;

    if (!this.isLoaderVisible) {
      this.loading.show();
      this.isLoaderVisible = true;
    }

    let target: HTMLElement | undefined;
    let attempts = 0;

    while (attempts < 5 && !target) {
      await new Promise(r => setTimeout(r, 50));
      target = await this.waitForTarget(pageId);
      attempts++;
    }

    const container = document.querySelector('.reader-container') as HTMLElement;

    if (target && container) {
      container.scrollTo({ top: target.offsetTop - container.offsetTop, behavior: 'auto' });
    }
  }


  //  VIRTUAL WINDOW 

  /**
   * Updates the virtual window of rendered pages around a center index.
   *
   * - Keeps ~120 pages in the DOM at a time (WINDOW * 2).
   * - Revokes object URLs for pages leaving the window.
   * - Full reset if center jumps by more than JUMP_THRESHOLD.
   *
   * The full pages buffer in the service keeps growing - this only controls
   * which pages are rendered in the DOM at any given time.
   */
  private updateVisiblePages(centerIndex: number): void {
    const WINDOW = 60;
    const JUMP_THRESHOLD = 50;

    let start = centerIndex - WINDOW;
    let end = centerIndex + WINDOW;

    // clamp and shift to fill window at buffer edges
    if (end >= this.pages.length) {
      end = this.pages.length;
      start = Math.max(0, end - WINDOW * 2);
    }

    if (start <= 0) {
      start = 0;
      end = Math.min(this.pages.length, WINDOW * 2);
    }

    const newSlice = this.pages.slice(start, end);

    // first render - no comparison needed
    if (!this.visiblePages.length) {
      this.visiblePages = newSlice;
      return;
    }

    const firstId = this.visiblePages[0]?.id;
    const lastId = this.visiblePages[this.visiblePages.length - 1]?.id;

    const firstIndex = this.pageIndexMap.get(firstId!);
    const lastIndex = this.pageIndexMap.get(lastId!);

    // indices stale (e.g. after prev-merge shifted all indices) - just replace
    if (firstIndex === undefined || lastIndex === undefined) {
      this.visiblePages = newSlice;
      return;
    }

    const currentCenter = Math.floor((firstIndex + lastIndex) / 2);
    const distance = Math.abs(centerIndex - currentCenter);

    // large jump - revoke all cached URLs and fully replace window
    if (distance >= JUMP_THRESHOLD) {
      this.pageUrls.forEach((_, id) => { this.urlService.revokeUrl(String(id)); });
      this.pageUrls.clear();
      this.visiblePages = newSlice;
      return;
    }

    // no change - skip
    if (
      this.visiblePages.length === newSlice.length &&
      this.visiblePages.every((p, i) => p.id === newSlice[i].id)
    ) {
      return;
    }

    // partial update - revoke only URLs for pages leaving the window
    const newIds = new Set(newSlice.map(p => p.id));

    this.pageUrls.forEach((_, id) => {
      if (!newIds.has(id)) {
        this.urlService.revokeUrl(String(id));
        this.pageUrls.delete(id);
      }
    });

    this.visiblePages = newSlice;
  }


  //  SCROLL HELPERS 

  /**
   * Preserves scroll position around a DOM mutation.
   * Measures anchor top before callback, compensates after with scrollBy.
   * Prevents visible jump when pages are added/removed above the viewport.
   */
  private preserveScroll(anchorId: number, callback: () => void): void {
    const anchorEl = this.imgRefs.find(r =>
      Number(r.nativeElement.dataset['pageId']) === anchorId
    )?.nativeElement;

    if (!anchorEl) { callback(); return; }

    const prevTop = anchorEl.getBoundingClientRect().top;
    callback();

    requestAnimationFrame(() => {
      const newEl = this.imgRefs.find(r =>
        Number(r.nativeElement.dataset['pageId']) === anchorId
      )?.nativeElement;

      if (!newEl) return;

      window.scrollBy(0, newEl.getBoundingClientRect().top - prevTop);
    });
  }


  //  DOM WAIT HELPERS 

  /** Waits until at least one image ref exists in the DOM */
  private async waitForImages(): Promise<void> {
    let tries = 0;
    while (this.imgRefs && this.imgRefs.length === 0 && tries < 10) {
      await new Promise(r => setTimeout(r, 30));
      tries++;
    }
  }

  /**
   * Polls until target page's img element appears in DOM.
   * Used after window update to wait for Angular to render new elements.
   */
  private async waitForTarget(pageId: number): Promise<HTMLElement | undefined> {
    let attempts = 0;

    while (attempts < 20) {
      await new Promise(r => requestAnimationFrame(r));

      const el = this.imgRefs.find(r =>
        Number(r.nativeElement.dataset['pageId']) === pageId
      )?.nativeElement;

      if (el) return el;
      attempts++;
    }

    return undefined;
  }


  //  TEMPLATE GETTERS 

  get pages(): PageMeta[] {
    return this.reader.pages();
  }

  get readerMode() {
    return this.reader.mode();
  }

  get readerZoom() {
    return this.reader.zoom();
  }

  get readerGap() {
    return this.reader.gap();
  }
}