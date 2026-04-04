import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal, inject, OnChanges, SimpleChanges, OnInit, OnDestroy } from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import * as JSZip from 'jszip';
import { calculateProgress, generateId, numericNameSort, sleepIfNeeded } from '../../utils/file-parsing';
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

@Component({
  selector: 'molv-drop-uploader',
  imports: [CommonModule, DragDropModule],
  templateUrl: './molv-drop-uploader.components.html',
  styleUrls: ['./molv-drop-uploader.components.css'],
  standalone: true
})
export class MolvDropUploaderComponents implements OnDestroy, OnChanges {
  @Input() pages: Page[] = [];
  @Input() visible = true;
  @Input() saveAll$!: Subject<[Tab, Chapter | undefined]>;
  @Input() clearAll$!: Subject<void>;

  @Output() onDropFinished = new EventEmitter<void>();
  @Output() fileSelected = new EventEmitter<string>();
  @Output() filesProcessing = new EventEmitter<boolean>();

  private tabsRepo = inject(TabsRepository);
  private urlService = inject(ObjectUrlService);
  private mhtmlService = inject(MhtmlExtractorService);
  private tabsService = inject(TabsService);
  private loading = inject(LoadingService);

  // subs
  private saveSub?: Subscription;
  private clearSub?: Subscription;

  progress = signal(0);
  urls = signal<{ name?: string; src: string }[]>([]);
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
    if (changes['pages']) {
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
      this.tabsRepo.saveOrUpdateTabWithPages(tab, this.pages, { chapter })
    ).pipe(
      tap(() => {
        this.tabsService.refresh();
      }),
      finalize(() => {
        this.loading.hide();
        this.clearAll();
      })
    );
  }

  clearAll() {
    this.pages = [];
    this.urls.set([]);
  }

  private async rebuildUrls() {
    const urls = await Promise.all(
      this.pages.map(async p => ({
        name: p.name,
        src: await this.urlService.createUrl(p.name ?? 'page', p.src)
      }))
    );

    this.urls.set(urls);
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
      await this.extractZip(file);
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

  // ZIP
  private async extractZip(file: File) {
    const zip = await JSZip.loadAsync(file);
    const entries = Object.keys(zip.files)
      .filter(k => !zip.files[k].dir && /\.(jpe?g|png|gif|webp|bmp)$/i.test(k))
      .sort(numericNameSort);

    for (const entryName of entries) {
      const blob = await zip.files[entryName].async('blob');
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
      const blob = await fetch(src).then(r => r.blob());
      await this.addBlobImage(blob, this.generateName(file.name, `${index}`));
      this.progress.set(calculateProgress(85, 100, index++, imgs.length));
      await sleepIfNeeded();
    }
  }

  private async addImageFile(file: File) {
    await this.addBlobImage(file, file.name);
  }

  private async addBlobImage(blob: Blob, name?: string) {
    let pageSrc: Blob | string;
    let previewSrc: string;

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

    this.pages.push({
      src: pageSrc,
      name,
      tabId: 0
    });

    this.urls.update(u => [...u, { src: previewSrc, name }]);
  }

  remove(index: number) {
    const itUrl = this.urls()[index];
    if (itUrl?.src.startsWith('blob:')) {
      this.urlService.revokeUrl(itUrl.src);
    }

    this.pages.splice(index, 1);
    this.urls.update(u => u.filter((_, i) => i !== index));
  }

  drop(event: CdkDragDrop<any[]>) {
    moveItemInArray(this.pages, event.previousIndex, event.currentIndex);
    moveItemInArray(this.urls(), event.previousIndex, event.currentIndex);
    this.urls.set([...this.urls()]);
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
