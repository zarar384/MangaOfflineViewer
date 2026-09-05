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
import { MangaStructureMetadata, MangaStructurePageMetadata } from '../../models/manga-structure-metadata';
import { parseMangaStructureMetadata } from '../../utils/manga-structure-metadata';
import { ArchiveReader, openArchiveReader } from '../../utils/zip-random-access';

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
  @Input() disabled = false;
  @Input() saveAll$!: Subject<[Tab, Chapter | undefined]>;
  @Input() clearAll$!: Subject<void>;
  @Input() enableMangaStructureMetadata = false;

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
  private importedMetadata?: MangaStructureMetadata;
  private importedPagesByAsset = new Map<string, Page>();

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

    const save = this.importedMetadata && !tab.id
      ? this.tabsRepo.saveImportedMangaStructure(tab, this.importedMetadata, this.importedPagesByAsset)
      : this.tabsRepo.saveOrUpdateTabWithPages(tab, this.items().map(item => item.page), { chapter });

    return from(save).pipe(
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
    this.importedMetadata = undefined;
    this.importedPagesByAsset.clear();
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
  // Reads one entry at a time from disk via File.slice() instead of buffering the whole archive.
  private async extractArchive(file: File) {
    const archive = await openArchiveReader(file);
    const metadataName = '.molv/manga-structure.json';

    const hasMetadataFile = this.enableMangaStructureMetadata && archive.names.includes(metadataName);

    if (hasMetadataFile) {
      try {
        const metadataBytes = await archive.read(metadataName);
        const result = parseMangaStructureMetadata(
          JSON.parse(new TextDecoder().decode(metadataBytes)),
          new Set(archive.names)
        );
        if (result.metadata && this.items().length === 0) {
          // Metadata order wins over the physical order of archive entries.
          await this.importStructuredArchive(file, archive, result.metadata);
          return;
        }
        if (result.metadata) console.warn('Ignoring archive metadata combined with other selected files.');
        console.warn('Ignoring invalid archive manga structure metadata:', result.error);
      } catch (error) {
        console.warn('Ignoring unreadable archive manga structure metadata:', error);
      }
    }
    else if (this.enableMangaStructureMetadata) {
      this.enableMangaStructureMetadata = false;
    }

    const entries = archive.names
      .filter(k => /\.(jpe?g|png|gif|webp|bmp)$/i.test(k))
      .sort(numericNameSort);

    this.clearImportedStructure();
    for (const entryName of entries) {
      const bytes = await archive.read(entryName);
      await this.addBlobImage(new Blob([bytes]), this.generateName(file.name, entryName));
      this.progress.update(p => Math.min(90, p + 1));
      await sleepIfNeeded();
    }
  }

  // MHTML
  // Streams images out of the file one at a time (see MhtmlExtractorService.extractStreaming);
  // never holds the whole document, the whole image list, or a whole image's base64 text in
  // memory. The one exception is metadata-driven import, which still buffers every referenced
  // Blob (not text) before the final ordered import, because metadata can reorder pages relative
  // to their physical position in the file and that isn't known until the scan reaches the end.
  private async extractMhtml(file: File) {
    this.clearImportedStructure();

    if (this.enableMangaStructureMetadata && this.items().length === 0) {
      const blobsByAsset = new Map<string, Blob>();

      const { metadataJson } = await this.mhtmlService.extractStreaming(file, image => {
        if (image.pageId) blobsByAsset.set(image.pageId, image.blob);
      });

      if (metadataJson) {
        try {
          const parsed = parseMangaStructureMetadata(JSON.parse(metadataJson), new Set(blobsByAsset.keys()));
          if (parsed.metadata) {
            try {
              await this.importStructuredMhtml(file, parsed.metadata, blobsByAsset);
              return;
            } catch (error) {
              // Do not restore a partial structure when a referenced asset cannot be read.
              console.warn('Ignoring MHTML metadata with unreadable image assets:', error);
            }
          } else {
            console.warn('Ignoring invalid MHTML manga structure metadata:', parsed.error);
          }
        } catch (error) {
          console.warn('Ignoring unreadable MHTML manga structure metadata:', error);
        }
      }

      this.enableMangaStructureMetadata = false;

      // No usable metadata: import the blobs already collected (in physical document order)
      // instead of re-scanning the whole file a second time.
      let index = 0;
      const total = blobsByAsset.size || 1;
      for (const blob of blobsByAsset.values()) {
        await this.addBlobImage(blob, this.generateName(file.name, `${index}`));
        index++;
        this.progress.set(calculateProgress(85, 100, index, total));
        await sleepIfNeeded();
      }
      return;
    }

    let index = 0;
    await this.mhtmlService.extractStreaming(file, async image => {
      await this.addBlobImage(image.blob, this.generateName(file.name, `${index}`));
      index++;
      this.progress.set(calculateProgress(85, 100, this.mhtmlService.progress(), 100));
      await sleepIfNeeded();
    });
  }

  private async addImageFile(file: File) {
    this.clearImportedStructure();
    await this.addBlobImage(file, file.name);
  }

  private async addBlobImage(blob: Blob, name?: string): Promise<Page> {
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

    const page = { src: pageSrc, name, tabId: 0, width: size.width, height: size.height };
    this.items.update(items => [...items, { page, url: previewSrc }]);
    return page;
  }

  private async importStructuredArchive(
    file: File,
    archive: ArchiveReader,
    metadata: MangaStructureMetadata
  ) {
    await this.importStructured(metadata, async item =>
      this.addBlobImage(new Blob([await archive.read(item.asset)]), this.generateName(file.name, item.asset))
    );
  }

  private async importStructuredMhtml(
    file: File,
    metadata: MangaStructureMetadata,
    blobs: ReadonlyMap<string, Blob>
  ) {
    await this.importStructured(metadata, item => {
      const blob = blobs.get(item.asset);
      if (!blob) throw new Error(`Missing image data for asset "${item.asset}"`);
      return this.addBlobImage(blob, this.generateName(file.name, item.asset));
    });
  }

  private async importStructured(
    metadata: MangaStructureMetadata,
    addPage: (item: MangaStructurePageMetadata) => Promise<Page>
  ) {
    const items = metadata.mode === 'chapters'
      ? metadata.chapters.flatMap(chapter => chapter.pages)
      : metadata.pages;
    const pagesByAsset = new Map<string, Page>();

    for (const item of items) {
      pagesByAsset.set(item.asset, await addPage(item));
      this.progress.update(progress => Math.min(90, progress + 1));
      await sleepIfNeeded();
    }

    this.importedMetadata = metadata;
    this.importedPagesByAsset = pagesByAsset;
  }

  private clearImportedStructure() {
    this.importedMetadata = undefined;
    this.importedPagesByAsset.clear();
  }

  remove(index: number) {
    this.clearImportedStructure();
    const itUrl = this.items()[index];
    if (itUrl?.url.startsWith('blob:')) {
      this.urlService.revokeUrl(itUrl.url);
    }

    this.items.update(items => items.filter((_, i) => i !== index));
  }

  drop(event: CdkDragDrop<any[]>) {
    if (event.previousIndex === event.currentIndex) return;

    this.clearImportedStructure();
    //copy urls array
    const newUrls = [...this.items()];
    moveItemInArray(newUrls, event.previousIndex, event.currentIndex);

    // update urls signal with new order
    this.items.set(newUrls);
  }

  onDrop(event: DragEvent) {
    if (this.disabled) return;

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
    if (this.disabled) return;
    if (input.files?.length) {
      this.onFilesDropped(input.files);
    }
  }
}
