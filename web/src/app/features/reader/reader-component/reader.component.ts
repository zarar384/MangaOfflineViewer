import {
  AfterViewInit,
  Component,
  QueryList,
  ViewChildren,
  ElementRef,
  OnDestroy,
  effect,
  EffectRef
} from '@angular/core';
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

  constructor(
    private urlService: ObjectUrlService,
    private loading: LoadingService,
    public reader: ReaderService
  ) {

    // React to pages change
    effect(() => {
      const pages = this.reader.pages();

      if (!pages || pages.length === 0) return;

      this.cleanupUnusedUrls(pages);
      this.createPageUrls(pages);
      this.currentlyLoading = 0;

      setTimeout(() => {
        this.observer?.disconnect();
        this.setupObserver();
        this.observeImages();
      });
    });

    // React to navigation
    effect(() => {
      const pageId = this.reader.startPageId();

      if (!pageId) return;

      setTimeout(() => {
        this.scrollToPage(pageId);
      }, 50);
    });
  }

  get pages(): Page[] {
    return this.reader.pages();
  }

  observer!: IntersectionObserver;
  pageUrls: Map<number, string> = new Map();

  private readonly MAX_CONCURRENT_LOAD = 8;
  private currentlyLoading = 0;

  @ViewChildren('imgRef') imgRefs!: QueryList<ElementRef<HTMLImageElement>>;


  ngAfterViewInit(): void {
    this.setupObserver();
    this.observeImages();

    this.imgRefs.changes.subscribe(() => this.observeImages());
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();

    this.pageUrls.forEach(url => this.urlService.revokeUrl(url));
    this.pageUrls.clear();
  }

  // IMAGE LOADING
  private setupObserver() {
    this.observer = new IntersectionObserver((entries) => {
      const visibleEntries = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top));

      for (const entry of visibleEntries) {
        if (this.currentlyLoading >= this.MAX_CONCURRENT_LOAD) break;

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

    this.imgRefs.forEach(ref => {
      this.observer.unobserve(ref.nativeElement);
    });

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

  // URL MANAGEMENT
  private async createPageUrls(pages: Page[]) {
    if (isIOS) return;

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

  get readerMode() {
    return this.reader.mode();
  }

  get readerZoom() {
    return this.reader.zoom();
  }

  get readerGap() {
    return this.reader.gap();
  }

  // NAVIGATION
  public getCurrentPage(): { pageId: number } | null {
    const container = document.querySelector<HTMLElement>('.reader-container');
    if (!container) return null;

    let closest: number | null = null;
    let min = Infinity;

    this.imgRefs.forEach(ref => {
      const img = ref.nativeElement;
      const distance = Math.abs(img.getBoundingClientRect().top);
      const id = Number(img.dataset['pageId']);

      if (distance < min) {
        min = distance;
        closest = id;
      }
    });

    return closest == null ? null : { pageId: closest };
  }

  private scrollInProgress = false;

  async scrollToPage(pageId: number) {
    if (this.scrollInProgress) return;

    this.scrollInProgress = true;
    this.loading.show();

    const container = document.querySelector<HTMLElement>('.reader-container');
    const current = this.getCurrentPage();

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