import { AfterViewInit, Component, QueryList, ViewChildren, ElementRef, OnDestroy, effect, DestroyRef, untracked, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Page } from '../../../core/models/page.model';
import { ObjectUrlService } from '../../../core/services/object-url.service';
import { LoadingService } from '../../../core/services/loading.service';
import { ReaderService } from '../../../core/services/reader.service';
import { isIOS } from '../../../shared/utils/constants';
import { PagesRepository } from '../../../core/repositories/pages.repository';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChaptersRepository } from 'src/app/core/repositories/chapters.repository';
import { PageMeta } from 'src/app/shared/models/page-meta.model';

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

  @ViewChild('readerContainer')
  private readerContainer!: ElementRef<HTMLDivElement>;

  /** Intersection observer for lazy loading */
  private observer!: IntersectionObserver;

  /**
   * Set of page ids currently being observed.
   * Used to add only NEW elements to the observer without disconnecting it,
   * which would cancel all pending intersection callbacks.
   */
  private observedPageIds = new Set<number>();

  // State flags that synchronize async UI workflows:
  // - isNavigating: true while programmatic page navigation owns scroll updates
  // - isPrepending: true while previous pages are inserted before current viewport
  // - isRestoringScroll: true while anchor-based scroll compensation is in progress
  // - freezeBookmarkUpdates: combined gate for observer-driven page/bookmark writes
  private isNavigating = false;
  private isPrepending = false;
  private isRestoringScroll = false;

  private get freezeBookmarkUpdates(): boolean {
    return this.isPrepending || this.isNavigating || this.isRestoringScroll;
  }

  private pageUrls = new Map<number, string>();

  /** pageId -> index in the full pages buffer */
  private pageIndexMap = new Map<number, number>();

  private MAX_LOAD = 12;
  private loadingCount = 0;
  private loadingSet = new Set<number>();
  private isLoaderVisible = false;

  /**
   * Navigation token is incremented on each navigation/open cycle.
   * Async steps compare token snapshots to ignore stale continuations.
   */
  private navToken = 0;

  private visibleUnloadedCount = 0;

  private loaderDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly LOADER_DELAY_MS = 300;

  private focusPageId: number | null = null;

  private CLEANUP_RADIUS = isIOS ? 20 : 50;

  private loadToken = 0;

  private BUFFER = 15;
  private CHAPTER_TRIGGER = 20;

  visiblePages: Page[] = [];

  private loadedChapterIds = new Set<number>();

  /** chapter id -> { firstPageId, lastPageId } for chapter boundary lookup */
  private chapterPageRanges = new Map<number, { first: number; last: number }>();

  private fetchingNext = false;
  private fetchingPrev = false;

  private scrollPreloadListener: (() => void) | null = null;
  private scrollPreloadThrottled = false;

  private initialOpenComplete = false;
  
  constructor(
    private urlService: ObjectUrlService,
    private loading: LoadingService,
    public reader: ReaderService,
    private pagesRepo: PagesRepository,
    private chaptersRepo: ChaptersRepository,
    private destroyRef: DestroyRef
  ) {

    // EFFECT: reacts to full pages buffer changes (open and merge flows)

    effect(() => {
      const pages = this.reader.pages();
      const pagesUpdateKind = this.reader.pagesUpdateKind();
      if (!pages?.length) return;

      this.pageIndexMap.clear();
      pages.forEach((p, i) => this.pageIndexMap.set(p.id!, i));

      if (pagesUpdateKind === 'merge') {
        // Merge flow: extend metadata, preserve current viewport anchor,
        // update virtual window, then reconnect observer to new DOM nodes.
        this.mergeChapterTracking(pages);

        const anchorId = untracked(() =>
          this.getViewportAnchorPageId() ??
          this.reader.currentPageBookmark() ??
          this.reader.currentPageId() ??
          this.visiblePages[0]?.id ??
          null
        );
        const anchorIndex = anchorId
          ? (this.pageIndexMap.get(anchorId) ?? 0)
          : 0;

        // Detect prepend by comparing the new first page index to current window start.
        const firstNewId = pages[0]?.id;
        const firstVisibleId = this.visiblePages[0]?.id;
        const isPrependMerge =
          firstNewId !== undefined &&
          firstVisibleId !== undefined &&
          firstNewId !== firstVisibleId &&
          (this.pageIndexMap.get(firstNewId) ?? 0) <
          (this.pageIndexMap.get(firstVisibleId) ?? 0);

        if (isPrependMerge) {
          this.isPrepending = true;
        }

        if (anchorId != null) {
          this.preserveScroll(anchorId, () => {
            this.updateVisiblePages(anchorIndex);
          });
        } else {
          this.updateVisiblePages(anchorIndex);
        }

        requestAnimationFrame(() => {
          this.observeNewImages();
          this.loadVisibleRange();

          if (isPrependMerge) {
            // In page mode, preserveScroll is a no-op, so scrollTop was not
            // adjusted when ch2 pages were inserted above the viewport.
            // Explicitly scroll back to the anchor so the correct snap page stays
            // visible and the observer does not cascade-fetch earlier chapters.
            if (this.reader.mode() === 'page' && anchorId != null) {
              this.scrollToPageImmediately(anchorId);
            }

            requestAnimationFrame(() => {
              this.isPrepending = false;

              // Run a wide-range preload pass after prepend guard is released.
              // This warms all images that were inserted above viewport so upward
              // scroll does not stall waiting for lazy-load to catch up.
              requestAnimationFrame(() => {
                this.loadVisibleRange(isIOS ? 8000 : 12000);
              });
            });
          }
        });
        return;
      }

      // Open flow: reset runtime state, clear caches, rebuild tracking and observers.

      this.pageUrls.forEach((_, id) => { this.urlService.revokeUrl(String(id)); });
      this.pageUrls.clear();

      const currentPageId = untracked(() => this.reader.currentPageId());
      const startIndex = currentPageId
        ? (this.pageIndexMap.get(currentPageId) ?? 0)
        : 0;

      this.updateVisiblePages(startIndex);

      this.loadingSet.clear();
      this.loadingCount = 0;
      this.visibleUnloadedCount = 0;
      this.cancelLoaderDebounce();

      this.focusPageId = null;
      this.fetchingNext = false;
      this.fetchingPrev = false;

      // Reset all state guards for a new reader session.
      this.isPrepending = false;
      this.isRestoringScroll = false;
      this.isNavigating = false;

      this.rebuildChapterTracking(pages);
      this.showLoaderNow();

      this.loadToken++;
      this.navToken++;

      const container = this.readerContainer?.nativeElement;
      if (container) container.scrollTop = 0;

      requestAnimationFrame(() => {
        this.setupObserver();
        this.observeAllImages();
        this.setupScrollPreloadListener();

        if (this.reader.isOpen()) {
          this.reader.resetIsOpen();
          // On initial open, preload only next chapter.
          // Prepending previous chapter at this moment can shift viewport on iOS.
          this.tryLoadAdjacentChapters(startIndex, { allowPrev: false });
        }

          requestAnimationFrame(() => {
    this.initialOpenComplete = true;
  });
      });
    });


    // EFFECT: reacts to navigation tick and starts programmatic page navigation.

    effect(() => {
      this.reader.navTick();
      const pageId = untracked(() => this.reader.currentPageId());

      if (!pageId) return;

      this.handleNavigation(pageId);
    });


    // EFFECT: mode change updates observer root and scroll anchor behavior.

    effect(() => {
      const mode = this.reader.mode();
      untracked(() => {
        if (!this.reader.pages().length) return;

        const anchorId =
          this.getViewportAnchorPageId() ??
          this.reader.currentPageBookmark() ??
          this.reader.currentPageId() ??
          null;

        this.navToken++;
        this.isNavigating = true;
        this.focusPageId = anchorId;

        if (anchorId != null) {
          const anchorIndex = this.pageIndexMap.get(anchorId);
          if (anchorIndex !== undefined) {
            this.updateVisiblePages(anchorIndex);
          }

          this.reader.setCurrentPage(anchorId);
          this.reader.setCurrentPageBookmark(anchorId);
          this.updateActiveChapter(anchorId);
        }

        this.visibleUnloadedCount = 0;
        this.cancelLoaderDebounce();
        this.hideLoader();

        requestAnimationFrame(() => {
          this.setupObserver();
          this.observeAllImages();

          if (anchorId != null) {
            this.scrollToPageImmediately(anchorId);
          }

          requestAnimationFrame(() => {
            if (this.destroyed) return;
            this.isNavigating = false;
            this.focusPageId = null;
            this.loadVisibleRange();
          });
        });
      });
    });

    // EFFECT: zoom/gap change reflows layout and keeps viewport anchored.

    effect(() => {
      const zoom = this.reader.zoom();
      const gap = this.reader.gap();

      untracked(() => {
        if (!this.reader.pages().length) return;

        const anchorId =
          this.getViewportAnchorPageId() ??
          this.reader.currentPageBookmark() ??
          this.reader.currentPageId() ??
          null;

        if (anchorId == null) return;

        const anchorIndex = this.pageIndexMap.get(anchorId);
        if (anchorIndex === undefined) return;

        this.preserveScroll(anchorId, () => {
          this.updateVisiblePages(anchorIndex);
        });
      });
    });
  }


  ngAfterViewInit(): void {
    this.setupObserver();

    this.imgRefs.changes
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.observeNewImages();
      });
  }

  private destroyed = false;

  ngOnDestroy(): void {
    this.destroyed = true;
    this.observer?.disconnect();
    this.observedPageIds.clear();
    this.teardownScrollPreloadListener();
    this.cancelLoaderDebounce();
    this.hideLoader();
    this.pageUrls.forEach((_, id) => { this.urlService.revokeUrl(String(id)); });
    this.pageUrls.clear();
  }


  // LOADER

  /** Returns true if image rect intersects current reader container viewport. */
  private isImageInViewport(img: HTMLImageElement): boolean {
    const container = this.readerContainer?.nativeElement;
    if (!container) {
      const rect = img.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight;
    }

    const containerRect = container.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();

    return imgRect.bottom > containerRect.top && imgRect.top < containerRect.bottom;
  }

  // Shows loader immediately for explicit wait states.
  private showLoaderNow(): void {
    this.cancelLoaderDebounce();
    this.loading.show();
    this.isLoaderVisible = true;
  }

  // Schedules loader with debounce to avoid flicker on fast loads.
  private scheduleLoader(): void {
    if (this.isLoaderVisible || this.loaderDebounceTimer) return;

    this.loaderDebounceTimer = setTimeout(() => {
      this.loaderDebounceTimer = null;
      if (this.visibleUnloadedCount > 0) {
        this.loading.show();
        this.isLoaderVisible = true;
      }
    }, this.LOADER_DELAY_MS);
  }

  // Hides loader and clears delayed show request.
  private hideLoader(): void {
    this.cancelLoaderDebounce();
    if (this.isLoaderVisible) {
      this.loading.hide();
      this.isLoaderVisible = false;
    }
  }

  // Cancels pending loader debounce timer.
  private cancelLoaderDebounce(): void {
    if (this.loaderDebounceTimer) {
      clearTimeout(this.loaderDebounceTimer);
      this.loaderDebounceTimer = null;
    }
  }


  // OBSERVER

  // Creates observer and handles page tracking + lazy loading pipeline.
  private setupObserver() {
    this.observer?.disconnect();
    this.observedPageIds.clear();

    const root = this.readerContainer?.nativeElement ?? null;

    this.observer = new IntersectionObserver(async (entries) => {

      // Skip observer writes while scroll/navigation/prepend workflows own state.
      if (this.isNavigating || this.isPrepending || this.isRestoringScroll) return;

      const token = this.loadToken;

      const containerRect = root?.getBoundingClientRect();
      const containerHeight = containerRect?.height ?? window.innerHeight;
      const containerTop = containerRect?.top ?? 0;

      let centerY = containerHeight / 2;

      if (this.focusPageId !== null) {
        const el = this.imgRefs.find(r =>
          Number(r.nativeElement.dataset['pageId']) === this.focusPageId
        )?.nativeElement;

        if (el) {
          const rect = el.getBoundingClientRect();
          centerY = (rect.top - containerTop) + rect.height / 2;
        }
      }

      const visible = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => {
          const aCenter = (a.boundingClientRect.top - containerTop) + a.boundingClientRect.height / 2;
          const bCenter = (b.boundingClientRect.top - containerTop) + b.boundingClientRect.height / 2;
          return Math.abs(aCenter - centerY) - Math.abs(bCenter - centerY);
        })
        .slice(0, this.MAX_LOAD * 2);

      // Update reading position from currently visible anchor page.
      this.updateReadingPosition();

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
            // Shift virtual window around visible range and preserve viewport anchor.
            if (!this.isPrepending && !this.isRestoringScroll) {
              this.preserveScroll(id, () => { this.updateVisiblePages(globalIndex); });
            }
            windowUpdated = true;
          }

          this.tryLoadAdjacentChapters(globalIndex, { allowPrev: this.initialOpenComplete });
        }

        const page = this.visiblePages.find(p => p.id === id);
        if (!page) continue;

        if (this.loadingSet.has(id)) continue;
        if (this.loadingCount >= this.MAX_LOAD) continue;

        const inViewport = this.isImageInViewport(img);
        if (inViewport) {
          this.visibleUnloadedCount++;
          this.scheduleLoader();
        }

        this.loadingSet.add(id);
        this.loadingCount++;

        try {

          await this.ensurePageLoaded(page);
          if (this.destroyed) return;

          if (token !== this.loadToken) return;

          const alreadyExists = this.pageUrls.has(page.id!);

          const url = await this.getOrCreateUrl(page);
          if (this.destroyed) return;

          if (token !== this.loadToken) {
            if (!alreadyExists && url) this.urlService.revokeUrl(url);
            return;
          }

          if (!url) continue;

          await this.loadImage(img, url);
          if (this.destroyed) return;

          this.cleanupFarImages(id);

        } finally {
          this.loadingSet.delete(id);
          this.loadingCount--;

          if (inViewport && this.visibleUnloadedCount > 0) {
            this.visibleUnloadedCount--;
          }

          if (this.visibleUnloadedCount === 0) {
            this.hideLoader();
          }
        }
      }

    }, {
      root,
      rootMargin: this.reader.mode() === 'page'
        ? '0px'
        : (isIOS ? '1500px' : '2500px'),
      threshold: 0,
    });
  }

  // Connects observer to all currently rendered image elements.
  private observeAllImages() {
    this.observedPageIds.clear();

    this.imgRefs.forEach(ref => {
      const id = Number(ref.nativeElement.dataset['pageId']);
      this.observer.observe(ref.nativeElement);
      this.observedPageIds.add(id);
    });
  }

  // Connects observer only to newly rendered images after DOM updates.
  private observeNewImages() {
    this.imgRefs.forEach(ref => {
      const id = Number(ref.nativeElement.dataset['pageId']);

      if (!this.observedPageIds.has(id)) {
        this.observer.observe(ref.nativeElement);
        this.observedPageIds.add(id);
      }
    });

    const currentIds = new Set(
      this.imgRefs.map(r => Number(r.nativeElement.dataset['pageId']))
    );

    this.observedPageIds.forEach(id => {
      if (!currentIds.has(id)) {
        this.observedPageIds.delete(id);
      }
    });
  }


  // Updates current page / bookmark / chapter from the most-visible image in the viewport.
  // Called both from the IntersectionObserver callback and the scroll listener so that
  // scrolling up through already-loaded images (which produces no observer state changes)
  // still updates the reading position correctly.
  private updateReadingPosition(): void {
    if (this.freezeBookmarkUpdates || this.focusPageId !== null) return;

    const container = this.readerContainer?.nativeElement;
    const containerRect = container?.getBoundingClientRect();
    const containerHeight = containerRect?.height ?? window.innerHeight;
    const containerTop = containerRect?.top ?? 0;

    let anchorId: number | null = null;
    let bestOverlap = 0;

    this.imgRefs.forEach(ref => {
      const img = ref.nativeElement;
      const rect = img.getBoundingClientRect();
      const overlapTop = Math.max(rect.top, containerTop);
      const overlapBottom = Math.min(rect.bottom, containerTop + containerHeight);
      const overlap = Math.max(0, overlapBottom - overlapTop);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        anchorId = Number(img.dataset['pageId']) || null;
      }
    });

    if (!anchorId) return;

    // In scroll mode observer owns active page tracking.
    // In page mode currentPage is navigation state and
    // must not be mutated from scroll observation,
    // otherwise handleNavigation() re-triggers and teleports scroll.
    if (this.reader.mode() !== 'page') {
      if (this.reader.currentPageId() !== anchorId) {
        this.reader.setCurrentPage(anchorId);
      }
    }

    // Bookmark can still follow viewport in both modes.
    if (this.reader.currentPageBookmark() !== anchorId) {
      this.reader.setCurrentPageBookmark(anchorId);
    }

    this.updateActiveChapter(anchorId);
  }


  // SCROLL PRELOAD

  // Attaches throttled scroll listener used for imperative upward preload.
  private setupScrollPreloadListener() {
    this.teardownScrollPreloadListener();

    const container = this.readerContainer?.nativeElement;
    if (!container) return;

    this.scrollPreloadListener = () => {
      if (this.scrollPreloadThrottled || this.isNavigating || this.isPrepending) return;

      this.scrollPreloadThrottled = true;

      requestAnimationFrame(() => {
        this.loadVisibleRange();
        this.updateReadingPosition();
        this.scrollPreloadThrottled = false;
      });
    };

    container.addEventListener('scroll', this.scrollPreloadListener, { passive: true });
  }

  // Removes scroll preload listener from current container.
  private teardownScrollPreloadListener() {
    if (!this.scrollPreloadListener) return;

    const container = this.readerContainer?.nativeElement;
    container?.removeEventListener('scroll', this.scrollPreloadListener!);
    this.scrollPreloadListener = null;
  }

  /**
   * Imperative preload pass for images near viewport.
   * Complements IntersectionObserver for browsers where upward preload can lag.
   * Pass preloadPx to override the default lookahead distance (e.g. after prepend).
   */
  private loadVisibleRange(preloadPx?: number) {
    // Avoid preload during active restore/prepend to keep layout stable.
    if (this.isPrepending || this.isRestoringScroll) return;

    const PRELOAD_PX = preloadPx ?? (isIOS ? 1500 : 2500);
    const token = this.loadToken;

    const container = this.readerContainer?.nativeElement;
    const containerRect = container?.getBoundingClientRect();
    const containerTop = containerRect?.top ?? 0;
    const containerBottom = containerRect?.bottom ?? window.innerHeight;

    this.imgRefs.forEach(ref => {
      if (this.destroyed) return;
      if (token !== this.loadToken) return;

      const img = ref.nativeElement;
      const id = Number(img.dataset['pageId']);

      if (img.src && img.complete && img.naturalHeight > 0) return;
      if (this.loadingSet.has(id)) return;
      if (this.loadingCount >= this.MAX_LOAD) return;

      const rect = img.getBoundingClientRect();

      const inRange =
        rect.bottom >= containerTop - PRELOAD_PX &&
        rect.top <= containerBottom + PRELOAD_PX;

      if (!inRange) return;

      const page = this.visiblePages.find(p => p.id === id);
      if (!page) return;

      const inViewport = this.isImageInViewport(img);
      if (inViewport) {
        this.visibleUnloadedCount++;
        this.scheduleLoader();
      }

      this.loadingSet.add(id);
      this.loadingCount++;

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
        .catch(() => { /* silent - observer will retry on next scroll */ })
        .finally(() => {
          this.loadingSet.delete(id);
          this.loadingCount--;

          if (inViewport && this.visibleUnloadedCount > 0) {
            this.visibleUnloadedCount--;
          }

          if (this.visibleUnloadedCount === 0) {
            this.hideLoader();
          }
        });
    });
  }


  // CHAPTER TRACKING

  // Rebuilds chapter ranges from scratch for clean open flow.
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
        this.chapterPageRanges.set(chapterId, { first: pageId, last: pageId });
        continue;
      }

      range.last = pageId;
    }
  }

  // Extends chapter ranges incrementally after merge updates.
  private mergeChapterTracking(pages: PageMeta[]): void {
    for (const page of pages) {
      const chapterId = page.chapterId;
      const pageId = page.id;

      if (chapterId == null || pageId == null) continue;

      this.loadedChapterIds.add(chapterId);

      const range = this.chapterPageRanges.get(chapterId);
      if (!range) {
        this.chapterPageRanges.set(chapterId, { first: pageId, last: pageId });
        continue;
      }

      const pageIndex = this.pageIndexMap.get(pageId);
      const firstIndex = this.pageIndexMap.get(range.first);
      const lastIndex = this.pageIndexMap.get(range.last);

      if (pageIndex !== undefined && firstIndex !== undefined && pageIndex < firstIndex) {
        range.first = pageId;
      }
      if (pageIndex !== undefined && lastIndex !== undefined && pageIndex > lastIndex) {
        range.last = pageId;
      }
    }
  }


  // CHAPTER BOUNDARY TRACKING

  // Resolves active chapter by current page index and cached ranges.
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


  // SEAMLESS CHAPTER LOADING

  /** Triggers adjacent chapter preload when reading position approaches buffer edges. */
  private tryLoadAdjacentChapters(
    globalIndex: number,
    options: { allowNext?: boolean; allowPrev?: boolean } = {}
  ): void {
    const total = this.reader.pages().length;
    const chapterId = this.reader.chapterId();
    const allowNext = options.allowNext ?? true;
    const allowPrev = options.allowPrev ?? true;

    if (!chapterId) return;

    // next chapter

    if (allowNext && !this.fetchingNext && globalIndex >= total - this.CHAPTER_TRIGGER) {
      this.fetchingNext = true;

      this.chaptersRepo.getNextChapter(chapterId)
        .then(next => {
          const nextId = next?.id;
          if (!nextId || this.loadedChapterIds.has(nextId)) {
            this.fetchingNext = false;
            return;
          }

          return this.pagesRepo.getMetaByChapter(nextId).then(newPages => {
            if (!newPages?.length) { this.fetchingNext = false; return; }

            this.loadedChapterIds.add(nextId);
            this.reader.mergePages(newPages, 'next');
            this.fetchingNext = false;
          });
        })
        .catch(() => { this.fetchingNext = false; });
    }

    // previous chapter

    if (allowPrev && !this.fetchingPrev && globalIndex <= this.CHAPTER_TRIGGER) {
      this.fetchingPrev = true;

      this.chaptersRepo.getPrevChapter(chapterId)
        .then(prev => {
          const prevId = prev?.id;
          if (!prevId || this.loadedChapterIds.has(prevId)) {
            this.fetchingPrev = false;
            return;
          }

          return this.pagesRepo.getMetaByChapter(prevId).then(newPages => {
            if (!newPages?.length) { this.fetchingPrev = false; return; }

            this.loadedChapterIds.add(prevId);
            this.reader.mergePages(newPages, 'prev');
            this.fetchingPrev = false;
          });
        })
        .catch(() => { this.fetchingPrev = false; });
    }
  }


  // IMAGE LOADING

  // Assigns image src and waits until load/error/timeout completion.
  private async loadImage(img: HTMLImageElement, url: string): Promise<void> {
    return new Promise<void>((resolve) => {
      if (img.src === url && img.complete) { resolve(); return; }

      const timeout = setTimeout(resolve, 10000);

      img.onload = () => { clearTimeout(timeout); resolve(); };
      img.onerror = () => { clearTimeout(timeout); resolve(); };

      img.src = url;
    });
  }

  // Fetches full page payload lazily when metadata-only page is visible.
  private async ensurePageLoaded(page: Page): Promise<void> {
    if (page.src) return;

    const full = await this.pagesRepo.get(page.id!);

    if (full) {
      page.src = full.src;
      page.order = full.order;
    }
  }

  // Returns direct url or creates cached object url for blob-based page source.
  private async getOrCreateUrl(page: Page): Promise<string> {
    if (typeof page.src === 'string') return page.src;
    if (!(page.src instanceof Blob) || page.id == null) return '';

    if (!this.pageUrls.has(page.id)) {
      const url = await this.urlService.createUrl(`${page.id}`, page.src);
      this.pageUrls.set(page.id, url);
    }

    return this.pageUrls.get(page.id)!;
  }

  /** Revokes object URLs for pages outside cleanup radius around current page. */
  private cleanupFarImages(currentId: number): void {
    // Skip cleanup while restore is in progress to avoid repaint interference.
    if (this.isRestoringScroll) return;

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


  // NAVIGATION

  // Performs controlled navigation to target page with preload and scroll sync.
  private async handleNavigation(pageId: number): Promise<void> {
    const navToken = ++this.navToken;

    this.focusPageId = pageId;
    this.showLoaderNow();

    try {
      await this.waitForImages();
      if (this.destroyed || navToken !== this.navToken) return;

      const index = await this.resolvePageIndexForNavigation(pageId);
      if (this.destroyed || navToken !== this.navToken) return;

      if (index === undefined) return;

      this.isNavigating = true;
      this.updateVisiblePages(index);

      await new Promise(r => requestAnimationFrame(r));
      if (navToken !== this.navToken) return;

      await this.waitForImages();
      if (navToken !== this.navToken) return;

      const PRELOAD_BEFORE = this.MAX_LOAD * 2;
      const PRELOAD_AFTER = this.MAX_LOAD;

      const localIndex = this.visiblePages.findIndex(p => p.id === pageId);
      if (localIndex === -1) return;

      const start = Math.max(0, localIndex - PRELOAD_BEFORE);
      const end = Math.min(this.visiblePages.length, localIndex + PRELOAD_AFTER + 1);
      const toLoad = this.visiblePages.slice(start, end);

      await Promise.all(
        toLoad.map(async (page) => {
          if (this.loadingSet.has(page.id!)) return;
          this.loadingSet.add(page.id!);

          try {
            await this.ensurePageLoaded(page);
            if (this.destroyed || navToken !== this.navToken) return;

            const url = await this.getOrCreateUrl(page);
            if (this.destroyed || navToken !== this.navToken) return;
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

      if (navToken !== this.navToken) return;

      await new Promise<void>(resolve => {
        requestAnimationFrame(() => {
          void document.body.offsetHeight;
          resolve();
        });
      });

      if (navToken !== this.navToken) return;

      const container = this.readerContainer?.nativeElement;
      const target = await this.waitForTarget(pageId);

      if (target && container) {
        container.scrollTo({
          top: this.getContainerRelativeTop(target, container),
          behavior: 'auto',
        });
      }

      this.reader.setCurrentPage(pageId);
      this.reader.setCurrentPageBookmark(pageId);
      this.updateActiveChapter(pageId);

    } finally {
      this.isNavigating = false;
      if (navToken === this.navToken) {
        this.focusPageId = null;
        this.hideLoader();
      }
    }
  }

  // Ensures target page exists in buffer and returns its global index.
  private async resolvePageIndexForNavigation(pageId: number): Promise<number | undefined> {
    const directIndex = this.pageIndexMap.get(pageId);
    if (directIndex !== undefined) return directIndex;

    const targetPage = await this.pagesRepo.get(pageId);
    const targetChapterId = targetPage?.chapterId;

    if (!targetPage || targetChapterId == null) return undefined;

    if (!this.loadedChapterIds.has(targetChapterId)) {
      const newPages = await this.pagesRepo.getMetaByChapter(targetChapterId);
      if (!newPages.length) return undefined;

      let direction: 'next' | 'prev' = 'next';
      const currentChapterId = this.reader.chapterId();

      if (currentChapterId != null) {
        const [currentChapter, targetChapter] = await Promise.all([
          this.chaptersRepo.get(currentChapterId),
          this.chaptersRepo.get(targetChapterId),
        ]);

        if (currentChapter && targetChapter && targetChapter.order < currentChapter.order) {
          direction = 'prev';
        }
      }

      this.loadedChapterIds.add(targetChapterId);
      this.reader.mergePages(newPages, direction);
    }

    for (let i = 0; i < 10; i++) {
      if (this.destroyed) return undefined;

      const index = this.pageIndexMap.get(pageId);
      if (index !== undefined) return index;

      await new Promise<void>(resolve => {
        requestAnimationFrame(() => resolve());
      });
    }

    return this.pageIndexMap.get(pageId);
  }


  // VIRTUAL WINDOW

  // Recomputes virtual window slice around center index and evicts old urls.
  private updateVisiblePages(centerIndex: number): void {
    const WINDOW = 60;
    const JUMP_THRESHOLD = 50;

    let start = centerIndex - WINDOW;
    let end = centerIndex + WINDOW;

    if (end >= this.pages.length) {
      end = this.pages.length;
      start = Math.max(0, end - WINDOW * 2);
    }

    if (start <= 0) {
      start = 0;
      end = Math.min(this.pages.length, WINDOW * 2);
    }

    const newSlice = this.pages.slice(start, end);

    if (!this.visiblePages.length) {
      this.visiblePages = newSlice;
      return;
    }

    const firstId = this.visiblePages[0]?.id;
    const lastId = this.visiblePages[this.visiblePages.length - 1]?.id;

    const firstIndex = this.pageIndexMap.get(firstId!);
    const lastIndex = this.pageIndexMap.get(lastId!);

    if (firstIndex === undefined || lastIndex === undefined) {
      this.visiblePages = newSlice;
      return;
    }

    const currentCenter = Math.floor((firstIndex + lastIndex) / 2);
    const distance = Math.abs(centerIndex - currentCenter);

    if (distance >= JUMP_THRESHOLD) {
      this.pageUrls.forEach((_, id) => { this.urlService.revokeUrl(String(id)); });
      this.pageUrls.clear();
      this.visiblePages = newSlice;
      return;
    }

    if (
      this.visiblePages.length === newSlice.length &&
      this.visiblePages.every((p, i) => p.id === newSlice[i].id)
    ) {
      return;
    }

    const newIds = new Set(newSlice.map(p => p.id));

    this.pageUrls.forEach((_, id) => {
      if (!newIds.has(id)) {
        this.urlService.revokeUrl(String(id));
        this.pageUrls.delete(id);
      }
    });

    this.visiblePages = newSlice;
  }


  // SCROLL HELPERS

  /**
   * Preserves viewport position around DOM mutations by anchoring to a page element.
   * Workflow:
   * - capture anchor top in viewport coordinates
   * - apply mutation callback (window update / merge render)
   * - in microtask, read new anchor top and apply scroll delta compensation
   */
  private preserveScroll(anchorId: number, callback: () => void): void {
    if (this.reader.mode() === 'page') {
      callback();
      return;
    }

    const container = this.readerContainer?.nativeElement;

    if (this.isNavigating || !container) {
      callback();
      return;
    }

    // If restore is already running, defer compensation to the outer cycle.
    if (this.isRestoringScroll) {
      callback();
      return;
    }

    const anchorEl = this.imgRefs.find(r =>
      Number(r.nativeElement.dataset['pageId']) === anchorId
    )?.nativeElement;

    if (!anchorEl) { callback(); return; }

    // Capture current anchor position in viewport coordinates.
    const prevAnchorViewportTop = anchorEl.getBoundingClientRect().top;

    this.isRestoringScroll = true;

    callback();

    // Compensate in rAF so Angular has finished re-rendering the DOM before we
    // read the new anchor position. queueMicrotask fires before Angular's CD
    // updates the DOM, so the shift would be zero and compensation would be lost.
    requestAnimationFrame(() => {
      // Re-query anchor after DOM update because original element can be replaced.
      const newAnchorEl = this.imgRefs.find(r =>
        Number(r.nativeElement.dataset['pageId']) === anchorId
      )?.nativeElement;

      if (newAnchorEl) {
        const newAnchorViewportTop = newAnchorEl.getBoundingClientRect().top;
        // Apply exact visual shift to keep anchor at the same screen position.
        const shift = newAnchorViewportTop - prevAnchorViewportTop;
        if (Math.abs(shift) > 0.5) {
          container.scrollTop += shift;
        }
      }

      this.isRestoringScroll = false;
    });
  }

  // Scrolls container to a specific page without animation.
  private scrollToPageImmediately(pageId: number): void {
    const container = this.readerContainer?.nativeElement;
    if (!container) return;

    const target = this.imgRefs.find(r =>
      Number(r.nativeElement.dataset['pageId']) === pageId
    )?.nativeElement;

    if (!target) return;

    container.scrollTo({
      top: this.getContainerRelativeTop(target, container),
      behavior: 'auto',
    });
  }

  // Returns page id closest to viewport center for stable anchoring.
  private getViewportAnchorPageId(): number | null {
    const container = this.readerContainer?.nativeElement;
    if (!container || !this.imgRefs?.length) return null;

    const containerRect = container.getBoundingClientRect();
    const viewportCenter = containerRect.top + containerRect.height / 2;

    let bestId: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    this.imgRefs.forEach(ref => {
      const img = ref.nativeElement;
      const id = Number(img.dataset['pageId']);
      if (!id) return;

      const rect = img.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      const distance = Math.abs(center - viewportCenter);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = id;
      }
    });

    return bestId;
  }

  // Converts element position into container scroll coordinates.
  private getContainerRelativeTop(target: HTMLElement, container: HTMLElement): number {
    const targetRect = target.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return targetRect.top - containerRect.top + container.scrollTop;
  }


  // DOM WAIT HELPERS

  // Waits until image refs are present after render updates.
  private async waitForImages(): Promise<void> {
    let tries = 0;
    while (this.imgRefs && this.imgRefs.length === 0 && tries < 10) {
      await new Promise(r => setTimeout(r, 30));
      tries++;
    }
  }

  // Polls DOM frames until requested page element appears.
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


  // TEMPLATE GETTERS

  // Template accessor for full pages buffer.
  get pages(): PageMeta[] {
    return this.reader.pages();
  }

  // Template accessor for current reader mode.
  get readerMode() {
    return this.reader.mode();
  }

  // Template accessor for current zoom coefficient.
  get readerZoom() {
    return this.reader.zoom();
  }

  // Template accessor for page gap in scroll mode.
  get readerGap() {
    return this.reader.gap();
  }
}