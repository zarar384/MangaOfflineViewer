import { AfterViewInit, Component, QueryList, ViewChildren, ElementRef, OnDestroy, effect, } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Page } from '../../../core/models/page.model';
import { ObjectUrlService } from '../../../core/services/object-url.service';
import { LoadingService } from '../../../core/services/loading.service';
import { ReaderService } from '../../../core/services/reader.service';
import { isIOS } from '../../../shared/utils/constants';
import { PagesRepository } from '../../../core/repositories/pages.repository';

@Component({
  selector: 'manga-reader',
  templateUrl: './reader.component.html',
  styleUrls: ['./reader.component.css'],
  standalone: true,
  imports: [CommonModule]
})
export class ReaderComponent implements AfterViewInit, OnDestroy {

  // WINDOWING CONFIG (virtualization)

  private windowSize = 10;                      // how many pages we keep in DOM
  private startIndex = 0;                       // start index of current window
  private isJumping = false;                    // prevent double navigation
  private currentIndex = 0;                     // current index within window

  visiblePages: Page[] = [];

  // IMAGE LOADING STATE

  observer!: IntersectionObserver;

  pageUrls: Map<number, string> = new Map(); // cache for blob URLs

  private readonly MAX_CONCURRENT_LOAD = 8; // limit parallel image loading
  private currentlyLoading = 0;

  private preloading = new Set<number>(); // track pages being preloaded
  private readonly PRELOAD_RADIUS = 3; // how many pages to preload around current
  private loadingSet = new Set<number>(); // track pages currently loading (for UI feedback)

  @ViewChildren('imgRef')
  imgRefs!: QueryList<ElementRef<HTMLImageElement>>;

  constructor(
    private urlService: ObjectUrlService,
    private loading: LoadingService,
    public reader: ReaderService,
    private pagesRepo: PagesRepository
  ) {

    // REACT: pages changed
    effect(() => {
      const pages = this.reader.pages();
      if (!pages || pages.length === 0) return;

      // reset window to start
      this.startIndex = 0;

      this.updateVisiblePages();

      for (let i = 0; i < Math.min(3, this.visiblePages.length); i++) {
        this.ensurePageLoaded(this.visiblePages[i]).then(() => {
          this.createPageUrls([this.visiblePages[i]]);
        });
      }

      // cleanup old URLs + create new ones
      this.cleanupUnusedUrls(this.visiblePages);
      this.createPageUrls(this.visiblePages);

      this.currentlyLoading = 0;

      // reset observer (DOM must be ready)
      setTimeout(() => {
        this.observer?.disconnect();
        this.setupObserver();
        this.observeImages();
      });
    });

    // REACT: navigation (page change)
    effect(() => {
      const pageId = this.reader.currentPageId();
      const pages = this.reader.pages();
      const tick = this.reader.navTick(); // trigger signal

      // skip if pageId does not belong to current pages (IOS can have old pageId after chapter change)
      const exists = pages.some(p => p.id === pageId);
      if (!exists || pages.length === 0) return;

      if (!pageId) return;
      if (this.isJumping) return;

      this.isJumping = true;

      setTimeout(async () => {
        // move window to include target page
        await this.jumpToPage(pageId);

        // scroll to that page
        await this.scrollToPage(pageId);

        this.isJumping = false;
      }, 50);
    });
  }

  // LIFECYCLE

  ngAfterViewInit(): void {
    this.setupObserver();
    this.observeImages();

    // listen scroll for window shifting
    const container = document.querySelector('.reader-container');
    container?.addEventListener('scroll', () => this.onScroll());

    // when DOM images change → reobserve
    this.imgRefs.changes.subscribe(() => this.observeImages());
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();

    // release all blob URLs (memory cleanup)
    this.pageUrls.forEach(url => this.urlService.revokeUrl(url));
    this.pageUrls.clear();
  }

  // DATA HELPERS

  get pages(): Page[] {
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

  // WINDOW MANAGEMENT

  private updateVisiblePages() {
    const pages = this.reader.pages();

    const half = Math.floor(this.windowSize / 2);

    const start = Math.max(0, this.currentIndex - half);
    const end = Math.min(pages.length, this.currentIndex + half + 1);

    this.startIndex = start;
    this.visiblePages = pages.slice(start, end);
  }
  private async jumpToPage(pageId: number) {
    const pages = this.reader.pages();

    const index = pages.findIndex(p => p.id === pageId);
    if (index === -1) return;

    this.currentIndex = index;

    // center page inside window
    const half = 3;

    this.startIndex = Math.max(0, index - half);

    // prevent overflow
    if (this.startIndex + this.windowSize > pages.length) {
      this.startIndex = pages.length - this.windowSize;
    }

    if (this.startIndex < 0) this.startIndex = 0;

    // IMPORTANT:
    // update DOM BEFORE scroll so target page exists
    this.updateVisiblePages();
    this.refreshAfterWindowChange();

    // wait DOM render
    await new Promise(r => setTimeout(r, 50));
  }

  private refreshAfterWindowChange() {
    // remove unused URLs + create new
    this.cleanupUnusedUrls(this.visiblePages);
    this.createPageUrls(this.visiblePages);

    // reset observer (old elements are gone)
    setTimeout(() => {
      this.observeImages();
    });
  }

  // SCROLL HANDLING

  private onScroll() {
    if (this.isJumping) return;

    const current = this.getCurrentPage();
    if (!current) return;

    const index = this.pages.findIndex(p => p.id === current.pageId);
    if (index === -1) return;

    this.currentIndex = index;

    this.updateVisiblePages();
    this.refreshAfterWindowChange();
  }

  public getCurrentPage(): { pageId: number } | null {
    const container = document.querySelector<HTMLElement>('.reader-container');
    if (!container) return null;

    let closest: number | null = null;
    let min = Infinity;

    // find image closest to top of viewport
    this.imgRefs.forEach(ref => {
      const img = ref.nativeElement;

      if (!img.complete) return;

      const distance = Math.abs(img.getBoundingClientRect().top);
      const id = Number(img.dataset['pageId']);

      if (distance < min) {
        min = distance;
        closest = id;
      }
    });

    return closest == null ? null : { pageId: closest };
  }

  // IMAGE LOADING (lazy + priority)

  private setupObserver() {
    this.observer = new IntersectionObserver(async (entries) => {

      // sort by distance to viewport center (priority loading)
      const visibleEntries = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) =>
          Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top)
        );

      for (const entry of visibleEntries) {
        if (this.currentlyLoading >= this.MAX_CONCURRENT_LOAD) break;

        const img = entry.target as HTMLImageElement;
        const pageId = Number(img.dataset['pageId']);

        if (this.loadingSet.has(pageId)) continue;

        const page = this.pages.find(p => p.id === pageId);
        if (!page) continue;

        this.loadingSet.add(pageId);

        this.ensurePageLoaded(page).then(() => {
          this.createPageUrls([page]).then(() => {
            const src = this.getPageUrl(page);

            if (src && img.src !== src) {
              this.loadImage(img, src, pageId);
              this.observer.unobserve(img);
            } else {
              this.loadingSet.delete(pageId);
            }
          });
        });

        //  preload nearby pages (priority loading)
        const index = this.pages.findIndex(p => p.id === pageId);
        if (index !== -1) {
          this.preloadNearby(index);
        }
      }

    }, {
      rootMargin: '800px', // preload before entering viewport
      threshold: 0.01
    });
  }

  private observeImages() {
    if (!this.imgRefs || !this.observer) return;

    // clear previous observers
    this.imgRefs.forEach(ref => {
      this.observer.unobserve(ref.nativeElement);
    });

    // observe only unloaded images
    const unloadedImages = this.imgRefs.filter(ref => {
      const img = ref.nativeElement;
      return !img.src;
    });

    unloadedImages.forEach(ref => {
      this.observer.observe(ref.nativeElement);
    });
  }

  private loadImage(imgElement: HTMLImageElement, dataSrc: string, pageId: number) {
    if (this.currentlyLoading >= this.MAX_CONCURRENT_LOAD) return;

    if (!imgElement.src) {
      this.currentlyLoading++;

      imgElement.onload = () => {
        this.currentlyLoading--;
        this.loadingSet.delete(pageId);
        setTimeout(() => this.observeImages(), 50);
      };

      imgElement.onerror = () => {
        this.currentlyLoading--;
        this.loadingSet.delete(pageId);
        console.error('Failed to load image:', dataSrc);
      };

      imgElement.src = dataSrc;
    }
  }

  // URL MANAGEMENT (blob handling)

  private async preloadNearby(centerIndex: number) {
    const pages = this.pages;

    const start = Math.max(0, centerIndex - this.PRELOAD_RADIUS);
    const end = Math.min(pages.length - 1, centerIndex + this.PRELOAD_RADIUS);

    const tasks: Promise<void>[] = [];

    for (let i = start; i <= end; i++) {
      const page = pages[i];

      if (!page?.id) continue;

      // already has 
      if (page.src) continue;

      // in progress
      if (this.preloading.has(page.id)) continue;

      this.preloading.add(page.id);

      const task = this.ensurePageLoaded(page)
        .then(() => {
          // create URL for this page (if needed)
          this.createPageUrls([page]);
        })
        .finally(() => {
          this.preloading.delete(page.id!);
        });

      tasks.push(task);
    }

    // wait for all preloads to finish (optional, can be fire-and-forget)
    await Promise.allSettled(tasks);
  }

  private async ensurePageLoaded(page: Page) {
    if (page.src) return;

    const full = await this.pagesRepo.get(page.id!);

    if (full) {
      page.src = full.src;
      page.pageNumber = full.pageNumber;
    }
  }

  private async createPageUrls(pages: Page[]) {
    if (isIOS) return; // iOS handles blobs differently

    for (const page of pages) {
      if (
        page.src instanceof Blob &&
        page.id !== undefined &&
        !this.pageUrls.has(page.id)
      ) {
        const blobUrl = await this.urlService.createUrl(`${page.id}`, page.src);
        this.pageUrls.set(page.id, blobUrl);
      }
    }
  }

  private cleanupUnusedUrls(newPages: Page[]) {
    if (isIOS) {
      this.pageUrls.clear();
      return;
    }

    const newIds = new Set(newPages.map(p => p.id).filter(Boolean));

    // remove URLs not in current window
    this.pageUrls.forEach((url, id) => {
      if (!newIds.has(id)) {
        this.urlService.revokeUrl(url);
        this.pageUrls.delete(id);
      }
    });
  }

  getPageUrl(page: Page): string {
    if (isIOS) {
      if (typeof page.src === 'string') return page.src;
      if (page.src instanceof Blob) return URL.createObjectURL(page.src);
      return '';
    }

    if (page.src instanceof Blob && page.id !== undefined) {
      return this.pageUrls.get(page.id) || '';
    }

    return typeof page.src === 'string' ? page.src : '';
  }

  trackByPage(page: Page, index: number) {
    if (isIOS) {
      return `${page.id}-${index}`;
    }

    return page.id;
  }

  // SCROLL TO PAGE (navigation)

  private scrollInProgress = false;

  async scrollToPage(pageId: number) {
    if (this.scrollInProgress) return;

    this.scrollInProgress = true;
    this.loading.show();

    const container = document.querySelector<HTMLElement>('.reader-container');

    // no container => nothing to do
    if (!container) {
      this.loading.hide();
      this.scrollInProgress = false;
      return;
    }

    // skip if already near target (optional optimization)
    const current = this.getCurrentPage();
    if (current?.pageId === pageId) {
      this.loading.hide();
      this.scrollInProgress = false;
      return;
    }

    // find target page in state
    const page = this.pages.find(p => p.id === pageId);
    if (!page) {
      this.loading.hide();
      this.scrollInProgress = false;
      return;
    }

    // IMPORTANT:
    // at this point jumpToPage already moved window
    // so target page SHOULD exist in DOM

    // ensure ONLY target page is loaded (not all previous)
    await this.ensurePageLoaded(page);
    await this.createPageUrls([page]);

    // wait DOM update (imgRefs refresh)
    await new Promise(r => setTimeout(r, 50));

    const target = this.imgRefs.find(r =>
      Number(r.nativeElement.dataset['pageId']) === pageId
    )?.nativeElement;

    // target still not in DOM → give up safely
    if (!target) {
      this.loading.hide();
      this.scrollInProgress = false;
      return;
    }

    // instant jump (no smooth → faster & no glitches)
    const top = target.offsetTop;
    container.scrollTo({ top, behavior: 'auto' });

    // preload around target (UX boost)
    const index = this.pages.findIndex(p => p.id === pageId);
    if (index !== -1) {
      this.preloadNearby(index);
    }

    this.loading.hide();
    this.scrollInProgress = false;
  }
}