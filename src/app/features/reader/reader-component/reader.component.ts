import { AfterViewInit, Component, Input, QueryList, ViewChildren, ElementRef, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Page } from 'src/app/core/models/page.model';

@Component({
  selector: 'manga-reader',
  templateUrl: './reader.component.html',
  styleUrls: ['./reader.component.css'],
  standalone: true,
  imports: [CommonModule]
})
export class ReaderComponent implements AfterViewInit,  OnChanges 
//OnDestroy,
{
  @Input() pages: Page[] = [];
  @Input() gap = 16;
  @Input() mode: 'scroll' | 'page' = 'scroll';
  @Input() zoom = 1;

  observer!: IntersectionObserver;
  pageUrls: Map<number, string> = new Map();

  get pageUrlsArray(): { id: number, src: string }[] {
    return Array.from(this.pageUrls.entries()).map(([id, src]) => ({ id, src }));
  }

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

      setTimeout(() => {
        // this.cleanupUnusedUrls(previousPages, currentPages);
        this.createPageUrls(currentPages);
        this.observeImages();
      }, 0);
    }
  }

  // ngOnDestroy(): void {
  //   this.cleanupAllUrls();
  //   if (this.observer) {
  //     this.observer.disconnect();
  //   }
  // }

  private setupObserver() {
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target as HTMLImageElement;
          const dataSrc = img.dataset['src'];
          if (dataSrc && !img.src) {
            img.src = dataSrc;
          }
          this.observer.unobserve(img);
        }
      });
    }, { rootMargin: '300px' });
  }

  private observeImages() {
    if (!this.imgRefs) return;

    this.imgRefs.forEach(ref => {
      const img = ref.nativeElement;
      if (img.dataset['src'] && (!img.src || img.src === '')) {
        this.observer.observe(img);
      }
    });
  }

  private createPageUrls(pages: Page[]) {
    pages.forEach(page => {
      if (page.src instanceof Blob && page.id !== undefined && !this.pageUrls.has(page.id)) {
        const blobUrl = URL.createObjectURL(page.src);
        this.pageUrls.set(page.id, blobUrl);
        console.log('Created Blob URL:', blobUrl, 'for page ID:', page.id);
      }
    });
  }

  // in PWA it's not necessary to revoke blob urls as browser handles it
  // private cleanupUnusedUrls(oldPages: Page[], newPages: Page[]) {
  //   const newPageIds = new Set(newPages.map(p => p.id));

  //   const urlsToRemove: number[] = [];
  //   this.pageUrls.forEach((url, pageId) => {
  //     if (!newPageIds.has(pageId)) {
  //       urlsToRemove.push(pageId);
  //     }
  //   });

  //   urlsToRemove.forEach(pageId => {
  //     const url = this.pageUrls.get(pageId);
  //     if (url) {
  //       this.revokeUrlSafely(url, pageId);
  //       this.pageUrls.delete(pageId);
  //     }
  //   });
  // }

  // private cleanupAllUrls() {
  //   console.log('Cleaning up all Blob URLs on destroy');
  //   this.pageUrls.forEach((url, pageId) => {
  //     this.revokeUrlSafely(url, pageId);
  //   });
  //   this.pageUrls.clear();
  // }

  // private revokeUrlSafely(url: string, pageId: number) {
  //   try {
  //     if (this.imgRefs) {
  //       this.imgRefs.forEach(ref => {
  //         const img = ref.nativeElement;
  //         if (img.src === url || img.dataset['src'] === url) {
  //           img.src = '';
  //           img.removeAttribute('src');
  //         }
  //       });
  //     }

  //     setTimeout(() => {
  //       URL.revokeObjectURL(url);
  //       console.log('Revoked Blob URL:', url, 'for page ID:', pageId);
  //     }, 100);

  //   } catch (error) {
  //     console.error('Error revoking URL:', url, error);
  //   }
  // }

  getPageUrl(page: Page): string {
    if (page.src instanceof Blob && page.id !== undefined) {
      return this.pageUrls.get(page.id) || '';
    }
    return typeof page.src === 'string' ? page.src : '';
  }
}