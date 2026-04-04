import { AfterViewInit, Component, QueryList, ViewChildren, ElementRef, OnDestroy, effect, } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Page } from 'src/app/core/models/page.model';
import { ObjectUrlService } from 'src/app/core/services/object-url.service';
import { LoadingService } from 'src/app/core/services/loading.service';
import { ReaderService } from 'src/app/core/services/reader.service';
import { isIOS } from 'src/app/shared/utils/constants';

@Component({
  selector: 'manga-reader',
  templateUrl: './reader.component.html',
  styleUrls: ['./reader.component.css'],
  standalone: true,
  imports: [CommonModule]
})
export class ReaderComponent implements AfterViewInit, OnDestroy {

  // WINDOWING CONFIG (virtualization)

  private windowSize = 10;           // how many pages we keep in DOM
  private preloadThreshold = 3;      // when to shift window (near edges)
  private startIndex = 0;            // start index of current window
  private isJumping = false;         // prevent double navigation

  visiblePages: Page[] = [];

  // IMAGE LOADING STATE

  observer!: IntersectionObserver;

  pageUrls: Map<number, string> = new Map(); // cache for blob URLs

  private readonly MAX_CONCURRENT_LOAD = 8; // limit parallel image loading
  private currentlyLoading = 0;

  private isShifting = false; // prevent multiple window shifts

  @ViewChildren('imgRef')
  imgRefs!: QueryList<ElementRef<HTMLImageElement>>;

  constructor(
    private urlService: ObjectUrlService,
    private loading: LoadingService,
    public reader: ReaderService
  ) {

    // REACT: pages changed
    effect(() => {
      const pages = this.reader.pages();
      if (!pages || pages.length === 0) return;

      // reset window to start
      this.startIndex = 0;

      this.updateVisiblePages();

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
      const tick = this.reader.navTick(); // trigger signal

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

    // slice only visible window
    this.visiblePages = pages.slice(
      this.startIndex,
      this.startIndex + this.windowSize
    );
  }

  private async jumpToPage(pageId: number) {
    const pages = this.reader.pages();

    const index = pages.findIndex(p => p.id === pageId);
    if (index === -1) return;

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

  private shiftWindowUp() {
    if (this.isShifting) return;
    if (this.startIndex === 0) return;

    this.isShifting = true;

    this.preserveScrollPosition(() => {
      this.startIndex = Math.max(
        this.startIndex - this.preloadThreshold,
        0
      );

      this.updateVisiblePages();
      this.refreshAfterWindowChange();
    });

    setTimeout(() => this.isShifting = false, 100);
  }

  private shiftWindowDown() {
    if (this.isShifting) return;

    const pages = this.reader.pages();
    if (this.startIndex + this.windowSize >= pages.length) return;

    this.isShifting = true;

    this.preserveScrollPosition(() => {
      this.startIndex = Math.min(
        this.startIndex + this.preloadThreshold,
        pages.length - this.windowSize
      );

      this.updateVisiblePages();
      this.refreshAfterWindowChange();
    });

    setTimeout(() => this.isShifting = false, 100);
  }

  private refreshAfterWindowChange() {
    // remove unused URLs + create new
    this.cleanupUnusedUrls(this.visiblePages);
    this.createPageUrls(this.visiblePages);

    // reset observer (old elements are gone)
    this.observer?.disconnect();

    setTimeout(() => {
      this.setupObserver();
      this.observeImages();
    });
  }

  // SCROLL HANDLING

  private scrollTimeout: any;

  private onScroll() {
    // debounce scroll (avoid too many calls)
    clearTimeout(this.scrollTimeout);

    this.scrollTimeout = setTimeout(() => {
      this.checkWindowShift();
    }, 50);
  }

  private checkWindowShift() {
    const current = this.getCurrentPage();
    if (!current) return;

    // find current index inside visible window
    const visibleIndex = this.visiblePages.findIndex(p => p.id === current.pageId);
    if (visibleIndex === -1) return;

    // near bottom → shift down
    if (visibleIndex >= this.windowSize - this.preloadThreshold) {
      this.shiftWindowDown();
    }

    // near top → shift up
    if (visibleIndex <= this.preloadThreshold) {
      this.shiftWindowUp();
    }
  }

  private preserveScrollPosition(callback: () => void) {
    const container = document.querySelector<HTMLElement>('.reader-container');
    if (!container) return;

    // find first visible image as anchor
    let anchorEl: HTMLElement | null = null;
    let anchorOffset = 0;

    for (const ref of this.imgRefs.toArray()) {
      const el = ref.nativeElement;
      const rect = el.getBoundingClientRect();

      if (rect.top >= 0) {
        anchorEl = el;
        anchorOffset = rect.top;
        break;
      }
    }

    callback(); // change window

    // restore scroll position
    requestAnimationFrame(() => {
      if (!anchorEl) return;

      const newRect = anchorEl.getBoundingClientRect();
      const delta = newRect.top - anchorOffset;

      container.scrollTop += delta;
    });
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
    this.observer = new IntersectionObserver((entries) => {

      // sort by distance to viewport center (priority loading)
      const visibleEntries = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) =>
          Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top)
        );

      for (const entry of visibleEntries) {
        if (this.currentlyLoading >= this.MAX_CONCURRENT_LOAD) break;

        const img = entry.target as HTMLImageElement;
        const dataSrc = img.dataset['src'];

        // load only if not loaded yet
        if (dataSrc && (!img.src || img.src === '')) {
          this.loadImage(img, dataSrc);
          this.observer.unobserve(img);
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
      return img.dataset['src'] && (!img.src || img.src === '');
    });

    unloadedImages.forEach(ref => {
      this.observer.observe(ref.nativeElement);
    });
  }

  private loadImage(imgElement: HTMLImageElement, dataSrc: string) {
    if (this.currentlyLoading >= this.MAX_CONCURRENT_LOAD) return;

    if (!imgElement.src) {
      this.currentlyLoading++;

      imgElement.onload = () => {
        this.currentlyLoading--;
        setTimeout(() => this.observeImages(), 50);
      };

      imgElement.onerror = () => {
        this.currentlyLoading--;
        console.error('Failed to load image:', dataSrc);
      };

      imgElement.src = dataSrc;
    }
  }

  // URL MANAGEMENT (blob handling)

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

  // SCROLL TO PAGE (navigation)

  private scrollInProgress = false;

  async scrollToPage(pageId: number) {
    if (this.scrollInProgress) return;

    this.scrollInProgress = true;
    this.loading.show();

    const container = document.querySelector<HTMLElement>('.reader-container');
    const current = this.getCurrentPage();

    // already on page → skip
    if (!container || current?.pageId === pageId) {
      this.loading.hide();
      this.scrollInProgress = false;
      return;
    }

    const index = this.pages.findIndex(p => p.id === pageId);
    if (index === -1) {
      this.loading.hide();
      this.scrollInProgress = false;
      return;
    }

    // preload all images before target
    for (let i = 0; i <= index; i++) {
      const ref = this.imgRefs.find(r =>
        Number(r.nativeElement.dataset['pageId']) === this.pages[i].id
      );
      if (ref) await this.loadImageAsync(ref.nativeElement);
    }

    await new Promise(r => setTimeout(r, 50));

    const target = this.imgRefs.find(r =>
      Number(r.nativeElement.dataset['pageId']) === pageId
    )?.nativeElement;

    if (!target) {
      this.loading.hide();
      this.scrollInProgress = false;
      return;
    }

    // scroll to exact position
    const top = target.offsetTop;
    container.scrollTo({ top, behavior: 'smooth' });

    await this.waitForScroll(container, top);

    this.loading.hide();
    this.scrollInProgress = false;
  }

  private loadImageAsync(img: HTMLImageElement): Promise<void> {
    return new Promise(resolve => {
      if (img.src && img.complete) return resolve();

      const dataSrc = img.dataset['src'];

      if (dataSrc && !img.src) {
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = dataSrc;
      } else {
        const onLoad = () => {
          img.removeEventListener('load', onLoad);
          resolve();
        };
        img.addEventListener('load', onLoad);
      }
    });
  }

  private waitForScroll(container: HTMLElement, target: number): Promise<void> {
    return new Promise(resolve => {
      const start = performance.now();

      const check = () => {
        if (Math.abs(container.scrollTop - target) <= 1) {
          resolve();
        } else if (performance.now() - start > 2000) {
          console.warn('Scroll timeout');
          resolve();
        } else {
          requestAnimationFrame(check);
        }
      };

      requestAnimationFrame(check);
    });
  }
}