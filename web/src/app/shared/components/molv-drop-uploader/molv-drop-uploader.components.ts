import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal, inject, OnChanges, SimpleChanges, OnInit, OnDestroy } from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import * as JSZip from 'jszip';
import { calculateProgress, generateId, numericNameSort, sleepIfNeeded } from '../../utils/file-parsing';
import { Tab } from 'src/app/core/models/tab.model';
import { TabsRepository } from 'src/app/core/repositories/tabs.repository';
import { Page } from 'src/app/core/models/page.model';
import { ObjectUrlService } from 'src/app/core/services/object-url.service';
import { MhtmlExtractorService } from 'src/app/core/services/mhtml-extractor.service';
import { LoadingService } from 'src/app/core/services/loading.service';
import { Subject,  tap, finalize, from, Subscription } from 'rxjs';
import { TabsService } from 'src/app/core/services/tabs.service';

@Component({
  selector: 'molv-drop-uploader',
  imports: [CommonModule, DragDropModule],
  templateUrl: './molv-drop-uploader.components.html',
  styleUrls: ['./molv-drop-uploader.components.css'],
  standalone: true
})
export class MolvDropUploaderComponents implements OnInit, OnDestroy, OnChanges {
  @Input() pages: Page[] = [];
  @Input() visible = true;
  @Input() saveAll$!: Subject<Tab>;
  @Input() clearAll$!: Subject<void>;

  @Output() onDropFinished = new EventEmitter<void>();
  @Output() fileSelected = new EventEmitter<string>();

  private tabsRepo = inject(TabsRepository);
  private urlService = inject(ObjectUrlService);
  private mhtmlService = inject(MhtmlExtractorService);
  private tabsService = inject(TabsService);
  private loading = inject(LoadingService);

  filesProcessing = signal(false);
  progress = signal(0);
  urls = signal<{ name?: string; src: string }[]>([]);

  private sub = new Subscription();

  ngOnInit() {
    // save command
    this.sub.add(
      this.saveAll$.subscribe(tab => {
        this.saveAll(tab).subscribe();
      })
    );

    // clear command
    this.sub.add(
      this.clearAll$.subscribe(() => this.clearAll())
    );
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['pages']) {
      this.rebuildUrls();
    }
  }

  ngOnDestroy() {
    this.sub.unsubscribe();
  }

  private rebuildUrls() {
    this.urls.set(
      this.pages.map(p => ({
        name: p.name,
        src: this.urlService.createUrl(p.name ?? 'page', p.src)
      }))
    );
  }

  saveAll(tab: Tab) {
    this.loading.show();

    return from(
      this.tabsRepo.saveOrUpdateTabWithPages(tab, this.pages)
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

  async onFilesDropped(files: FileList | File[]) {
    if (this.filesProcessing()) return;

    this.filesProcessing.set(true);
    this.progress.set(0);

    try {
      for (const f of Array.from(files)) {
        await this.processFile(f);
      }
      this.onDropFinished.emit();
      this.fileSelected.emit(files[0]?.name);
    } finally {
      this.filesProcessing.set(false);
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
    const url = this.urlService.createUrl(name!, blob);

    this.pages.push({ src: blob, name, tabId: 0 });
    this.urls.update(u => [...u, { src: url, name }]);
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
