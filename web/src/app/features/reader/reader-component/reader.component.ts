import { AfterViewInit, Component, QueryList, ViewChildren, ElementRef, OnDestroy, effect, DestroyRef, untracked, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Page } from '../../../core/models/page.model';
import { LoadingService } from '../../../core/services/loading.service';
import { ReaderService } from '../../../core/services/reader.service';
import { isIOS } from '../../../shared/utils/constants';
import { PagesRepository } from '../../../core/repositories/pages.repository';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChaptersRepository } from 'src/app/core/repositories/chapters.repository';
import { PageMeta } from 'src/app/shared/models/page-meta.model';
import { SettingsStoreService } from '../engine/settings-store.service';
import { ImagePipelineService } from '../engine/image-pipeline.service';
import { GestureEngineService, GestureEvent } from '../engine/gesture-engine.service';
import { ScrollControllerService } from '../engine/scroll-controller.service';
import { VirtualizationEngineService } from '../engine/virtualization-engine.service';
import { Subject } from 'rxjs';

@Component({
  selector: 'manga-reader',
  templateUrl: './reader.component.html',
  styleUrls: ['./reader.component.css'],
  standalone: true,
  imports: [CommonModule],
})
export class ReaderComponent implements AfterViewInit, OnDestroy {

  // Rendered images used by observer and scroll calculations.
  @ViewChildren('imgRef')
  imgRefs!: QueryList<ElementRef<HTMLImageElement>>;

  @ViewChild('readerContainer')
  private readerContainer!: ElementRef<HTMLDivElement>;

  // Observer drives image loading and reading position updates.
  private observer!: IntersectionObserver;

  // Keeps track of already observed ids so only attach new nodes.
  private observedPageIds = new Set<number>();

  // These flags gate observer writes while navigation or restore is running.
  private isNavigating = false;
  private isPrepending = false;
  private isRestoringScroll = false;

  private get freezeBookmarkUpdates(): boolean {
    return this.isPrepending || this.isNavigating || this.isRestoringScroll;
  }

  // Maps page id to global index in full buffer.
  private pageIndexMap = new Map<number, number>();

  // Fired when index map is rebuilt after page merge.
  private pageIndexMapUpdated$ = new Subject<void>();

  private MAX_LOAD = 12;
  private loadingCount = 0;
  private loadingSet = new Set<number>();
  private isLoaderVisible = false;

  // Used to cancel stale async navigation steps.
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

  // Stores first and last page id for each chapter.
  private chapterPageRanges = new Map<number, { first: number; last: number }>();

  private fetchingNext = false;
  private fetchingPrev = false;

  private loggedChapterContextOnce = false;

  private scrollPreloadListener: (() => void) | null = null;
  private scrollPreloadThrottled = false;

  constructor(
    private loading: LoadingService,
    public reader: ReaderService,
    private pagesRepo: PagesRepository,
    private chaptersRepo: ChaptersRepository,
    private destroyRef: DestroyRef,
    private settingsStore: SettingsStoreService,
    private imagePipeline: ImagePipelineService,
    private gestureEngine: GestureEngineService,
    private scrollController: ScrollControllerService,
    private virtualization: VirtualizationEngineService
  ) {

    effect(() => {
      const pages = this.reader.pages();
      const pagesUpdateKind = this.reader.pagesUpdateKind();

      if (!pages?.length) return;

      // Read without tracking. This effect should react only to page updates,
      // not to mode/open state changes!
      const mode = untracked(() => this.reader.mode());
      const isOpen = untracked(() => this.reader.isOpen());

      this.dbg('pages-effect:fired', {
        pagesUpdateKind,
        mode,
        isOpen,
        len: pages.length,
        first: pages[0]?.id,
        last: pages.at(-1)?.id,
      });

      this.pageIndexMap.clear();
      pages.forEach((p, i) => this.pageIndexMap.set(p.id!, i));
      this.virtualization.rebuildIndex(pages);

      // Needed by waitForPageIndexUpdate during async navigation.
      this.pageIndexMapUpdated$.next();

      if (pagesUpdateKind === 'merge') {
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

        if (!this.isNavigating && anchorId != null) {
          this.preserveScroll(anchorId, () => {
            this.updateVisiblePages(anchorIndex);
          });
        } else if (!this.isNavigating) {
          this.updateVisiblePages(anchorIndex);
        }

        requestAnimationFrame(() => {
          this.observeNewImages();
          this.loadVisibleRange();

          if (isPrependMerge) {
            // preserveScroll() above already compensates the anchor shift
            // uniformly for every mode (including page mode) - no need for
            // a mode-specific re-scroll here anymore.
            requestAnimationFrame(() => {
              this.isPrepending = false;

              // Warm newly prepended images with a larger preload range.
              requestAnimationFrame(() => {
                this.loadVisibleRange(isIOS ? 8000 : 12000);
              });
            });
          }
        });
        return;
      }

      // ImagePipelineService owns the blob URL cache.
      // Always revoke URLs through it to keep all caches in sync.
      this.imagePipeline.revokeAll();

      // Use the bookmark instead of currentPageId.
      // currentPageId is intentionally not updated in page mode, so restoring from
      // it can jump back to the initial page. The bookmark always reflects the
      // current reading position.
      const currentPageId = untracked(() =>
        this.reader.currentPageBookmark() ?? this.reader.currentPageId()
      );
      let startIndex = currentPageId
        ? (this.pageIndexMap.get(currentPageId) ?? 0)
        : 0;

      if (mode === 'dual' && !this.dualPageCover && startIndex % 2 === 1) {
        startIndex = Math.max(0, startIndex - 1);
      }

      this.updateVisiblePages(startIndex);

      this.loadingSet.clear();
      this.loadingCount = 0;
      this.visibleUnloadedCount = 0;
      this.cancelLoaderDebounce();

      this.focusPageId = null;
      this.fetchingNext = false;
      this.fetchingPrev = false;

      this.isPrepending = false;
      this.isRestoringScroll = false;
      this.isNavigating = false;

      this.rebuildChapterTracking(pages);
      this.showLoaderNow();

      this.loadToken++;
      this.navToken++;

      const container = this.readerContainer?.nativeElement;
      if (container) {
        container.scrollTop = 0;
        if (this.isHorizontalLikeMode()) {
          container.scrollLeft = 0;
        }
      }

      requestAnimationFrame(() => {
        // Scroll to the target page before enabling the observer.
        // Otherwise the observer may initialize from the wrong page and
        // update the virtualization window incorrectly.
        if (currentPageId != null) {
          this.scrollToPageImmediately(currentPageId);
        }

        this.setupObserver();
        this.observeAllImages();
        this.setupScrollPreloadListener();

        if (currentPageId != null) {
          // On the first open, the target page may not be rendered yet.
          // Retry once it becomes available.
          this.waitForTarget(currentPageId).then(() => {
            if (this.destroyed) return;

            this.scrollToPageImmediately(currentPageId);

            // Preload adjacent chapters after the initial navigation so the user
            // can immediately continue to the next/previous chapter.
            if (isOpen) {
              this.reader.resetIsOpen();
              const currentIndex = this.pageIndexMap.get(currentPageId) ?? startIndex;

              this.tryLoadAdjacentChapters(currentIndex, { allowPrev: false });
            }
          });
        }

        // TODO: FIX
        // Disabled: breaks initial page navigation.
        // if (isOpen) {
        //   this.reader.resetIsOpen();
        //   // Only preload the next chapter on initial open to avoid shifting the viewport.
        //   this.tryLoadAdjacentChapters(startIndex, { allowPrev: false });
        // }
      });
    });

    effect(() => {
      this.reader.navTick();
      const pageId = untracked(() => this.reader.currentPageId());

      if (!pageId) return;

      this.handleNavigation(pageId);
    });


    effect(() => {
      const mode = this.reader.mode();
      untracked(() => {
        if (!this.reader.pages().length) return;

        this.dbg('mode-effect:fired', { mode });
        this.dbgTrace('mode-effect');

        const anchorId =
          this.reader.currentPageId() ??
          this.reader.currentPageBookmark() ??
          this.getViewportAnchorPageId() ??
          null;

        this.navToken++;
        this.isNavigating = true;
        this.focusPageId = anchorId;

        if (anchorId != null) {
          let anchorIndex = this.pageIndexMap.get(anchorId);
          if (anchorIndex !== undefined) {
            if (mode === 'dual' && !this.dualPageCover && anchorIndex % 2 === 1) {
              anchorIndex = Math.max(0, anchorIndex - 1);
            }
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

    effect(() => {
      const gap = this.reader.gap();

      untracked(() => {
        if (!this.reader.pages().length) return;

        this.dbg('gap-effect:fired', { gap });
        this.dbgTrace('gap-effect');

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

    const container = this.readerContainer?.nativeElement;
    if (container) {
      this.gestureEngine.attach(container, (event) => this.handleGesture(event));

      const keyHandler = (e: KeyboardEvent) => {
        const mode = this.reader.mode();
        if (mode === 'horizontal' || mode === 'dual') {
          if (e.key === 'ArrowRight') {
            this.goToAdjacentPage(1);
          } else if (e.key === 'ArrowLeft') {
            this.goToAdjacentPage(-1);
          }
        }
      };
      document.addEventListener('keydown', keyHandler);

      const wheelHandler = (e: WheelEvent) => {
        const mode = this.reader.mode();
        if (mode === 'horizontal' || mode === 'dual') {
          if (e.deltaX > 50) {
            this.goToAdjacentPage(1);
          } else if (e.deltaX < -50) {
            this.goToAdjacentPage(-1);
          }
        }
      };
      container.addEventListener('wheel', wheelHandler, { passive: false });

      this.destroyRef.onDestroy(() => {
        document.removeEventListener('keydown', keyHandler);
        container.removeEventListener('wheel', wheelHandler);
      });
    }

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
    this.gestureEngine.detach();
    this.observedPageIds.clear();
    this.teardownScrollPreloadListener();
    this.cancelLoaderDebounce();
    this.hideLoader();
    this.imagePipeline.revokeAll();
    this.pageIndexMapUpdated$.complete();
  }

  /** Returns true if image rect intersects current reader container viewport. */
  private isImageInViewport(img: HTMLImageElement): boolean {
    const bounds = this.getViewportBounds(this.readerContainer?.nativeElement);
    const rect = img.getBoundingClientRect();

    if (this.isHorizontalLikeMode()) {
      return rect.right > bounds.start && rect.left < bounds.end;
    }

    return this.scrollController.isInViewport(img, this.readerContainer?.nativeElement ?? null);
  }

  private showLoaderNow(): void {
    this.cancelLoaderDebounce();
    this.loading.show();
    this.isLoaderVisible = true;
  }

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

  private setupObserver() {
    this.observer?.disconnect();
    this.observedPageIds.clear();

    const root = this.readerContainer?.nativeElement ?? null;

    this.observer = new IntersectionObserver(async (entries) => {

      if (this.isNavigating || this.isPrepending || this.isRestoringScroll) return;

      const token = this.loadToken;

      const containerRect = root?.getBoundingClientRect();
      const containerSize = this.isHorizontalLikeMode()
        ? (containerRect?.width ?? window.innerWidth)
        : (containerRect?.height ?? window.innerHeight);
      const containerStart = this.isHorizontalLikeMode()
        ? (containerRect?.left ?? 0)
        : (containerRect?.top ?? 0);

      let center = containerSize / 2;

      if (this.focusPageId !== null) {
        const el = this.imgRefs.find(r =>
          Number(r.nativeElement.dataset['pageId']) === this.focusPageId
        )?.nativeElement;

        if (el) {
          const rect = el.getBoundingClientRect();
          center = this.isHorizontalLikeMode()
            ? (rect.left - containerStart) + rect.width / 2
            : (rect.top - containerStart) + rect.height / 2;
        }
      }

      const visible = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => {
          const aCenter = this.isHorizontalLikeMode()
            ? (a.boundingClientRect.left - containerStart) + a.boundingClientRect.width / 2
            : (a.boundingClientRect.top - containerStart) + a.boundingClientRect.height / 2;
          const bCenter = this.isHorizontalLikeMode()
            ? (b.boundingClientRect.left - containerStart) + b.boundingClientRect.width / 2
            : (b.boundingClientRect.top - containerStart) + b.boundingClientRect.height / 2;
          return Math.abs(aCenter - center) - Math.abs(bCenter - center);
        })
        .slice(0, this.MAX_LOAD * 2);

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
            this.dbg('observer:BUFFER-recenter-triggered', {
              id, globalIndex,
              firstId: first, firstIndex: first !== undefined ? this.pageIndexMap.get(first) : undefined,
              lastId: last, lastIndex: last !== undefined ? this.pageIndexMap.get(last) : undefined,
              isPrepending: this.isPrepending, isRestoringScroll: this.isRestoringScroll, isNavigating: this.isNavigating,
            });

            if (!this.isPrepending && !this.isRestoringScroll && !this.isNavigating) {
              this.preserveScroll(id, () => { this.updateVisiblePages(globalIndex); });
            }
            windowUpdated = true;
          }

          this.tryLoadAdjacentChapters(globalIndex);
        }

        const page = this.visiblePages.find(p => p.id === id);
        if (!page) continue;

        // Single shared load pipeline used by every reading mode/path.
        await this.loadOnePage(page, img, token);
      }

    }, {
      root,
      rootMargin: this.reader.mode() === 'page'
        ? '0px'
        : this.isHorizontalLikeMode()
          ? `0px ${isIOS ? '1500px' : '2500px'} 0px ${isIOS ? '1500px' : '2500px'}`
          : `${isIOS ? '1500px' : '2500px'} 0px ${isIOS ? '1500px' : '2500px'} 0px`,
      threshold: 0,
    });
  }

  private observeAllImages() {
    this.observedPageIds.clear();

    this.imgRefs.forEach(ref => {
      const id = Number(ref.nativeElement.dataset['pageId']);
      this.observer.observe(ref.nativeElement);
      this.observedPageIds.add(id);
    });
  }

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

  // Called from observer and scroll listener to keep bookmark in sync.
  private updateReadingPosition(): void {
    if (this.freezeBookmarkUpdates || this.focusPageId !== null) return;

    const bounds = this.getViewportBounds(this.readerContainer?.nativeElement);

    let anchorId: number | null = null;
    let bestOverlap = 0;

    this.imgRefs.forEach(ref => {
      const img = ref.nativeElement;

      if (!img.isConnected) return;

      const rect = img.getBoundingClientRect();
      const overlap = this.isHorizontalLikeMode()
        ? Math.max(0, Math.min(rect.right, bounds.end) - Math.max(rect.left, bounds.start))
        : Math.max(0, Math.min(rect.bottom, bounds.end) - Math.max(rect.top, bounds.start));
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        anchorId = Number(img.dataset['pageId']) || null;
      }
    });

    if (!anchorId) return;

    // In page mode currentPage is owned by navigation flow.
    if (this.reader.mode() !== 'page' && !this.isNavigating) {
      if (this.reader.currentPageId() !== anchorId) {
        this.reader.setCurrentPage(anchorId);
      }
    }

    if (!this.isNavigating && this.reader.currentPageBookmark() !== anchorId) {
      this.dbg('updateReadingPosition:setCurrentPageBookmark', {
        from: this.reader.currentPageBookmark(), to: anchorId,
      });
      this.reader.setCurrentPageBookmark(anchorId);
    }

    this.updateActiveChapter(anchorId);
  }

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
    if (this.isPrepending || this.isRestoringScroll) return;

    const PRELOAD_PX = preloadPx ?? (isIOS ? 1500 : 2500);
    const token = this.loadToken;

    const bounds = this.getViewportBounds(this.readerContainer?.nativeElement);

    this.imgRefs.forEach(ref => {
      if (this.destroyed) return;
      if (token !== this.loadToken) return;

      const img = ref.nativeElement;
      const id = Number(img.dataset['pageId']);

      if (img.src && img.complete && img.naturalHeight > 0) return;

      const rect = img.getBoundingClientRect();

      const inRange = this.isHorizontalLikeMode()
        ? rect.right >= bounds.start - PRELOAD_PX && rect.left <= bounds.end + PRELOAD_PX
        : rect.bottom >= bounds.start - PRELOAD_PX && rect.top <= bounds.end + PRELOAD_PX;

      if (!inRange) return;

      const page = this.visiblePages.find(p => p.id === id);
      if (!page) return;

      // Single shared load pipeline used by every reading mode/path.
      void this.loadOnePage(page, img, token);
    });
  }

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

  /** Triggers adjacent chapter preload when reading position approaches buffer edges. */
  private tryLoadAdjacentChapters(
    globalIndex: number,
    options: { allowNext?: boolean; allowPrev?: boolean } = {}
  ): void {
    const total = this.reader.pages().length;
    const chapterId = this.reader.chapterId();
    const allowNext = options.allowNext ?? true;
    const allowPrev = options.allowPrev ?? true;

    this.dbg('tryLoadAdjacentChapters:ENTER', {
    chapterId,
    globalIndex,
    total,
    fetchingNext: this.fetchingNext,
    fetchingPrev: this.fetchingPrev,
    loadedChapterIds: [...this.loadedChapterIds],
  });

    if (!this.loggedChapterContextOnce) {
      this.loggedChapterContextOnce = true;
      this.dbg('tryLoadAdjacentChapters:context(once)', { chapterId, total, CHAPTER_TRIGGER: this.CHAPTER_TRIGGER });
    }

    if (!chapterId) return;

    this.dbg("BEFORE NEXT CHECK", {
    globalIndex,
    total,
    fetchingNext: this.fetchingNext
});

    if (allowNext && !this.fetchingNext && globalIndex >= total - this.CHAPTER_TRIGGER) {
      this.fetchingNext = true;

      this.dbg("SET fetchingNext=true", {
    globalIndex
});

      this.chaptersRepo.getNextChapter(chapterId)
        .then(next => {
          const nextId = next?.id;
          if (!nextId || this.loadedChapterIds.has(nextId)) {
            this.fetchingNext = false;
            return;
          }

          return this.pagesRepo.getMetaByChapter(nextId).then(newPages => {
            if (!newPages?.length) { this.fetchingNext = false; return; }

            this.dbg('tryLoadAdjacentChapters:MERGE NEXT', { chapterId, nextId, globalIndex, total, newPagesCount: newPages.length });
            this.loadedChapterIds.add(nextId);
            this.reader.mergePages(newPages, 'next');
            this.fetchingNext = false;
          });
        })
        .catch(() => { this.fetchingNext = false; });
    }

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

  private async loadImage(img: HTMLImageElement, url: string): Promise<void> {
    return this.imagePipeline.loadIntoElement(img, url);
  }

  private async ensurePageLoaded(page: Page): Promise<void> {
    await this.imagePipeline.ensurePayload(page);
  }

  // ImagePipelineService is the single source of truth for blob URLs.
  // Always resolve URLs through it to avoid cache desynchronization.
  private async getOrCreateUrl(page: Page): Promise<string> {
    return this.imagePipeline.getUrl(page);
  }

  /**
   * Resolves the page data, gets its blob URL from ImagePipelineService,
   * and loads it into the image element.
   *
   * If the request becomes stale while loading, releases any newly created
   * URL to avoid leaking unused blob URLs.
   */
  private async resolveAndLoad(
    page: PageMeta,
    img: HTMLImageElement,
    isStale: () => boolean
  ): Promise<boolean> {
    if (page.id == null) return false;
    const pageId = page.id;
    const alreadyExists = this.imagePipeline.hasUrl(pageId);

    await this.ensurePageLoaded(page);
    if (this.destroyed || isStale()) return false;

    const url = await this.getOrCreateUrl(page);
    if (this.destroyed) return false;

    if (isStale()) {
      if (!alreadyExists) this.imagePipeline.releaseUrl(pageId);
      return false;
    }

    if (!url) return false;

    await this.loadImage(img, url);
    return !this.destroyed;
  }

  /**
   * Loads a single page and handles loading state, loader visibility,
   * and cleanup around resolveAndLoad().
   */
  private async loadOnePage(page: PageMeta, img: HTMLImageElement, token: number): Promise<void> {
    if (page.id == null) return;
    const id = page.id;

    if (this.loadingSet.has(id)) return;
    if (this.loadingCount >= this.MAX_LOAD) return;

    const inViewport = this.isImageInViewport(img);
    if (inViewport) {
      this.visibleUnloadedCount++;
      this.scheduleLoader();
    }

    this.loadingSet.add(id);
    this.loadingCount++;

    try {
      const loaded = await this.resolveAndLoad(page, img, () => this.destroyed || token !== this.loadToken);
      if (loaded) this.cleanupFarImages();
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

  private handleGesture(event: GestureEvent): void {
    switch (event.type) {
      case 'swipe-next':
      case 'swipe-prev':
        const mode = this.reader.mode();
        if (mode === 'horizontal' || mode === 'dual') {
          this.goToAdjacentPage(event.type === 'swipe-next' ? 1 : -1);
        }
        return;
      case 'tap':
        return;
    }
  }

  private goToAdjacentPage(step: 1 | -1): void {
    const currentId = this.reader.currentPageBookmark() ?? this.reader.currentPageId();
    if (currentId == null) return;

    const currentIndex = this.pageIndexMap.get(currentId);
    if (currentIndex === undefined) return;

    const isDualMode = this.reader.mode() === 'dual';
    const hasCover = isDualMode && this.settingsStore.dualPageCover();

    let targetIndex: number;

    if (isDualMode) {
      if (hasCover && currentIndex === 0) {
        targetIndex = step > 0 ? 1 : 0;
      } else if (hasCover && currentIndex === 1) {
        targetIndex = step > 0 ? 3 : 0;
      } else if (hasCover) {
        const spreadStart = currentIndex % 2 === 0 ? currentIndex : currentIndex - 1;
        targetIndex = Math.max(1, Math.min(this.pages.length - 1, spreadStart + step * 2));
      } else {
        const spreadStart = Math.floor(currentIndex / 2) * 2;
        targetIndex = Math.max(0, Math.min(this.pages.length - 1, spreadStart + step * 2));
      }
    } else {
      targetIndex = currentIndex + step;
    }

    if (targetIndex < 0 || targetIndex >= this.pages.length) return;
    const targetPage = this.pages[targetIndex];
    if (targetPage?.id == null) return;

    this.reader.goToPage(targetPage.id);
  }

  /**
 * Releases URLs for pages outside the cleanup radius around the current
 * reading position. Eviction is always anchored to the reading position,
 * not the most recently loaded page.
 */
  private cleanupFarImages(): void {
    if (this.isRestoringScroll) return;

    const currentId = this.reader.currentPageBookmark() ?? this.reader.currentPageId();
    if (currentId == null) return;

    this.imagePipeline.evictFarPages(currentId, this.pageIndexMap, this.CLEANUP_RADIUS);
  }

  private async handleNavigation(pageId: number): Promise<void> {
    const navToken = ++this.navToken;

    this.dbg('handleNavigation:ENTER', { pageId, navToken });
    this.dbgTrace('handleNavigation');


    this.focusPageId = pageId;

    if (!this.isHorizontalLikeMode()) {
      this.showLoaderNow();
    }

    try {
      await this.waitForImages();
      if (this.destroyed || navToken !== this.navToken) return;

      const index = await this.resolvePageIndexForNavigation(pageId);
      if (this.destroyed || navToken !== this.navToken) return;

      if (index === undefined) {
        this.focusPageId = null;

        if (!this.isHorizontalLikeMode()) {
          this.hideLoader();
        }

        return;
      }

      this.isNavigating = true;
      this.updateVisiblePages(index);

      await new Promise(r => requestAnimationFrame(r));

      this.dbg(`handleNavigation:after-resolve:${pageId}`, { navToken, currentNavToken: this.navToken });
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
          if (page.id == null || this.loadingSet.has(page.id)) return;
          this.loadingSet.add(page.id);

          try {
            const img = this.imgRefs.find(r =>
              Number(r.nativeElement.dataset['pageId']) === page.id
            )?.nativeElement;

            if (!img) return;

            // Single shared load pipeline used by every reading mode/path.
            await this.resolveAndLoad(page, img, () => this.destroyed || navToken !== this.navToken);
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
        const pageMode = this.reader.mode();
        this.scrollController.scrollToPage(
          pageId,
          (id) => this.imgRefs.find(r => Number(r.nativeElement.dataset['pageId']) === id)?.nativeElement,
          container,
          pageMode,
          0
        );
      }

      this.reader.setCurrentPage(pageId);
      this.reader.setCurrentPageBookmark(pageId);
      this.updateActiveChapter(pageId);

    } finally {
      // Only the still-current navigation may clear these shared flags;
      // a stale/superseded call must not stomp on a newer in-flight navigation.
      if (navToken === this.navToken) {
        if (!this.isHorizontalLikeMode()) {
          this.hideLoader();
        }
        this.isNavigating = false;
        this.focusPageId = null;
      }
    }
  }

  // Loads the target chapter into buffer when needed and returns page index.
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

      await this.waitForPageIndexUpdate(pageId);
    }

    const finalIndex = this.pageIndexMap.get(pageId);
    return finalIndex;
  }

  /** Waits until pageIndexMap includes the requested page id. */
  private async waitForPageIndexUpdate(pageId: number): Promise<void> {
    if (this.pageIndexMap.get(pageId) !== undefined) {
      return;
    }

    return new Promise<void>((resolve) => {
      const timeoutId = setTimeout(() => {
        sub.unsubscribe();
        resolve();
      }, 10000);

      const sub = this.pageIndexMapUpdated$
        .pipe(
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe(() => {
          if (this.pageIndexMap.get(pageId) !== undefined) {
            clearTimeout(timeoutId);
            sub.unsubscribe();
            resolve();
          }
        });
    });
  }

  private updateVisiblePages(centerIndex: number): void {
    untracked(() => {
      const beforeFirst = this.visiblePages[0]?.id;
      const beforeLast = this.visiblePages[this.visiblePages.length - 1]?.id;

      let evictedCount = 0;
      this.virtualization.updateWindow(this.pages, centerIndex, (evictedIds) => {
        evictedCount = evictedIds.length;
        for (const id of evictedIds) {
          this.imagePipeline.releaseUrl(id);
        }
      });


      this.visiblePages = this.virtualization.visiblePages();
      const afterFirst = this.visiblePages[0]?.id;
      const afterLast = this.visiblePages[this.visiblePages.length - 1]?.id;
      this.dbg('updateVisiblePages', {
        centerIndex,
        beforeFirst, beforeLast,
        afterFirst, afterLast,
        evictedCount,
        windowChanged: beforeFirst !== afterFirst || beforeLast !== afterLast,
      });
      if (beforeFirst !== afterFirst || beforeLast !== afterLast) {
        this.dbgTrace('updateVisiblePages window changed');
      }
    });
  }

  /**
  * Preserves the viewport position while the virtual window changes.
  * Applies to all reading modes.
  */
  private preserveScroll(anchorId: number, callback: () => void): void {
    const container = this.readerContainer?.nativeElement;

    if (this.isNavigating || !container) {
      this.dbg('preserveScroll:skip(isNavigating||!container)', { anchorId, isNavigating: this.isNavigating });
      callback();
      return;
    }

    if (this.isRestoringScroll) {
      this.dbg('preserveScroll:skip(isRestoringScroll)', { anchorId });
      callback();
      return;
    }

    const anchorEl = this.imgRefs.find(r =>
      Number(r.nativeElement.dataset['pageId']) === anchorId
    )?.nativeElement;

    if (!anchorEl) {
      callback();
      return;
    }

    const prevAnchorViewportStart = this.isHorizontalLikeMode()
      ? anchorEl.getBoundingClientRect().left
      : anchorEl.getBoundingClientRect().top;

    this.dbg('preserveScroll:start', { anchorId, prevAnchorViewportStart });

    this.isRestoringScroll = true;

    callback();

    // Wait one frame so DOM is updated, then compensate anchor shift.
    requestAnimationFrame(() => {
      const newAnchorEl = this.imgRefs.find(r =>
        Number(r.nativeElement.dataset['pageId']) === anchorId
      )?.nativeElement;

      if (newAnchorEl) {
        const newAnchorViewportStart = this.isHorizontalLikeMode()
          ? newAnchorEl.getBoundingClientRect().left
          : newAnchorEl.getBoundingClientRect().top;
        const shift = newAnchorViewportStart - prevAnchorViewportStart;
        this.dbg('preserveScroll:compensate', { anchorId, newAnchorViewportStart, shift, willApply: Math.abs(shift) > 0.5 });
        if (Math.abs(shift) > 0.5) {
          if (this.isHorizontalLikeMode()) {
            container.scrollLeft += shift;
          } else {
            container.scrollTop += shift;
          }
        }
      } else {
        this.dbg('preserveScroll:compensate:no newAnchorEl (anchor page got evicted!)', { anchorId });
      }

      this.isRestoringScroll = false;
    });
  }

  private scrollToPageImmediately(pageId: number): void {
    const container = this.readerContainer?.nativeElement;
    if (!container) return;

    this.dbg('scrollToPageImmediately:before', { pageId });
    this.dbgTrace('scrollToPageImmediately');

    this.scrollController.scrollToPage(
      pageId,
      (id) => this.imgRefs.find(r => Number(r.nativeElement.dataset['pageId']) === id)?.nativeElement,
      container,
      this.reader.mode(),
      0
    );

  }

  private getViewportAnchorPageId(): number | null {
    const container = this.readerContainer?.nativeElement;
    if (!container || !this.imgRefs?.length) return null;

    const containerRect = container.getBoundingClientRect();
    const viewportCenter = this.isHorizontalLikeMode()
      ? containerRect.left + containerRect.width / 2
      : containerRect.top + containerRect.height / 2;

    let bestId: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    this.imgRefs.forEach(ref => {
      const img = ref.nativeElement;
      const id = Number(img.dataset['pageId']);
      if (!id) return;

      const rect = img.getBoundingClientRect();
      const center = this.isHorizontalLikeMode()
        ? rect.left + rect.width / 2
        : rect.top + rect.height / 2;
      const distance = Math.abs(center - viewportCenter);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = id;
      }
    });

    return bestId;
  }

  private getContainerRelativeTop(target: HTMLElement, container: HTMLElement): number {
    const targetRect = target.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    if (this.isHorizontalLikeMode()) {
      return targetRect.left - containerRect.left + container.scrollLeft;
    }
    return targetRect.top - containerRect.top + container.scrollTop;
  }

  private isHorizontalLikeMode(): boolean {
    const mode = this.reader.mode();
    return mode === 'horizontal' || mode === 'dual';
  }

  private getViewportBounds(container: HTMLElement | null): { start: number; end: number; center: number } {
    const rect = container?.getBoundingClientRect();

    if (this.isHorizontalLikeMode()) {
      const start = rect?.left ?? 0;
      const end = rect?.right ?? window.innerWidth;
      return { start, end, center: start + ((end - start) / 2) };
    }

    const start = rect?.top ?? 0;
    const end = rect?.bottom ?? window.innerHeight;
    return { start, end, center: start + ((end - start) / 2) };
  }

  private getElementAxisBounds(el: HTMLElement): { start: number; end: number; center: number } {
    const rect = el.getBoundingClientRect();

    if (this.isHorizontalLikeMode()) {
      return { start: rect.left, end: rect.right, center: rect.left + rect.width / 2 };
    }

    return { start: rect.top, end: rect.bottom, center: rect.top + rect.height / 2 };
  }

  private getContainerAxisOffset(target: HTMLElement, container: HTMLElement): number {
    const targetRect = target.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    if (this.isHorizontalLikeMode()) {
      return targetRect.left - containerRect.left + container.scrollLeft;
    }

    return targetRect.top - containerRect.top + container.scrollTop;
  }


  private async waitForImages(): Promise<void> {
    let tries = 0;
    while (this.imgRefs && this.imgRefs.length === 0 && tries < 10) {
      await new Promise(r => setTimeout(r, 30));
      tries++;
    }
  }

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

  // Debugging helpers
  /**
   * Reader-specific diagnostic logger.
   *
   * Use this to trace state transitions, scroll position, and other events while
   * investigating reader-related issues. Logging is controlled by `isDebugMode`
   * and is intended for development/debugging only.
   */
  private dbg(tag: string, data?: unknown): void {
    untracked(() => {
    if (!this.isDebugMode) return;

    const container = document.querySelector<HTMLElement>('.reader-container');

    // eslint-disable-next-line no-console
    console.log(
      `%c[READER-DBG] ${tag}`,
      'color:#e91e63;font-weight:bold',
      {
        ...(typeof data === 'object' && data ? data : { data }),
        scrollTop: container?.scrollTop,
        scrollLeft: container?.scrollLeft
      }
    );
    });
  }

  /**
   * Prints the current call stack to help identify the execution path that
   * triggered a reader event.
   */
  private dbgTrace(tag: string): void {
    untracked(() => {
    if (!this.isDebugMode) return;

    console.trace(`[READER-DBG-TRACE] ${tag} - call stack`);
    });
  }

  get pages(): PageMeta[] {
    return this.reader.pages();
  }

  get readerMode() {
    return this.reader.mode();
  }

  get readerGap() {
    return this.reader.gap();
  }

  get dualPageCover(): boolean {
    return this.settingsStore.dualPageCover();
  }

  get isDebugMode(): boolean {
    return this.reader.debug();
  }
}