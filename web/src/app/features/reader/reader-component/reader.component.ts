import { AfterViewInit, Component, QueryList, ViewChildren, ElementRef, OnDestroy, effect, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Page, PageMeta } from '../../../core/models/page.model';
import { ObjectUrlService } from '../../../core/services/object-url.service';
import { LoadingService } from '../../../core/services/loading.service';
import { ReaderService } from '../../../core/services/reader.service';
import { isIOS } from '../../../shared/utils/constants';
import { PagesRepository } from '../../../core/repositories/pages.repository';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'manga-reader',
  templateUrl: './reader.component.html',
  styleUrls: ['./reader.component.css'],
  standalone: true,
  imports: [CommonModule],
})
export class ReaderComponent implements AfterViewInit, OnDestroy {

  @ViewChildren('imgRef')
  imgRefs!: QueryList<ElementRef<HTMLImageElement>>;

  private observer!: IntersectionObserver;

  private isNavigating = false;

  private pageUrls = new Map<number, string>();

  private pageIndexMap = new Map<number, number>();

  private MAX_LOAD = 6;
  private loadingCount = 0;

  private loadingSet = new Set<number>();

  private isLoaderVisible = false;

  private focusPageId: number | null = null;

  private CLEANUP_RADIUS = 10;

  private loadToken = 0;

  private BUFFER = 5; // number of pages from edge to trigger window update

  visiblePages: Page[] = [];

  constructor(
    private urlService: ObjectUrlService,
    private loading: LoadingService,
    public reader: ReaderService,
    private pagesRepo: PagesRepository,
    private destroyRef: DestroyRef
  ) {

    // reset state when pages changed
    effect(() => {
      const pages = this.reader.pages();
      if (!pages?.length) return;

      // clear old URLs
      this.pageUrls.forEach(url => this.urlService.revokeUrl(url));
      this.pageUrls.clear();

      // build index map for O(1) access
      this.pageIndexMap.clear();
      pages.forEach((p, i) => this.pageIndexMap.set(p.id!, i));

      const startIndex = this.reader.currentPageId()
        ? this.pageIndexMap.get(this.reader.currentPageId()!) ?? 0
        : 0;

      // initialize virtual window
      this.updateVisiblePages(startIndex);

      this.loadingSet.clear();
      this.loadingCount = 0;
      this.focusPageId = null;

      if (!this.isLoaderVisible) {
        this.loading.show();
        this.isLoaderVisible = true;
      }

      this.loadToken++;

      const container = document.querySelector('.reader-container');
      if (container) container.scrollTop = 0;

      // wait DOM render
      requestAnimationFrame(() => {
        this.setupObserver();
        this.observeImages();
      });
    });


    // navigation
    effect(() => {
      const pageId = this.reader.currentPageId();
      const pages = this.reader.pages();

      if (!pageId || !pages.length) return;

      this.handleNavigation(pageId);
    });

  }

  ngAfterViewInit(): void {
    this.setupObserver();

    // re-observe when DOM changes
    this.imgRefs.changes
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.observeImages();
      });
  }

  private destroyed = false;

  ngOnDestroy(): void {
    this.destroyed = true;

    this.observer?.disconnect();

    // revoke all URLs
    this.pageUrls.forEach(url => this.urlService.revokeUrl(url));
    this.pageUrls.clear();
  }

  private setupObserver() {
    this.observer?.disconnect();

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

      for (const entry of visible) {

        if (token !== this.loadToken) return;

        const img = entry.target as HTMLImageElement;
        const id = Number(img.dataset['pageId']);

        const globalIndex = this.pageIndexMap.get(id);

        // update virtual window only when leaving range
        if (globalIndex !== undefined) {

          const first = this.visiblePages[0]?.id;
          const last = this.visiblePages[this.visiblePages.length - 1]?.id;

          if (
            first === undefined ||
            last === undefined ||
            globalIndex < this.pageIndexMap.get(first)! + this.BUFFER ||
            globalIndex > this.pageIndexMap.get(last)! - this.BUFFER
          ) {
            this.updateVisiblePages(globalIndex);
          }
        }

        const page = this.visiblePages.find(p => p.id === id);
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

          await this.ensurePageLoaded(page);
          if(this.destroyed) return;

          if (token !== this.loadToken) return;

          const alreadyExists = this.pageUrls.has(page.id!);

          const url = await this.getOrCreateUrl(page);
          if(this.destroyed) return;

          if (token !== this.loadToken) {
            if (!alreadyExists && url) {
              this.urlService.revokeUrl(url);
            }
            return;
          }

          if (!url) continue;

          await this.loadImage(img, url);
          if(this.destroyed) return;

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
      rootMargin: '800px',
      threshold: 0.01
    });
  }

  private observeImages() {
    // revoke old URLs that are no longer visible
    this.imgRefs.forEach(ref => {
      this.observer.unobserve(ref.nativeElement);
    });

    // reset observer targets
    this.observer.disconnect();

    // re-observe current images
    this.imgRefs.forEach(ref => {
      this.observer.observe(ref.nativeElement);
    });
  }

  private async loadImage(img: HTMLImageElement, url: string) {
    return new Promise<void>((resolve) => {

      if (img.src === url && img.complete) {
        resolve();
        return;
      }

      // fallback for iOS stuck loading
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

  private async ensurePageLoaded(page: Page) {
    if (page.src) return;

    const full = await this.pagesRepo.get(page.id!);

    if (full) {
      page.src = full.src;
      page.pageNumber = full.pageNumber;
    }
  }

  private async getOrCreateUrl(page: Page): Promise<string> {
    if (typeof page.src === 'string') return page.src;
    if (!(page.src instanceof Blob) || page.id == null) return '';

    if (!this.pageUrls.has(page.id)) {
      const url = await this.urlService.createUrl(`${page.id}`, page.src);
      this.pageUrls.set(page.id, url);
    }

    return this.pageUrls.get(page.id)!;
  }

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

      // remove far images from memory
      if (index < min || index > max) {

        if (this.pageUrls.has(id)) {
          this.urlService.revokeUrl(this.pageUrls.get(id)!);
          this.pageUrls.delete(id);
        }

        this.loadingSet.delete(id);
      }
    });
  }

  private async handleNavigation(pageId: number) {

    this.isNavigating = true;
    this.focusPageId = pageId;

    if (!this.isLoaderVisible) {
      this.loading.show();
      this.isLoaderVisible = true;
    }

    await this.waitForImages();

    const index = this.pageIndexMap.get(pageId);
    if (index === undefined) return;

    // update visible window before load
    this.updateVisiblePages(index);

    const pages = this.visiblePages;
    const start = Math.max(0, index - this.MAX_LOAD);
    const end = Math.min(pages.length, index + this.MAX_LOAD + 1);

    const toLoad = pages.slice(start, end);

    await Promise.all(
      toLoad.map(async (page) => {

        if (this.loadingSet.has(page.id!)) return;

        this.loadingSet.add(page.id!);

        try {
          await this.ensurePageLoaded(page);
          if(this.destroyed) return;

          const url = await this.getOrCreateUrl(page);
          if(this.destroyed) return;

          if (!url) return;

          const img = this.imgRefs.find(r =>
            Number(r.nativeElement.dataset['pageId']) === page.id
          )?.nativeElement;

          if (!img) return;

          await this.loadImage(img, url);
          if(this.destroyed) return;

        } finally {
          this.loadingSet.delete(page.id!);
        }
      })
    );

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

  trackByPage(page: Page, index: number) {
    return isIOS ? `${page.id}-${index}` : page.id;
  }

  private async waitForImages(): Promise<void> {
    let tries = 0;

    while (this.imgRefs.length === 0 && tries < 10) {
      await new Promise(r => setTimeout(r, 30));
      tries++;
    }
  }

  // virtual window around current page
  private updateVisiblePages(centerIndex: number) {
    const start = Math.max(0, centerIndex - 20);
    const end = Math.min(this.pages.length, centerIndex + 20);

    const newIds = new Set(
      this.pages.slice(start, end).map(p => p.id)
    );

    // revoke URLs that are no longer visible
    this.pageUrls.forEach((url, id) => {
      if (!newIds.has(id)) {
        this.urlService.revokeUrl(url);
        this.pageUrls.delete(id);
      }
    });

    this.visiblePages = this.pages.slice(start, end);
  }
}