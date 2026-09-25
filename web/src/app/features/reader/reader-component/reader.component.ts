import { AfterViewInit, Component, QueryList, ViewChildren, ElementRef, OnDestroy, effect, DestroyRef, untracked, ViewChild, ChangeDetectorRef } from '@angular/core';
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
  private loadingSet = new Map<number, { img: HTMLImageElement; promise: Promise<boolean>; failed: boolean }>();
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
    private changeDetector: ChangeDetectorRef,
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

      if (!pages?.length) {
        this.loadToken++;
        this.navToken++;
        this.hideLoader();
        return;
      }

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

      const previousFirstId = this.pageIndexMap.keys().next().value;
      this.pageIndexMap.clear();
      pages.forEach((p, i) => this.pageIndexMap.set(p.id!, i));
      if (pagesUpdateKind !== 'merge') this.virtualization.reset();
      this.virtualization.rebuildIndex(pages);

      // Needed by waitForPageIndexUpdate during async navigation.
      this.pageIndexMapUpdated$.next();

      if (pagesUpdateKind === 'merge') {
        this.mergeChapterTracking(pages);

        const anchorId = untracked(() =>
          this.focusPageId ??
          this.getViewportAnchorPageId() ??
          this.reader.currentPageBookmark() ??
          this.reader.currentPageId() ??
          this.visiblePages[0]?.id ??
          null
        );
        const anchorIndex = anchorId
          ? (this.pageIndexMap.get(anchorId) ?? 0)
          : 0;

        const isPrependMerge = previousFirstId !== undefined &&
          pages[0]?.id !== previousFirstId && this.pageIndexMap.has(previousFirstId);

        if (isPrependMerge) {
          this.isPrepending = true;
        }

        if (!this.isNavigating && anchorId != null) {
          untracked(() => this.preserveScroll(anchorId, () => {
            this.updateVisiblePages(anchorIndex);
          }));
        } else {
          // even if navigation is in progress, the virtualization window must be updated!! 
          // otherwise the merged pages will never get a DOM element
          this.updateVisiblePages(anchorIndex);
        }

        this.isPrepending = false;
        const token = this.loadToken;
        const navigation = this.navToken;
        requestAnimationFrame(() => {
          if (this.destroyed || token !== this.loadToken || navigation !== this.navToken) return;
          this.observeNewImages();
          this.loadVisibleRange(isPrependMerge ? (isIOS ? 8000 : 12000) : undefined);
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

      if (mode === 'dual' && !untracked(() => this.dualPageCover) && startIndex % 2 === 1) {
        startIndex = Math.max(0, startIndex - 1);
      }

      // Reopening can reuse page ids. Detach old elements before their pending
      // image handlers can overlap a new session loading the same page.
      if (this.imgRefs?.length) {
        this.visiblePages = [];
        untracked(() => this.changeDetector.detectChanges());
      }
      this.updateVisiblePages(startIndex);

      this.loadingSet.clear();
      this.loadingCount = 0;
      this.visibleUnloadedCount = 0;
      this.cancelLoaderDebounce();

      this.focusPageId = null;
      this.fetchingNext = false;
      this.fetchingPrev = false;

      this.loadedChapterIds.clear(); 

      this.isPrepending = false;
      this.isRestoringScroll = false;
      this.isNavigating = false;

      this.rebuildChapterTracking(pages);
      this.showLoaderNow();

      this.loadToken++;
      this.navToken++;

      // Opening and explicit navigation share the same readiness and cancellation path.
      untracked(() => void this.handleNavigation(currentPageId ?? pages[startIndex].id!));
    });

    let previousNavTick = untracked(() => this.reader.navTick());

    effect(() => {
      const tick = this.reader.navTick();
      if (tick === previousNavTick) return;
      previousNavTick = tick;
      const pageId = untracked(() => this.reader.currentPageId());

      if (!pageId) return;

      untracked(() => void this.handleNavigation(pageId));
    });


    let previousMode = untracked(() => this.reader.mode());
    let previousCover = untracked(() => this.dualPageCover);
    effect(() => {
      const mode = this.reader.mode();
      const cover = this.dualPageCover;
      const changed = mode !== previousMode || (mode === 'dual' && cover !== previousCover);
      previousMode = mode;
      previousCover = cover;
      if (!changed) return;
      untracked(() => {
        if (!this.reader.pages().length) return;
        const anchorId = this.focusPageId ?? this.reader.currentPageBookmark() ??
          this.reader.currentPageId() ?? this.getViewportAnchorPageId();
        if (anchorId != null) void this.handleNavigation(anchorId);
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
        if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey ||
            (e.target instanceof Element && e.target.closest('app-window, input, textarea, select, button, a, [contenteditable]'))) return;
        const mode = this.reader.mode();
        if (mode === 'horizontal' || mode === 'dual') {
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            this.goToAdjacentPage(1);
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
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
      const navigation = this.navToken;

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
          return Number(this.isImageInViewport(b.target as HTMLImageElement)) -
            Number(this.isImageInViewport(a.target as HTMLImageElement)) ||
            Math.abs(aCenter - center) - Math.abs(bCenter - center);
        })
        .slice(0, this.MAX_LOAD * 2);

      this.updateReadingPosition();
      this.loadVisibleRange();

      let windowUpdated = false;

      for (const entry of visible) {

        if (this.destroyed || token !== this.loadToken || navigation !== this.navToken || this.freezeBookmarkUpdates) return;

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
              this.preserveScroll(this.getViewportAnchorPageId() ?? id, () => { this.updateVisiblePages(globalIndex); });
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
    const anchorId = this.getViewportAnchorPageId();
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

      const token = this.loadToken;
      const navigation = this.navToken;
      requestAnimationFrame(() => {
        this.scrollPreloadThrottled = false;
        if (this.destroyed || token !== this.loadToken || navigation !== this.navToken) return;
        this.loadVisibleRange();
        this.updateReadingPosition();
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
    if (this.destroyed || this.isNavigating || this.isPrepending || this.isRestoringScroll) return;

    const PRELOAD_PX = preloadPx ?? (isIOS ? 1500 : 2500);
    const token = this.loadToken;

    const bounds = this.getViewportBounds(this.readerContainer?.nativeElement);

    this.imgRefs.toArray().sort((a, b) => {
      const ar = this.getElementAxisBounds(a.nativeElement);
      const br = this.getElementAxisBounds(b.nativeElement);
      const av = ar.end > bounds.start && ar.start < bounds.end;
      const bv = br.end > bounds.start && br.start < bounds.end;
      const ad = Math.max(bounds.start - ar.end, ar.start - bounds.end, 0);
      const bd = Math.max(bounds.start - br.end, br.start - bounds.end, 0);
      return Number(bv) - Number(av) || ad - bd;
    }).forEach(ref => {
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
    const token = this.loadToken;
    const navigation = this.navToken;
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
          if (this.destroyed || token !== this.loadToken || navigation !== this.navToken) return;
          const nextId = next?.id;
          if (!nextId || this.loadedChapterIds.has(nextId)) {
            this.fetchingNext = false;
            return;
          }

          return this.pagesRepo.getMetaByChapter(nextId).then(newPages => {
            if (this.destroyed || token !== this.loadToken || navigation !== this.navToken) return;
            if (!newPages?.length) { this.fetchingNext = false; return; }

            this.dbg('tryLoadAdjacentChapters:MERGE NEXT', { chapterId, nextId, globalIndex, total, newPagesCount: newPages.length });
            this.loadedChapterIds.add(nextId);
            this.reader.mergePages(newPages, 'next');
            this.fetchingNext = false;
          });
        })
        .catch(() => {}).finally(() => {
          if (!this.destroyed && token === this.loadToken && navigation === this.navToken) this.fetchingNext = false;
        });
    }

    if (allowPrev && !this.fetchingPrev && globalIndex <= this.CHAPTER_TRIGGER) {
      this.fetchingPrev = true;

      this.chaptersRepo.getPrevChapter(chapterId)
        .then(prev => {
          if (this.destroyed || token !== this.loadToken || navigation !== this.navToken) return;
          const prevId = prev?.id;
          if (!prevId || this.loadedChapterIds.has(prevId)) {
            this.fetchingPrev = false;
            return;
          }

          return this.pagesRepo.getMetaByChapter(prevId).then(newPages => {
            if (this.destroyed || token !== this.loadToken || navigation !== this.navToken) return;
            if (!newPages?.length) { this.fetchingPrev = false; return; }

            this.loadedChapterIds.add(prevId);
            this.reader.mergePages(newPages, 'prev');
            this.fetchingPrev = false;
          });
        })
        .catch(() => {}).finally(() => {
          if (!this.destroyed && token === this.loadToken && navigation === this.navToken) this.fetchingPrev = false;
        });
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
   * Session cancellation is checked before committing geometry or readiness.
   */
  private async resolveAndLoad(
    page: PageMeta,
    img: HTMLImageElement,
    isStale: () => boolean
  ): Promise<boolean> {
    if (page.id == null) return false;
    await this.ensurePageLoaded(page);
    if (this.destroyed || isStale()) return false;
    const url = await this.getOrCreateUrl(page);
    if (this.destroyed || isStale() || !url) return false;

    // Unknown legacy dimensions must not resize an on-screen image asynchronously.
    // Load through the same pipeline off-DOM, then commit its geometry atomically.
    if (!(page.width! > 0 && page.height! > 0)) {
      const probe = new Image();
      await this.loadImage(probe, url);
      if (this.destroyed || isStale()) return false;
      const anchorId = this.getViewportAnchorPageId() ?? this.reader.currentPageBookmark();
      this.preserveScroll(anchorId ?? page.id, () => {
        page.width = probe.naturalWidth;
        page.height = probe.naturalHeight;
      });
    }

    if (this.destroyed || isStale() || !img.isConnected) return false;
    await this.loadImage(img, url);
    return !this.destroyed && !isStale() && img.isConnected && img.complete && img.naturalHeight > 0;
  }

  /** Shared in-flight promises prevent duplicate handlers and enforce the load limit. */
  private async loadOnePage(page: PageMeta, img: HTMLImageElement, token: number): Promise<boolean> {
    if (page.id == null || this.destroyed || token !== this.loadToken || !img.isConnected) return false;
    const id = page.id;
    const existing = this.loadingSet.get(id);
    if (existing) {
      const loaded = await existing.promise;
      if (this.destroyed || token !== this.loadToken) return false;
      if (existing.failed || existing.img === img || (!loaded && existing.img.isConnected)) return loaded;
      return this.loadOnePage(page, img, token);
    }
    if (img.complete && img.naturalHeight > 0) return true;

    while (this.loadingCount >= this.MAX_LOAD) {
      // Background work is picked up by the completion pass; navigation waits for a slot.
      if (this.focusPageId !== id) return false;
      await Promise.race([...this.loadingSet.values()].filter(load => !load.failed).map(load => load.promise));
      if (this.destroyed || token !== this.loadToken || this.focusPageId !== id) return false;
      const pending = this.loadingSet.get(id);
      if (pending) return pending.promise;
    }

    const inViewport = this.isImageInViewport(img);
    if (inViewport) {
      this.visibleUnloadedCount++;
      this.scheduleLoader();
    }
    this.loadingCount++;
    const operation = { img, promise: Promise.resolve(false), failed: false };
    operation.promise = (async () => {
      let loaded = false;
      try {
        loaded = await this.resolveAndLoad(page, img, () => token !== this.loadToken);
        return loaded;
      } catch {
        return false;
      } finally {
        if (!this.destroyed && token === this.loadToken && this.loadingSet.get(id) === operation) {
          // Retain failures for this open session, so completion passes cannot retry forever.
          operation.failed = !loaded && img.isConnected;
          if (!operation.failed) this.loadingSet.delete(id);
          this.loadingCount--;
          if (loaded) this.cleanupFarImages();
          if (inViewport) this.visibleUnloadedCount--;
          if (this.visibleUnloadedCount === 0 && !this.isNavigating) this.hideLoader();
          this.loadVisibleRange();
        }
      }
    })();
    this.loadingSet.set(id, operation);
    return operation.promise;
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
      const offset = hasCover ? 1 : 0;
      const spreadStart = currentIndex < offset ? 0
        : offset + Math.floor((currentIndex - offset) / 2) * 2;
      targetIndex = hasCover && spreadStart === 0
        ? (step > 0 ? 1 : 0) : Math.max(0, spreadStart + step * 2);
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
    if (this.isNavigating || this.isRestoringScroll || this.loadingCount > 0) return;

    const currentId = this.reader.currentPageBookmark() ?? this.reader.currentPageId();
    if (currentId == null) return;

    this.imagePipeline.evictFarPages(currentId, this.pages, this.pageIndexMap, this.CLEANUP_RADIUS);
  }

  private async handleNavigation(pageId: number): Promise<void> {
    const navToken = ++this.navToken;

    this.dbg('handleNavigation:ENTER', { pageId, navToken });
    this.dbgTrace('handleNavigation');


    this.focusPageId = pageId;
    this.isNavigating = true;
    this.fetchingNext = false;
    this.fetchingPrev = false;

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
      const windowIndex = this.reader.mode() === 'dual' && !this.dualPageCover && index % 2 === 1
        ? Math.max(0, index - 1) : index;
      this.updateVisiblePages(windowIndex);

      await new Promise(r => requestAnimationFrame(r));

      this.dbg(`handleNavigation:after-resolve:${pageId}`, { navToken, currentNavToken: this.navToken });
      if (this.destroyed || navToken !== this.navToken) return;

      await this.waitForImages();
      if (this.destroyed || navToken !== this.navToken) return;

      const container = this.readerContainer?.nativeElement;
      const target = await this.waitForTarget(pageId);
      if (this.destroyed || navToken !== this.navToken || !target || !container) return;
      this.scrollToPageImmediately(pageId);

      this.reader.setCurrentPage(pageId);
      this.reader.setCurrentPageBookmark(pageId);
      this.updateActiveChapter(pageId);
      this.setupObserver();
      this.observeAllImages();
      this.setupScrollPreloadListener();
      this.reader.resetIsOpen();
      this.tryLoadAdjacentChapters(this.pageIndexMap.get(pageId) ?? index);

    } finally {
      // Only the still-current navigation may clear these shared flags;
      // a stale/superseded call must not stomp on a newer in-flight navigation.
      if (!this.destroyed && navToken === this.navToken) {
        this.hideLoader();
        this.isNavigating = false;
        this.focusPageId = null;
        this.loadVisibleRange();
      }
    }
  }

  // Loads the target chapter into buffer when needed and returns page index.
  private async resolvePageIndexForNavigation(pageId: number): Promise<number | undefined> {
    const token = this.loadToken;
    const navigation = this.navToken;
    const mangaId = this.reader.mangaId();
    const directIndex = this.pageIndexMap.get(pageId);
    if (directIndex !== undefined) return directIndex;

    const targetPage = await this.pagesRepo.get(pageId);
    if (this.destroyed || token !== this.loadToken || navigation !== this.navToken || targetPage?.tabId !== mangaId) return undefined;
    const targetChapterId = targetPage?.chapterId;

    if (!targetPage || targetChapterId == null) return undefined;

    if (!this.loadedChapterIds.has(targetChapterId)) {
      const newPages = await this.pagesRepo.getMetaByChapter(targetChapterId);
      if (this.destroyed || token !== this.loadToken || navigation !== this.navToken || !newPages.length) return undefined;

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

      if (this.destroyed || token !== this.loadToken || navigation !== this.navToken) return undefined;
      this.loadedChapterIds.add(targetChapterId);
      this.reader.mergePages(newPages, direction);

      await this.waitForPageIndexUpdate(pageId);
    }

    if (this.destroyed || token !== this.loadToken || navigation !== this.navToken) return undefined;
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
    if (this.destroyed) return;
    if (!this.imgRefs) {
      callback();
      return;
    }
    const container = this.readerContainer?.nativeElement;
    const anchorEl = this.imgRefs?.find(r => Number(r.nativeElement.dataset['pageId']) === anchorId)?.nativeElement;
    const horizontal = this.isHorizontalLikeMode();
    const previous = anchorEl && container ? this.getElementAxisBounds(anchorEl).start : null;
    const restoring = this.isRestoringScroll;
    this.isRestoringScroll = true;
    try {
      callback();
      this.changeDetector.detectChanges();
      const next = this.imgRefs?.find(r => Number(r.nativeElement.dataset['pageId']) === anchorId)?.nativeElement;
      if (!this.isNavigating && previous != null && next && container) {
        const shift = this.getElementAxisBounds(next).start - previous;
        if (Math.abs(shift) > 0.5) {
          if (horizontal) container.scrollLeft += shift;
          else container.scrollTop += shift;
        }
      }
    } finally {
      this.isRestoringScroll = restoring;
    }
  }

  private scrollToPageImmediately(pageId: number): void {
    const container = this.readerContainer?.nativeElement;
    if (!container) return;

    this.dbg('scrollToPageImmediately:before', { pageId });
    this.dbgTrace('scrollToPageImmediately');

    const mode = this.reader.mode();
    let targetId = pageId;
    if (mode === 'dual') {
      const index = this.pageIndexMap.get(pageId);
      const offset = this.dualPageCover ? 1 : 0;
      if (index !== undefined && index >= offset) {
        const spreadStart = offset + Math.floor((index - offset) / 2) * 2;
        targetId = this.pages[spreadStart]?.id ?? pageId;
      }
    }

    this.scrollController.scrollToPage(
      targetId,
      (id) => {
        const img = this.imgRefs.find(r => Number(r.nativeElement.dataset['pageId']) === id)?.nativeElement;
        return mode === 'dual' ? img?.parentElement ?? undefined : img;
      },
      container,
      mode,
      0
    );

  }

  private getViewportAnchorPageId(): number | null {
    const container = this.readerContainer?.nativeElement;
    if (!container || !this.imgRefs?.length) return null;

    const bounds = this.getViewportBounds(container);
    let bestId: number | null = null;
    let bestOverlap = 0;
    this.imgRefs.forEach(ref => {
      if (!ref.nativeElement.isConnected) return;
      const rect = this.getElementAxisBounds(ref.nativeElement);
      const overlap = Math.max(0, Math.min(rect.end, bounds.end) - Math.max(rect.start, bounds.start));
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestId = Number(ref.nativeElement.dataset['pageId']) || null;
      }
    });

    if (this.reader.mode() === 'dual' && bestId != null) {
      const currentId = this.reader.currentPageBookmark();
      const currentIndex = currentId != null ? this.pageIndexMap.get(currentId) : undefined;
      const bestIndex = this.pageIndexMap.get(bestId);
      const offset = this.dualPageCover ? 1 : 0;
      if (currentIndex !== undefined && bestIndex !== undefined &&
          Math.floor((currentIndex - offset) / 2) === Math.floor((bestIndex - offset) / 2)) {
        // A spread contains two pages, but entering it must not change which
        // page is restored on leaving dual mode merely because its partner is wider.
        return currentId!;
      }
    }

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
    const token = this.loadToken;
    const navigation = this.navToken;
    let tries = 0;
    while ((!this.imgRefs || this.imgRefs.length === 0) && !this.destroyed && token === this.loadToken && navigation === this.navToken && tries < 10) {
      await new Promise(r => setTimeout(r, 30));
      tries++;
    }
  }

  private async waitForTarget(pageId: number): Promise<HTMLElement | undefined> {
    const token = this.loadToken;
    const navigation = this.navToken;
    let attempts = 0;

    while (attempts < 20) {
      await new Promise(r => requestAnimationFrame(r));

      if (this.destroyed || token !== this.loadToken || navigation !== this.navToken) return undefined;
      const el = this.imgRefs.find(r =>
        Number(r.nativeElement.dataset['pageId']) === pageId
      )?.nativeElement;

      if (el) {
        const page = this.visiblePages.find(p => p.id === pageId);
        if (!page) return undefined;
        const loaded = await this.loadOnePage(page, el, token);
        if (this.destroyed || token !== this.loadToken || navigation !== this.navToken || !loaded) return undefined;
        return el;
      }
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
