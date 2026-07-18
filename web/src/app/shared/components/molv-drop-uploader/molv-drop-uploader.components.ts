import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal, inject, OnChanges, SimpleChanges, OnInit, OnDestroy } from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { calculateProgress, generateId, getImageSize, numericNameSort, sleepIfNeeded } from '../../utils/file-parsing';
import { Tab } from '../../../core/models/tab.model';
import { TabsRepository } from '../../../core/repositories/tabs.repository';
import { Page } from '../../../core/models/page.model';
import { ObjectUrlService } from '../../../core/services/object-url.service';
import { MhtmlExtractorService } from '../../../core/services/mhtml-extractor.service';
import { LoadingService } from '../../../core/services/loading.service';
import { Subject, tap, finalize, from, Subscription, switchMap } from 'rxjs';
import { TabsService } from '../../../core/services/tabs.service';
import { isIOS } from '../../utils/constants';
import { Chapter } from '../../../core/models/chapter.model';
import { PagesRepository } from '../../../core/repositories/pages.repository';
import { StorageInfoService } from 'src/app/core/services/storage-info.service';
import { unzipSync } from 'fflate';

@Component({
  selector: 'molv-drop-uploader',
  imports: [CommonModule, DragDropModule],
  templateUrl: './molv-drop-uploader.components.html',
  styleUrls: ['./molv-drop-uploader.components.css'],
  standalone: true
})
export class MolvDropUploaderComponents implements OnDestroy, OnChanges {
  @Input() chapterId?: number;
  @Input() tabId?: number;
  @Input() visible = true;
  @Input() saveAll$!: Subject<[Tab, Chapter | undefined]>;
  @Input() clearAll$!: Subject<void>;

  @Output() onDropFinished = new EventEmitter<void>();
  @Output() fileSelected = new EventEmitter<string>();
  @Output() filesProcessing = new EventEmitter<boolean>();

  private pageRepo = inject(PagesRepository);
  private tabsRepo = inject(TabsRepository);
  private urlService = inject(ObjectUrlService);
  private mhtmlService = inject(MhtmlExtractorService);
  private tabsService = inject(TabsService);
  private loading = inject(LoadingService);
  private storageInfo = inject(StorageInfoService);

  // subs
  private saveSub?: Subscription;
  private clearSub?: Subscription;

  progress = signal(0);
  items = signal<{ page: Page; url: string }[]>([]);
  isProcessing = signal(false);

  ngOnChanges(changes: SimpleChanges) {
    // save
    if (changes['saveAll$']) {
      this.saveSub?.unsubscribe();

      if (this.saveAll$) {
        this.saveSub = this.saveAll$
          .pipe(
            switchMap(([tab, chapter]) =>
              this.saveAll(tab, chapter)
            )
          )
          .subscribe();
      }
    }

    // clear
    if (changes['clearAll$']) {
      this.clearSub?.unsubscribe();

      if (this.clearAll$) {
        this.clearSub = this.clearAll$.pipe(
          tap(() => {
            this.clearAll();
          })
        ).subscribe();
      }
    }

    // pages
    if (
      changes['tabId'] ||
      changes['chapterId'] ||
      (changes['visible'] && this.visible)
    ) {
      this.rebuildUrls();
    }
  }

  ngOnDestroy() {
    this.saveSub?.unsubscribe();
    this.clearSub?.unsubscribe();
  }

  saveAll(tab: Tab, chapter: Chapter | undefined) {
    this.loading.show();

    return from(
      this.tabsRepo.saveOrUpdateTabWithPages(tab, this.items().map(item => item.page), { chapter })
    ).pipe(
      tap(() => {
        this.tabsService.refresh();
      }),
      switchMap(() => from(this.storageInfo.refresh())), // promise to observable and wait for it to complete before finalizing
      finalize(() => {
        this.loading.hide();
        this.clearAll();
      })
    );
  }

  clearAll() {
    this.items.set([]);
  }

  private async rebuildUrls() {
    if (!this.tabId) return;

    const pages = await this.pageRepo.getAll(this.tabId!, this.chapterId);

    const urls = await Promise.all(
      pages.map(async (p) => ({
        name: p.name,
        src: await this.urlService.createUrl(p.name ?? 'page', p.src!)
      }))
    );

    this.items.set(pages.map((p, i) => ({ page: p, url: urls[i]!.src })));
  }

  async onFilesDropped(files: FileList | File[]) {
    this.filesProcessing.emit(true);
    this.isProcessing.set(true);
    this.progress.set(0);

    try {
      for (const f of Array.from(files)) {
        await this.processFile(f);
      }
      this.onDropFinished.emit();
      this.fileSelected.emit(files[0]?.name);
    } finally {
      this.filesProcessing.emit(false);
      this.isProcessing.set(false);
      this.progress.set(100);
      await sleepIfNeeded();
    }
  }

  private async processFile(file: File) {
    const name = file.name.toLowerCase();

    if (name.endsWith('.zip') || name.endsWith('.cbz')) {
      await this.extractArchive(file);
    } else if (name.endsWith('.mhtml') || name.endsWith('.mht')) {
      await this.extractMhtml(file);
    } else if (this.isImageFile(file)) {
      await this.addImageFile(file);
    }
  }

  private isImageFile(f: File) {
    return f.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp)$/i.test(f.name);
  }

  private generateName(name: string, addition: string): string {
    return `${name.slice(0, 5)}${generateId()}/${addition}`;
  }

  // ZIP / CBZ
  private async extractArchive(file: File) {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const archive = unzipSync(buffer);

    const entries = Object.keys(archive)
      .filter(k => /\.(jpe?g|png|gif|webp|bmp)$/i.test(k))
      .sort(numericNameSort);

    for (const entryName of entries) {
      const blob = new Blob([archive[entryName]]);
      await this.addBlobImage(blob, this.generateName(file.name, entryName));
      this.progress.update(p => Math.min(90, p + 1));
      await sleepIfNeeded();
    }
  }

  // MHTML
  private async extractMhtml(file: File) {
    const imgs = await this.mhtmlService.extractImagesFromMhtml(file);

    let index = 0;
    for (const src of imgs) {

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000); // token to abort fetch after 5 seconds

      try {
        const response = await fetch(src, {
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const blob = await response.blob();

        await this.addBlobImage(
          blob,
          this.generateName(file.name, `${index}`)
        );
      }
      catch (error) {
        console.warn(
          `Failed to import image ${index + 1}/${imgs.length}`,
          {
            src,
            error
          }
        );
      }
      finally {
        clearTimeout(timeout);

        this.progress.set(
          calculateProgress(85, 100, index + 1, imgs.length)
        );

        index++;

        await sleepIfNeeded();
      }
    }
  }

  private async addImageFile(file: File) {
    await this.addBlobImage(file, file.name);
  }

  private async addBlobImage(blob: Blob, name?: string) {
    let pageSrc: Blob | string;
    let previewSrc: string;

    const size = await getImageSize(blob);

    if (isIOS) {
      const reader = new FileReader();
      pageSrc = await new Promise<string>(resolve => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });

      previewSrc = pageSrc; // data URL
    } else {
      pageSrc = blob;
      previewSrc = await this.urlService.createUrl(name!, blob);
    }

    this.items.update(items => [...items, { page: { src: pageSrc, name, tabId: 0, width: size.width, height: size.height }, url: previewSrc }]);
  }

  remove(index: number) {
    const itUrl = this.items()[index];
    if (itUrl?.url.startsWith('blob:')) {
      this.urlService.revokeUrl(itUrl.url);
    }

    this.items.update(items => items.filter((_, i) => i !== index));
  }

  drop(event: CdkDragDrop<any[]>) {
    if (event.previousIndex === event.currentIndex) return;

    //copy urls array
    const newUrls = [...this.items()];
    moveItemInArray(newUrls, event.previousIndex, event.currentIndex);

    // update urls signal with new order
    this.items.set(newUrls);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();

    const files = event.dataTransfer?.files;
    if (files?.length) {
      this.onFilesDropped(files);
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
  }

  onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      this.onFilesDropped(input.files);
    }
  }
}
