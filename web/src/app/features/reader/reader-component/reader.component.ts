import { AfterViewInit, Component, QueryList, ViewChildren, ElementRef, OnDestroy, effect, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Page, PageMeta } from '../../../core/models/page.model';
import { ObjectUrlService } from '../../../core/services/object-url.service';
import { LoadingService } from '../../../core/services/loading.service';
import { ReaderService } from '../../../core/services/reader.service';
import { isIOS } from '../../../shared/utils/constants';
import { PagesRepository } from '../../../core/repositories/pages.repository';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ViewMod } from 'src/app/shared/enums/viewmod.enum';
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
   * references to rendered <img> elements
   * used for observer + scroll calculations
   */
  @ViewChildren('imgRef')
  imgRefs!: QueryList<ElementRef<HTMLImageElement>>;

  /**
   * intersection observer for lazy loading
   */
  private observer!: IntersectionObserver;

  /**
   * flag to block observer logic during navigation
   */
  private isNavigating = false;

  /**
   * cache of generated object URLs (pageId -> url)
   */
  private pageUrls = new Map<number, string>();

  /**
   * pageId -> index in full pages list
   * used for fast lookup and window logic
   */
  private pageIndexMap = new Map<number, number>();

  /**
   * max number of parallel loads
   */
  private MAX_LOAD = 12;

  /**
   * current active loading count
   */
  private loadingCount = 0;

  /**
   * tracks pages currently loading
   * prevents duplicate requests
   */
  private loadingSet = new Set<number>();

  /**
   * controls global loader visibility
   */
  private isLoaderVisible = false;

  /**
   * page used as focus center (during navigation)
   */
  private focusPageId: number | null = null;

  /**
   * radius for keeping images in memory
   * outside this range images are released
   */
  private CLEANUP_RADIUS = 30;

  /**
   * used to cancel outdated async work
   */
  private loadToken = 0;

  /**
   * threshold before shifting virtual window
   */
  private BUFFER = 5; // number of pages from edge to trigger window update

  /**
   * currently rendered subset of pages
   */
  visiblePages: Page[] = [];

  /**
   * indicates if next chapter exists
   */
  hasNextChapter = false;

  constructor(
    private urlService: ObjectUrlService,
    private loading: LoadingService,
    public reader: ReaderService,
    private pagesRepo: PagesRepository,
    private chaptersRepo: ChaptersRepository,
    private destroyRef: DestroyRef
  ) {

    // reacts to pages change (open chapter / reload)
    // full state reset
    effect(() => {
      const pages = this.reader.pages();
      if (!pages?.length) return;

      // check if next chapter exists
      this.chaptersRepo.hasNextChapter(this.reader.chapterId()!).then(result => {
        this.hasNextChapter = result;
      });

      // revoke all existing URLs to avoid memory leaks
      this.pageUrls.forEach((url, id) => { this.urlService.revokeUrl(String(id)); });
      this.pageUrls.clear();

      // rebuild index map for fast access
      this.pageIndexMap.clear();
      pages.forEach((p, i) => this.pageIndexMap.set(p.id!, i));

      // find start index (current page or 0)
      const startIndex = this.reader.currentPageId()
        ? this.pageIndexMap.get(this.reader.currentPageId()!) ?? 0
        : 0;

      // initialize virtual window
      this.updateVisiblePages(startIndex);

      // reset loading state
      this.loadingSet.clear();
      this.loadingCount = 0;
      this.focusPageId = null;

      // ensure loader is visible at start
      if (!this.isLoaderVisible) {
        this.loading.show();
        this.isLoaderVisible = true;
      }

      // invalidate previous async work
      this.loadToken++;

      // reset scroll position
      const container = document.querySelector('.reader-container');
      if (container) container.scrollTop = 0;

      // wait for DOM render before attaching observer
      requestAnimationFrame(() => {
        this.setupObserver();
        this.observeImages();
      });
    });


    // reacts to navigation (page change)
    effect(() => {
      const tick = this.reader.navTick();
      const pageId = this.reader.currentPageId();
      const pages = this.reader.pages();

      if (!pageId || !pages.length) return;

      this.handleNavigation(pageId);
    });

  }

  ngAfterViewInit(): void {
    this.setupObserver();

    // re-attach observer when DOM changes
    this.imgRefs.changes
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.observeImages();
      });
  }

  private destroyed = false;

  // cleanup: disconnect observer + revoke URLs
  ngOnDestroy(): void {
    this.destroyed = true;

    this.observer?.disconnect();

    this.pageUrls.forEach((url, id) => { this.urlService.revokeUrl(String(id)); });
    this.pageUrls.clear();
  }

  private setupObserver() {
    this.observer?.disconnect();

    this.observer = new IntersectionObserver(async (entries) => {

      // skip during navigation to avoid conflicts
      if (this.isNavigating) return;

      const token = this.loadToken;

      // calculate center point for prioritization
      let centerY = window.innerHeight / 2;

      // if navigating to specific page -> use its center
      if (this.focusPageId !== null) {
        const el = this.imgRefs.find(r =>
          Number(r.nativeElement.dataset['pageId']) === this.focusPageId
        )?.nativeElement;

        if (el) {
          const rect = el.getBoundingClientRect();
          centerY = rect.top + rect.height / 2;
        }
      }

      // sort visible entries by distance to center
      const visible = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => {
          const aCenter = a.boundingClientRect.top + a.boundingClientRect.height / 2;
          const bCenter = b.boundingClientRect.top + b.boundingClientRect.height / 2;

          return Math.abs(aCenter - centerY) - Math.abs(bCenter - centerY);
        })
        .slice(0, this.MAX_LOAD * 2);

      // update current page bookmark based on center
      if (!this.isNavigating && visible.length > 0) {
        const centerEntry = visible[0];
        const id = Number((centerEntry.target as HTMLImageElement).dataset['pageId']);

        if (id && this.reader.currentPageId() !== id) {
          this.reader.setCurrentPageBookmark(id);
        }
      }

      for (const entry of visible) {

        // cancel outdated async work
        if (token !== this.loadToken) return;

        const img = entry.target as HTMLImageElement;
        const id = Number(img.dataset['pageId']);

        const globalIndex = this.pageIndexMap.get(id);

        // check if virtual window needs update
        if (globalIndex !== undefined) {

          const first = this.visiblePages[0]?.id;
          const last = this.visiblePages[this.visiblePages.length - 1]?.id;

          if (
            first === undefined ||
            last === undefined ||
            globalIndex < this.pageIndexMap.get(first)! + this.BUFFER ||
            globalIndex > this.pageIndexMap.get(last)! - this.BUFFER
          ) {
            this.preserveScroll(id, () => {
              this.updateVisiblePages(globalIndex);
            });
          }
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
            if (!alreadyExists && url) {
              this.urlService.revokeUrl(url);
            }
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
      rootMargin: '1200px',
      threshold: 0.01
    });
  }

  // attaches observer to all current images
  private observeImages() {
    this.imgRefs.forEach(ref => {
      this.observer.unobserve(ref.nativeElement);
    });

    this.observer.disconnect();

    this.imgRefs.forEach(ref => {
      this.observer.observe(ref.nativeElement);
    });
  }

  // loads image and waits until ready (with fallback timeout)
  private async loadImage(img: HTMLImageElement, url: string) {
    return new Promise<void>((resolve) => {

      // already loaded
      if (img.src === url && img.complete) {
        resolve();
        return;
      }

      // fallback for stuck loading (especially iOS)
      const timeout = setTimeout(resolve, 10000);

      img.onload = () => {
        clearTimeout(timeout);
        resolve();
      };

      img.onerror = () => {
        clearTimeout(timeout);
        resolve();
      };

      img.src = url;
    });
  }

  // ensures page has src (lazy fetch)
  private async ensurePageLoaded(page: Page) {
    if (page.src) return;

    const full = await this.pagesRepo.get(page.id!);

    if (full) {
      page.src = full.src;
      page.pageNumber = full.pageNumber;
    }
  }

  // resolves URL (string or Blob)
  private async getOrCreateUrl(page: Page): Promise<string> {
    if (typeof page.src === 'string') return page.src;
    if (!(page.src instanceof Blob) || page.id == null) return '';

    if (!this.pageUrls.has(page.id)) {
      const url = await this.urlService.createUrl(`${page.id}`, page.src);
      this.pageUrls.set(page.id, url);
    }

    return this.pageUrls.get(page.id)!;
  }

  // removes images far from current index
  private cleanupFarImages(currentId: number) {
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

  // handles navigation to specific page
  private async handleNavigation(pageId: number) {

    this.isNavigating = true;
    this.focusPageId = pageId;

    if (!this.isLoaderVisible) {
      this.loading.show();
      this.isLoaderVisible = true;
    }

    // wait until DOM images exist
    await this.waitForImages();

    const index = this.pageIndexMap.get(pageId);
    if (index === undefined) return;

    // update window before loading
    this.updateVisiblePages(index);

    const pages = this.visiblePages;
    const start = Math.max(0, index - this.MAX_LOAD);
    const end = Math.min(pages.length, index + this.MAX_LOAD + 1);

    const toLoad = pages.slice(start, end);

    // preload nearby pages
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

    // scroll to target page
    const target = this.imgRefs.find(r =>
      Number(r.nativeElement.dataset['pageId']) === pageId
    )?.nativeElement;

    if (target) {
      target.scrollIntoView({
        behavior: 'auto',
        block: 'start'
      });
    }

    this.isNavigating = false;
    this.focusPageId = null;

    if (this.isLoaderVisible) {
      this.loading.hide();
      this.isLoaderVisible = false;
    }
  }

  // scroll helper with retry (when DOM not ready)
  async scrollToPage(pageId: number) {

    this.focusPageId = pageId;

    if (!this.isLoaderVisible) {
      this.loading.show();
      this.isLoaderVisible = true;
    }

    let target: HTMLElement | undefined;
    let attempts = 0;

    while (attempts < 5 && !target) {
      await new Promise(r => setTimeout(r, 50));

      target = this.imgRefs.find(r =>
        Number(r.nativeElement.dataset['pageId']) === pageId
      )?.nativeElement;

      attempts++;
    }

    if (target) {
      target.scrollIntoView({
        behavior: 'auto',
        block: 'center'
      });
    }
  }

  // getters for template

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

  // waits until images exist in DOM
  private async waitForImages(): Promise<void> {
    let tries = 0;

    while (this.imgRefs && this.imgRefs.length === 0 && tries < 10) {
      await new Promise(r => setTimeout(r, 30));
      tries++;
    }
  }

  // keeps scroll stable when DOM changes
  // prevents visible jumps during window shift
  private preserveScroll(anchorId: number, callback: () => void) {
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


  // updates virtual window around current index
  private updateVisiblePages(centerIndex: number) {
    const start = Math.max(0, centerIndex - 40);
    const end = Math.min(this.pages.length, centerIndex + 40);

    const newIds = new Set(
      this.pages.slice(start, end).map(p => p.id)
    );

    // revoke URLs outside window
    this.pageUrls.forEach((url, id) => {
      if (!newIds.has(id)) {
        this.urlService.revokeUrl(String(id));
        this.pageUrls.delete(id);
      }
    });

    this.visiblePages = this.pages.slice(start, end);
  }

  // checks if last page is visible
  get isLastPage(): boolean {
    const pages = this.pages;
    if (!pages.length) return false;

    const lastPageId = pages[pages.length - 1].id;
    return this.visiblePages.some(p => p.id === lastPageId);
  }

  // loads next chapter and opens it
  async goToNextChapter() {
    var chapter = await this.chaptersRepo.getNextChapter(this.reader.chapterId()!);
    if (!chapter) return;

    var pages = await this.pagesRepo.getMetaByChapter(chapter.id!);

    this.reader.open({
      mangaId: chapter.tabId!,
      chapterId: chapter.id!,
      pages: pages, // chapter pages 
      currentPageId: pages[0]?.id
    });

  }
}