import { AfterViewInit, Component, Input, QueryList, ViewChildren, ElementRef, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Page } from 'src/app/core/models/page.model';

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

  ngAfterViewInit(): void {
    this.setupObserver();
    this.observeImages();
    
    this.imgRefs.changes.subscribe(() => this.observeImages());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['pages']) {
      const previousPages = changes['pages'].previousValue as Page[] || [];
      const currentPages = changes['pages'].currentValue as Page[] || [];
      
      this.cleanupUnusedUrls(previousPages, currentPages);
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
      // Сортируем по близости к viewport
      const visibleEntries = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => {
          const aDistance = Math.abs(a.boundingClientRect.top);
          const bDistance = Math.abs(b.boundingClientRect.top);
          return aDistance - bDistance;
        });

      // Загружаем только ближайшие изображения, не превышая лимит
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
        const blobUrl = URL.createObjectURL(page.src);
        this.pageUrls.set(page.id, blobUrl);
      }
    });
  }

  private cleanupUnusedUrls(oldPages: Page[], newPages: Page[]) {
    const newPageIds = new Set(newPages.map(p => p.id).filter(Boolean));
    
    this.pageUrls.forEach((url, pageId) => {
      if (!newPageIds.has(pageId)) {
        URL.revokeObjectURL(url);
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
}