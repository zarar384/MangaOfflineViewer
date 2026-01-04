import { AfterViewInit, Component, Input, QueryList, ViewChildren, ElementRef, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Page } from 'src/app/core/models/page.model';
import { ObjectUrlService } from 'src/app/core/services/object-url.service';
import { Bookmark } from 'src/app/core/models/bookmark';
import { LoadingService } from 'src/app/core/services/loading.service';

@Component({
  selector: 'manga-reader',
  templateUrl: './reader.component.html',
  styleUrls: ['./reader.component.css'],
  standalone: true,
  imports: [CommonModule]
})
export class ReaderComponent implements AfterViewInit, OnChanges {
  @Input() pages: Page[] = [];
  @Input() gap = 16;
  @Input() mode: 'scroll' | 'page' = 'scroll';
  @Input() zoom = 1;

  observer!: IntersectionObserver;
  pageUrls: Map<number, string> = new Map();
  private readonly MAX_CONCURRENT_LOAD = 8;
  private currentlyLoading = 0;

  @ViewChildren('imgRef') imgRefs!: QueryList<ElementRef<HTMLImageElement>>;
  constructor(private urlService: ObjectUrlService, private loading: LoadingService) { }
  ngAfterViewInit(): void {
    this.setupObserver();
    this.observeImages();

    this.imgRefs.changes.subscribe(() => this.observeImages());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['pages']) {
      const previousPages = changes['pages'].previousValue as Page[] || [];
      const currentPages = changes['pages'].currentValue as Page[] || [];

      this.cleanupUnusedUrls(currentPages);
      this.createPageUrls(currentPages); // create blob URLs for all pages
      this.currentlyLoading = 0;

      setTimeout(() => {
        if (this.observer) {
          this.observer.disconnect();
        }
        this.setupObserver();
        this.observeImages();
      }, 0);
    }
  }

  private setupObserver() {
    this.observer = new IntersectionObserver((entries) => {
      // sort entries by proximity to viewport
      const visibleEntries = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => {
          const aDistance = Math.abs(a.boundingClientRect.top);
          const bDistance = Math.abs(b.boundingClientRect.top);
          return aDistance - bDistance;
        });

      // logic to load images with concurrency limit
      for (const entry of visibleEntries) {
        if (this.currentlyLoading >= this.MAX_CONCURRENT_LOAD) {
          break;
        }

        const img = entry.target as HTMLImageElement;
        const dataSrc = img.dataset['src'];

        if (dataSrc && (!img.src || img.src === '')) {
          this.loadImage(img, dataSrc);
          this.observer.unobserve(img);
        }
      }
    }, {
      rootMargin: '300px',
      threshold: 0.01
    });
  }

  private observeImages() {
    if (!this.imgRefs || !this.observer) return;

    // unobserve all 
    this.imgRefs.forEach(ref => {
      this.observer.unobserve(ref.nativeElement);
    });

    // subscribe only to unloaded images
    const unloadedImages = this.imgRefs.filter(ref => {
      const img = ref.nativeElement;
      return img.dataset['src'] && (!img.src || img.src === '');
    });

    unloadedImages.forEach(ref => {
      this.observer.observe(ref.nativeElement);
    });
  }

  private loadImage(imgElement: HTMLImageElement, dataSrc: string) {
    if (this.currentlyLoading >= this.MAX_CONCURRENT_LOAD) {
      return;
    }

    if (!imgElement.src || imgElement.src === '') {
      this.currentlyLoading++;

      imgElement.onload = () => {
        this.currentlyLoading--;
        // after image is loaded check for more images to load
        setTimeout(() => this.observeImages(), 50);
      };

      imgElement.onerror = () => {
        this.currentlyLoading--;
        console.error('Failed to load image:', dataSrc);
      };

      imgElement.src = dataSrc;
    }
  }

  private createPageUrls(pages: Page[]) {
    pages.forEach(page => {
      if (page.src instanceof Blob && page.id !== undefined && !this.pageUrls.has(page.id)) {
        const blobUrl = this.urlService.createUrl(`${page.id}`, page.src);
        this.pageUrls.set(page.id, blobUrl);
      }
    });
  }

  private cleanupUnusedUrls(newPages: Page[]) {
    const newPageIds = new Set(newPages.map(p => p.id).filter(Boolean));

    this.pageUrls.forEach((url, pageId) => {
      if (!newPageIds.has(pageId)) {
        this.urlService.revokeUrl(url);
        this.pageUrls.delete(pageId);
      }
    });
  }


  getPageUrl(page: Page): string {
    if (page.src instanceof Blob && page.id !== undefined) {
      return this.pageUrls.get(page.id) || '';
    }
    return typeof page.src === 'string' ? page.src : '';
  }

  // page navigation logic 
  public getCurrentPage(): { pageId: number } | null {
    const container = document.querySelector<HTMLElement>('.reader-container');
    if (!container) return null;

    let closestPageId: number | null = null;
    let minDistance = Infinity;

    this.imgRefs.forEach(ref => {
      const img = ref.nativeElement;
      const rect = img.getBoundingClientRect();
      const distance = Math.abs(rect.top);
      const pageId = Number(img.dataset['pageId']);

      if (distance < minDistance) {
        minDistance = distance;
        closestPageId = pageId;
      }
    });

    if (closestPageId == null) return null;
    return { pageId: closestPageId };
  }

  private scrollInProgress = false;

  async scrollToPage(pageId: number) {
    if (this.scrollInProgress) return;
    this.scrollInProgress = true;
    this.loading.show();

    // check if already at the page
    const container = document.querySelector<HTMLElement>('.reader-container');
    const currentPage = this.getCurrentPage();
    if (!container || currentPage?.pageId === pageId) {
      this.loading.hide();
      this.scrollInProgress = false;
      return null;
    }

    // find the index of the target page
    const pageIndex = this.pages.findIndex(p => p.id === pageId);
    if (pageIndex === -1) {
      this.loading.hide();
      this.scrollInProgress = false;
      return;
    }

    // load images up to the target page
    for (let i = 0; i <= pageIndex; i++) {
      const ref = this.imgRefs.find(r => Number(r.nativeElement.dataset['pageId']) === this.pages[i].id);
      if (ref) await this.loadImageAsync(ref.nativeElement);
    }

    // whait until DOM is updated
    await new Promise(resolve => setTimeout(resolve, 50));

    // find the target image
    const targetImg = this.imgRefs.find(r => Number(r.nativeElement.dataset['pageId']) === pageId)?.nativeElement;
    if (!targetImg) {
      this.loading.hide();
      this.scrollInProgress = false;
      return;
    }

    // scroll to the target image
    const targetScrollTop = targetImg.offsetTop;
    container.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
    await this.waitForScroll(container, targetScrollTop);

    this.loading.hide();
    this.scrollInProgress = false;
  }

  private loadImageAsync(img: HTMLImageElement): Promise<void> {
    return new Promise(resolve => {
      if (img.src && img.complete) {
        resolve();
      } else {
        const dataSrc = img.dataset['src'];
        if (dataSrc && (!img.src || img.src === '')) {
          img.onload = () => resolve();
          img.onerror = () => resolve(); // resolve even on error to avoid blocking
          img.src = dataSrc;
        } else {
          const onLoad = () => {
            img.removeEventListener('load', onLoad);
            resolve();
          };
          img.addEventListener('load', onLoad);
        }
      }
    });
  }

  private waitForScroll(container: HTMLElement, target: number): Promise<void> {
    return new Promise(resolve => {
      const tolerance = 1;
      const maxTime = 2000;
      const startTime = performance.now();

      const check = () => {
        if (Math.abs(container.scrollTop - target) <= tolerance) {
          resolve();
        } else if (performance.now() - startTime > maxTime) {
          console.warn('Scroll timeout reached');
          resolve();
        } else {
          requestAnimationFrame(check);
        }
      };

      requestAnimationFrame(check);
    });
  }
}