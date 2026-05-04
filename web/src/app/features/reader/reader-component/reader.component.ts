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

  /**
   * Incremented on every new handleNavigation call.
   * Stale async continuations compare against this and abort early,
   * which prevents concurrent navigations from fighting over scroll/state.
   * Also incremented on clean open so a navigation from the previous session
   * cannot corrupt freshly opened reader state.
   */
  private navToken = 0;

  /**
   * Number of pages that are currently in the viewport and not yet loaded.
   * Loader is shown only when this is > 0 - background preloads don't count.
   */
  private visibleUnloadedCount = 0;

  /**
   * Debounce timer for showing the loader.
   * Prevents flicker when images load quickly enough that the user never notices.
   * The loader only appears if pages are STILL unloaded after LOADER_DELAY_MS.
   */
  private loaderDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** How long to wait before showing the loader (ms) */
  private readonly LOADER_DELAY_MS = 300;

  /** Page used as scroll focus center during navigation */
  private focusPageId: number | null = null;

  /**
   * Radius for keeping image URLs in memory.
   * URLs outside this range are revoked to free memory.
   */
  private CLEANUP_RADIUS = isIOS ? 20 : 50;

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
   * Reset only on clean open - NOT on merge, otherwise already-loaded chapters
   * get re-fetched on every merge and performance degrades the longer you read.
   */
  private loadedChapterIds = new Set<number>();

  /**
   * chapter id -> { firstPageId, lastPageId }
   * Used to detect when the bookmark crosses a chapter boundary
   * so  can update reader.chapterId() correctly.
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

      if (pagesUpdateKind === 'merge') {
        //  seamless merge: minimal update, no scroll reset 
        //
        // Recalculate the visible window without losing scroll position,
        // and re-attach the observer to any newly rendered elements.
        //
        // rebuildChapterTracking is NOT called here - it clears loadedChapterIds
        // which causes already-loaded chapters to be re-fetched on every merge,
        // degrading performance the longer you read (classic "gets laggier" bug).
        // Instead,  update chapterPageRanges incrementally via mergeChapterTracking.

        this.mergeChapterTracking(pages);

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

      // reset visible counter on clean open - stale count from a previous session
      // would keep the loader stuck forever or suppress it incorrectly
      this.visibleUnloadedCount = 0;
      this.cancelLoaderDebounce();

      this.focusPageId = null;

      this.fetchingNext = false;
      this.fetchingPrev = false;

      // full chapter tracking reset only on clean open
      this.rebuildChapterTracking(pages);

      // show loader immediately on clean open - user is waiting for first paint
      this.showLoaderNow();

      this.loadToken++;

      // cancel any navigation that was started for the previous session
      this.navToken++;

      const container = this.readerContainer?.nativeElement;
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
      this.reader.navTick();
      const pageId = untracked(() => this.reader.currentPageId());

      if (!pageId) return;

      this.handleNavigation(pageId);
    });


    //  EFFECT: mode changed 
    //
    // When switching between scroll and page mode the observer root changes
    // (scroll mode uses window, page mode uses the container), so the observer
    // must be recreated with the correct root. Also resets the visible counter
    // because the viewport geometry is completely different in each mode -
    // a stale counter would cause infinite loader or suppress it incorrectly.

    effect(() => {
      const mode = this.reader.mode();
      untracked(() => {
        if (!this.reader.pages().length) return;

        // Mode switch changes layout metrics (snap/size), so keep an explicit
        // anchor page to prevent browser snap from jumping to a different image.
        const anchorId =
          this.getViewportAnchorPageId() ??
          this.reader.currentPageBookmark() ??
          this.reader.currentPageId() ??
          null;

        // Cancel any in-flight programmatic navigation started before mode switch.
        this.navToken++;
        this.isNavigating = true;
        this.focusPageId = anchorId;

        if (anchorId != null) {
          const anchorIndex = this.pageIndexMap.get(anchorId);
          if (anchorIndex !== undefined) {
            this.updateVisiblePages(anchorIndex);
          }

          // Keep reader state in sync with the anchored page so follow-up
          // observer updates do not snap to a stale bookmark/currentPage.
          this.reader.setCurrentPage(anchorId);
          this.reader.setCurrentPageBookmark(anchorId);
          this.updateActiveChapter(anchorId);
        }

        // reset loader state - old counter is meaningless after mode switch
        this.visibleUnloadedCount = 0;
        this.cancelLoaderDebounce();
        this.hideLoader();

        // recreate observer with the correct root for the new mode
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

    //  EFFECT: zoom changed 
    //
    // Changing zoom modifies layout metrics (image height changes),
    // which shifts offsetTop for every element in the DOM.
    // If not compensated, scrollTop stays the same and viewport
    // jumps to a different page (anchor breaks).
    //
    // Fixed by capturing anchor and compensating scroll via preserveScroll.
    // This keeps the same visual position without triggering navigation.

    effect(() => {
      const zoom = this.reader.zoom();

      untracked(() => {
        if (!this.reader.pages().length) return;

        // Anchor = closest to viewport center (most stable during layout shifts)
        // Fallbacks ensure recovery if observer/bookmark lag behind.
        const anchorId =
          this.getViewportAnchorPageId() ??
          this.reader.currentPageBookmark() ??
          this.reader.currentPageId() ??
          null;

        if (anchorId == null) return;

        const anchorIndex = this.pageIndexMap.get(anchorId);
        if (anchorIndex === undefined) return;

        // IMPORTANT:
        // This is a pure layout compensation, not navigation.
        // No navToken, no isNavigating, no observer reset.
        //
        // Only scroll is corrected relative to anchor.
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
    this.cancelLoaderDebounce();
    this.hideLoader();
    this.pageUrls.forEach((_, id) => { this.urlService.revokeUrl(String(id)); });
    this.pageUrls.clear();
  }


  //  LOADER 

  /**
   * Returns true if the image is currently intersecting the actual viewport.
   * Checks against the reader container bounds, not window - because in page
   * mode scroll happens inside the container, not the window.
   */
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

  /**
   * Shows loader immediately, bypassing the debounce.
   * Only used on clean open where the user is explicitly waiting.
   */
  private showLoaderNow(): void {
    this.cancelLoaderDebounce();
    this.loading.show();
    this.isLoaderVisible = true;
  }

  /**
   * Schedules loader to appear after LOADER_DELAY_MS if visibleUnloadedCount
   * is still > 0 at that point. This prevents flicker for fast loads -
   * the loader only shows when the user is genuinely waiting.
   */
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

  /**
   * Hides the loader and cancels any pending debounce timer.
   * Safe to call even if nothing is showing.
   */
  private hideLoader(): void {
    this.cancelLoaderDebounce();
    if (this.isLoaderVisible) {
      this.loading.hide();
      this.isLoaderVisible = false;
    }
  }

  private cancelLoaderDebounce(): void {
    if (this.loaderDebounceTimer) {
      clearTimeout(this.loaderDebounceTimer);
      this.loaderDebounceTimer = null;
    }
  }


  //  OBSERVER 

  private setupObserver() {
    this.observer?.disconnect();
    this.observedPageIds.clear();

    // root = reader container so rootMargin is measured against it, not window.
    // Critical in page mode where the container (not window) is the scroll host.
    // In scroll mode the container IS effectively the viewport so this is safe too.
    const root = this.readerContainer?.nativeElement ?? null;

    this.observer = new IntersectionObserver(async (entries) => {

      if (this.isNavigating) return;

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

        // snapshot viewport state at the moment  START loading -
        // by the time finally runs the user may have scrolled away,
        // so isImageInViewport() in finally would return a different value
        // and the counter would never decrement -> infinite loader
        //
        // IMPORTANT: increment only AFTER the skip checks above -
        // skipped entries never reach try/finally, so the counter would
        // leak and never reach 0 -> infinite loader (page mode bug)
        const inViewport = this.isImageInViewport(img);
        if (inViewport) {
          this.visibleUnloadedCount++;
          this.scheduleLoader();
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

          // use the snapshotted inViewport - not a fresh call - to match the increment above
          if (inViewport && this.visibleUnloadedCount > 0) {
            this.visibleUnloadedCount--;
          }

          // hide loader only when no viewport pages are still loading
          if (this.visibleUnloadedCount === 0) {
            this.hideLoader();
          }
        }
      }

    }, {
      root,
      // aggressive preload margins so images load well before they scroll into view
      rootMargin: isIOS ? '1500px' : '2500px',
      threshold: 0,
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
   * them imperatively - complementing the IntersectionObserver which does
   * not reliably preload elements above the viewport during upward scroll
   * on some browsers (notably Safari).
   */
  private setupScrollPreloadListener() {
    this.teardownScrollPreloadListener();

    const container = this.readerContainer?.nativeElement;
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

    const container = this.readerContainer?.nativeElement;
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
    const PRELOAD_PX = isIOS ? 1500 : 2500;
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

      // skip already loaded images
      if (img.src && img.complete && img.naturalHeight > 0) return;
      if (this.loadingSet.has(id)) return;
      if (this.loadingCount >= this.MAX_LOAD) return;

      const rect = img.getBoundingClientRect();

      // check if within preload range relative to the container (not window)
      const inRange =
        rect.bottom >= containerTop - PRELOAD_PX &&
        rect.top <= containerBottom + PRELOAD_PX;

      if (!inRange) return;

      const page = this.visiblePages.find(p => p.id === id);
      if (!page) return;

      // show loader only if user can actually see this image is missing
      const inViewport = this.isImageInViewport(img);
      if (inViewport) {
        this.visibleUnloadedCount++;
        this.scheduleLoader();
      }

      // load imperatively - same pipeline as the observer
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

  /**
   * Full rebuild of chapter tracking from scratch.
   * Called only on clean open - never on merge.
   * Clears both loadedChapterIds and chapterPageRanges.
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
        this.chapterPageRanges.set(chapterId, { first: pageId, last: pageId });
        continue;
      }

      range.last = pageId;
    }
  }

  /**
   * Incremental chapter tracking update for seamless merges.
   * Only adds new chapters and extends boundaries of existing ones.
   * Does NOT clear loadedChapterIds - that's the whole point.
   *
   * Clearing loadedChapterIds on merge was the root cause of the
   * "gets laggier the longer you read" bug: each merge would wipe the
   * set, making tryLoadAdjacentChapters re-fetch chapters already in the
   * buffer, triggering more merges, wiping again, in an accelerating loop.
   */
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

      // extend boundaries in both directions to handle prev and next merges
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
          const nextId = next?.id;
          if (!nextId || this.loadedChapterIds.has(nextId)) {
            // no next chapter or already in buffer - nothing to do
            this.fetchingNext = false;
            return;
          }

          return this.pagesRepo.getMetaByChapter(nextId).then(newPages => {
            if (!newPages?.length) { this.fetchingNext = false; return; }

            // register before merging to block duplicate fetches
            this.loadedChapterIds.add(nextId);

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
    // Each call takes a snapshot of the current token.
    // If a newer navigation starts while this one is awaiting, the token
    // no longer matches and this call aborts itself on every resume point.
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

      // one frame with forced reflow to get accurate offsetTop before scrolling
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
      // Only release focus/loader ownership if this is still the active navigation.
      // If a newer call has taken over, it owns focusPageId and the visible loader.
      if (navToken === this.navToken) {
        this.focusPageId = null;
        this.hideLoader();
      }
    }
  }

  /**
   * Ensures target page exists in current pages buffer and returns its index.
   * If missing, loads the target chapter and merges it into the buffer first.
   */
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

      // mirror regular merge flow: mark chapter as loaded before merge
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
   *
   * Measures the anchor element's offsetTop before and after the callback,
   * then corrects scrollTop synchronously via queueMicrotask - which runs
   * before the next paint, unlike requestAnimationFrame, so the user never
   * sees a visual jump even when pages are inserted above the viewport.
   *
   * Skipped in page mode - scroll-snap handles positioning there,
   * and manual compensation would fight with snap causing the teleport bug.
   */
  private preserveScroll(anchorId: number, callback: () => void): void {
    if (this.reader.mode() === 'page') {
      callback();
      return;
    }

    const container = this.readerContainer?.nativeElement;

    if (this.isNavigating) {
      callback();
      return;
    }

    const anchorEl = this.imgRefs.find(r =>
      Number(r.nativeElement.dataset['pageId']) === anchorId
    )?.nativeElement;

    if (!anchorEl || !container) { callback(); return; }

    // capture position relative to container scroll before mutation
    const prevOffsetTop = anchorEl.offsetTop;
    const prevScrollTop = container.scrollTop;
    const prevDelta = prevScrollTop - prevOffsetTop;

    callback();

    // queueMicrotask fires before the next paint - no visible jump
    queueMicrotask(() => {
      const newEl = this.imgRefs.find(r =>
        Number(r.nativeElement.dataset['pageId']) === anchorId
      )?.nativeElement;

      if (!newEl) return;

      container.scrollTop = newEl.offsetTop + prevDelta;
    });
  }

  /**
   * Restores container scroll so the requested page stays in view.
   * Used during mode switch where layout metrics change abruptly.
   */
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

  /**
   * Returns the page id currently closest to viewport center.
   * This is a more reliable mode-switch anchor than bookmark/currentPage,
   * which can lag by one observer callback in fast scrolling.
   */
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

  /**
   * Computes element top in container scroll coordinates.
   * More stable than offsetTop math when layout/offset parents change.
   */
  private getContainerRelativeTop(target: HTMLElement, container: HTMLElement): number {
    const targetRect = target.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return targetRect.top - containerRect.top + container.scrollTop;
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