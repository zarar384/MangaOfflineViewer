import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal, inject, OnChanges, SimpleChanges, OnDestroy } from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { blobToDataURL, generateId, numericNameSort, sleepIfNeeded } from '../../utils/file-parsing';
import { createImagePreview } from '../../utils/preview';
import { detectImageFormat, imageFormatFromFilename } from '../../utils/image-format';
import { Tab } from '../../../core/models/tab.model';
import { PageToSave, TabsRepository } from '../../../core/repositories/tabs.repository';
import { MhtmlExtractorService } from '../../../core/services/mhtml-extractor.service';
import { LoadingService } from '../../../core/services/loading.service';
import { Subject, Subscription } from 'rxjs';
import { TabsService } from '../../../core/services/tabs.service';
import { isIOS } from '../../utils/constants';
import { Chapter } from '../../../core/models/chapter.model';
import { ChaptersRepository } from '../../../core/repositories/chapters.repository';
import { PagesRepository } from '../../../core/repositories/pages.repository';
import { StorageInfoService } from 'src/app/core/services/storage-info.service';
import { ChaptersMangaStructureMetadata } from '../../models/manga-structure-metadata';
import { parseMangaStructureMetadata } from '../../utils/manga-structure-metadata';
import { ArchiveReader, openArchiveReader } from '../../utils/zip-random-access';
import { ViewMod } from '../../enums/viewmod.enum';

type ImportItem = { page: PageToSave; url: string };
type ImportedStructure = {
  metadata: ChaptersMangaStructureMetadata;
  pagesByAsset: Map<string, PageToSave>;
};

const ARCHIVE_METADATA_NAME = '.molv/manga-structure.json';
const METADATA_MAX_BYTES = 4 * 1024 * 1024;
const THUMBNAIL_SIZE = 160;

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
  @Output() saveFinished = new EventEmitter<void>();

  private pageRepo = inject(PagesRepository);
  private chaptersRepo = inject(ChaptersRepository);
  private tabsRepo = inject(TabsRepository);
  private mhtmlService = inject(MhtmlExtractorService);
  private tabsService = inject(TabsService);
  private loading = inject(LoadingService);
  private storageInfo = inject(StorageInfoService);

  private saveSub?: Subscription;
  private clearSub?: Subscription;
  private work?: AbortController;
  private importedStructure?: ImportedStructure;
  private loadedTabId?: number;
  private rebuildVersion = 0;

  progress = signal(0);
  items = signal<ImportItem[]>([]);
  isProcessing = signal(false);
  isSaving = signal(false);
  errorMessage = signal('');

  ngOnChanges(changes: SimpleChanges) {
    if (changes['saveAll$']) {
      this.saveSub?.unsubscribe();
      this.saveSub = this.saveAll$?.subscribe(([tab, chapter]) => void this.saveAll(tab, chapter));
    }
    if (changes['clearAll$']) {
      this.clearSub?.unsubscribe();
      this.clearSub = this.clearAll$?.subscribe(() => this.clearAll());
    }
    if (changes['visible'] || changes['tabId'] || changes['chapterId']) {
      const tabId = this.tabId;
      if (this.visible && tabId) {
        const version = ++this.rebuildVersion;
        // Let the parent finish checking its busy indicator before emitting filesProcessing.
        queueMicrotask(() => {
          if (version === this.rebuildVersion) void this.rebuildUrls(tabId);
        });
      } else {
        this.clearAll();
      }
    }
  }

  ngOnDestroy() {
    this.saveSub?.unsubscribe();
    this.clearSub?.unsubscribe();
    this.clearAll();
  }

  private async saveAll(tab: Tab, chapter: Chapter | undefined) {
    if (this.isProcessing() || this.isSaving()) return;
    if (this.tabId !== undefined && this.loadedTabId !== this.tabId) {
      this.showError('Could not save manga', new Error('Saved pages were not loaded'));
      return;
    }

    this.errorMessage.set('');
    this.isSaving.set(true);
    this.filesProcessing.emit(true);
    this.loading.show();
    let saved = false;
    try {
      const structure = this.importedStructure;
      if (this.enableMangaStructureMetadata && tab.mode === ViewMod.Chapters && !tab.id && structure) {
        await this.tabsRepo.saveImportedMangaStructure(tab, structure.metadata, structure.pagesByAsset);
      } else {
        await this.tabsRepo.saveOrUpdateTabWithPages(tab, this.items().map(item => item.page), { chapter });
      }
      this.clearAll();
      saved = true;
    } catch (error) {
      this.showError('Could not save manga', error);
    } finally {
      this.loading.hide();
      this.isSaving.set(false);
      this.filesProcessing.emit(false);
    }

    if (saved) {
      this.saveFinished.emit();
      void Promise.allSettled([this.tabsService.refresh(), this.storageInfo.refresh()]);
    }
  }

  clearAll() {
    this.rebuildVersion++;
    this.work?.abort();
    void this.discardItems(this.items());
    this.items.set([]);
    this.loadedTabId = undefined;
    this.importedStructure = undefined;
    this.errorMessage.set('');
  }

  private async discardItems(items: readonly ImportItem[]) {
    const draftIds: number[] = [];
    for (const { page, url } of items) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      if (page.draftId !== undefined) draftIds.push(page.draftId);
    }
    try {
      await this.pageRepo.discardImportPages(draftIds);
    } catch (error) {
      console.warn('Could not delete temporary import pages', error);
    }
  }

  private startWork(): AbortController {
    this.work?.abort();
    this.work = new AbortController();
    this.isProcessing.set(true);
    this.progress.set(0);
    this.filesProcessing.emit(true);
    return this.work;
  }

  private finishWork(work: AbortController) {
    if (this.work !== work) return;
    this.work = undefined;
    this.isProcessing.set(false);
    this.filesProcessing.emit(false);
  }

  private async rebuildUrls(tabId: number) {
    this.clearAll();
    const work = this.startWork();
    const items: ImportItem[] = [];
    const chapterId = this.chapterId;
    try {
      const chapter = chapterId === undefined ? undefined : await this.chaptersRepo.get(chapterId);
      if (chapterId !== undefined && chapter?.tabId !== tabId) {
        throw new Error('Chapter not found');
      }
      const ids = await this.pageRepo.getOrderedIds(tabId, chapter);
      for (const id of ids) {
        work.signal.throwIfAborted();
        const page = await this.pageRepo.get(id);
        if (!page || (chapterId !== undefined && page.chapterId !== chapterId)) continue;
        const { src, ...reference } = page;
        let url = '';
        if (src) {
          try {
            const { preview } = await createImagePreview(src, THUMBNAIL_SIZE, work.signal);
            url = this.previewUrl(preview);
          } catch (error) {
            work.signal.throwIfAborted();
            console.warn('Could not preview saved page', id, error);
          }
        }
        items.push({ page: reference, url });
      }
      work.signal.throwIfAborted();
      this.items.set(items);
      this.loadedTabId = tabId;
    } catch (error) {
      await this.discardItems(items);
      if (!work.signal.aborted) this.showError('Could not load saved pages', error);
    } finally {
      this.finishWork(work);
    }
  }

  async onFilesDropped(files: FileList | File[]) {
    if (!files.length || this.disabled || this.isProcessing() || this.isSaving()) return;
    const batch = Array.from(files);
    const totalBytes = batch.reduce((total, file) => total + Math.max(1, file.size), 0);
    const initialItems = this.items();
    const initialStructure = this.importedStructure;
    const allowMetadata = this.enableMangaStructureMetadata && !initialItems.length && batch.length === 1;
    this.importedStructure = undefined;
    this.errorMessage.set('');
    const work = this.startWork();

    try {
      await this.pageRepo.discardExpiredImportPages().catch(error => {
        console.warn('Could not clean expired import pages', error);
      });
      let completedBytes = 0;
      for (const file of batch) {
        work.signal.throwIfAborted();
        const fileBytes = Math.max(1, file.size);
        const reportProgress = (filePercent: number) => {
          const percent = Math.floor((completedBytes * 100 + fileBytes * filePercent) / totalBytes);
          // Keep the batch percentage stable if a file has to retry without its metadata.
          this.progress.update(current => Math.max(current, Math.min(99, percent)));
        };
        await this.processFile(file, allowMetadata, work.signal, reportProgress);
        work.signal.throwIfAborted();
        reportProgress(100);
        completedBytes += fileBytes;
      }
      work.signal.throwIfAborted();
      if (this.items().length === initialItems.length && !this.importedStructure) {
        throw new Error('No supported images found');
      }
      this.progress.set(100);
      this.onDropFinished.emit();
      this.fileSelected.emit(batch[0].name);
    } catch (error) {
      if (!work.signal.aborted) {
        await this.rollbackItems(initialItems);
        if (!work.signal.aborted) {
          this.importedStructure = initialStructure;
          this.showError('Could not import images', error);
        }
      }
    } finally {
      this.finishWork(work);
    }
  }

  private async rollbackItems(initialItems: ImportItem[]) {
    const added = this.items().slice(initialItems.length);
    this.items.set(initialItems);
    await this.discardItems(added);
  }

  private showError(action: string, error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    this.errorMessage.set(action + '. ' + detail);
    console.error(action, error);
  }

  private async processFile(
    file: File,
    allowMetadata: boolean,
    signal: AbortSignal,
    reportProgress: (percent: number) => void
  ) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.zip') || name.endsWith('.cbz')) {
      await this.extractArchive(file, allowMetadata, signal, reportProgress);
    } else if (name.endsWith('.mhtml') || name.endsWith('.mht')) {
      await this.extractMhtml(file, allowMetadata, signal, reportProgress);
    } else if (file.type.startsWith('image/') || imageFormatFromFilename(name)) {
      await this.addBlobImage(file, file.name, signal);
    }
  }

  private generateName(name: string, addition: string): string {
    return name.slice(0, 5) + generateId() + '/' + addition;
  }

  private async extractArchive(
    file: File,
    allowMetadata: boolean,
    signal: AbortSignal,
    reportProgress: (percent: number) => void
  ) {
    const archive = await openArchiveReader(file, signal);
    if (allowMetadata && archive.names.includes(ARCHIVE_METADATA_NAME)) {
      const initialItems = this.items();
      try {
        const bytes = await archive.read(ARCHIVE_METADATA_NAME, { maxBytes: METADATA_MAX_BYTES, signal });
        const metadata = this.readMetadata(new TextDecoder().decode(bytes), new Set(archive.names));
        if (metadata) {
          const entries = metadata.chapters.flatMap(chapter => chapter.pages.map(page => page.asset));
          const pagesByAsset = new Map<string, PageToSave>();
          await this.importArchivePages(file, archive, entries, signal, reportProgress, pagesByAsset);
          this.importedStructure = { metadata, pagesByAsset };
          return;
        }
      } catch (error) {
        signal.throwIfAborted();
        await this.rollbackItems(initialItems);
        if (error instanceof DOMException && error.name === 'QuotaExceededError') throw error;
        console.warn('Could not use archive chapter metadata', error);
      }
    }

    const entries = archive.names.filter(name => imageFormatFromFilename(name)).sort(numericNameSort);
    await this.importArchivePages(file, archive, entries, signal, reportProgress);
  }

  private async importArchivePages(
    file: File,
    archive: ArchiveReader,
    entries: string[],
    signal: AbortSignal,
    reportProgress: (percent: number) => void,
    pagesByAsset?: Map<string, PageToSave>
  ) {
    for (const [index, entry] of entries.entries()) {
      signal.throwIfAborted();
      const bytes = await archive.read(entry, { signal });
      const format = detectImageFormat(bytes) ?? imageFormatFromFilename(entry);
      const item = await this.addBlobImage(
        new Blob([bytes], { type: format?.mimeType }),
        this.generateName(file.name, entry),
        signal
      );
      pagesByAsset?.set(entry, item.page);
      reportProgress((index + 1) * 100 / entries.length);
    }
  }

  private async extractMhtml(
    file: File,
    allowMetadata: boolean,
    signal: AbortSignal,
    reportProgress: (percent: number) => void
  ) {
    const assets = new Map<string, ImportItem>();
    const duplicateIds = new Set<string>();
    let index = 0;
    const { metadataJson } = await this.mhtmlService.extractStreaming(file, async image => {
      const item = await this.addBlobImage(image.blob, this.generateName(file.name, String(index++)), signal);
      const id = image.pageId;
      if (allowMetadata && id && !duplicateIds.has(id)) {
        if (assets.has(id)) {
          assets.delete(id);
          duplicateIds.add(id);
        } else {
          assets.set(id, item);
        }
      }
      reportProgress(this.mhtmlService.progress());
    }, signal);

    if (!allowMetadata || !metadataJson) return;
    const metadata = this.readMetadata(metadataJson, new Set(assets.keys()));
    if (!metadata) return;

    const ordered = metadata.chapters.flatMap(chapter => chapter.pages.map(({ asset }) => assets.get(asset)!));
    if (!ordered.length && this.items().length) return;
    const retained = new Set(ordered);
    const extras = this.items().filter(item => !retained.has(item));
    this.items.set(ordered);
    this.importedStructure = {
      metadata,
      pagesByAsset: new Map([...assets].filter(([, item]) => retained.has(item)).map(([asset, item]) => [asset, item.page]))
    };
    await this.discardItems(extras);
  }

  private readMetadata(json: string, availableAssets: ReadonlySet<string>): ChaptersMangaStructureMetadata | undefined {
    if (json.length > METADATA_MAX_BYTES) return undefined;
    try {
      const { metadata, error } = parseMangaStructureMetadata(JSON.parse(json), availableAssets);
      if (metadata?.mode === ViewMod.Chapters) return metadata;
      if (error) console.warn('Could not use chapter metadata', error);
    } catch (error) {
      console.warn('Could not read chapter metadata', error);
    }
    return undefined;
  }

  private async addBlobImage(blob: Blob, name: string, signal: AbortSignal): Promise<ImportItem> {
    const { preview, width, height } = await createImagePreview(blob, THUMBNAIL_SIZE, signal);
    const src = isIOS ? await blobToDataURL(blob, signal) : blob;
    signal.throwIfAborted();
    const draftId = await this.pageRepo.stageImportPage(src);
    const item = { page: { draftId, name, tabId: 0, width, height }, url: '' };
    try {
      signal.throwIfAborted();
      item.url = this.previewUrl(preview);
      this.items.update(items => [...items, item]);
    } catch (error) {
      await this.discardItems([item]);
      throw error;
    }
    await sleepIfNeeded();
    signal.throwIfAborted();
    return item;
  }

  private previewUrl(preview: Blob | string): string {
    return typeof preview === 'string' ? preview : URL.createObjectURL(preview);
  }

  remove(index: number) {
    if (this.isProcessing() || this.isSaving()) return;
    const item = this.items()[index];
    if (!item) return;
    this.importedStructure = undefined;
    this.items.update(items => items.filter((_, i) => i !== index));
    void this.discardItems([item]);
  }

  drop(event: CdkDragDrop<ImportItem[]>) {
    if (this.isProcessing() || this.isSaving() || event.previousIndex === event.currentIndex) return;
    this.importedStructure = undefined;
    const items = [...this.items()];
    moveItemInArray(items, event.previousIndex, event.currentIndex);
    this.items.set(items);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    const files = event.dataTransfer?.files;
    if (files?.length) void this.onFilesDropped(files);
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
  }

  onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      const files = Array.from(input.files);
      input.value = '';
      void this.onFilesDropped(files);
    }
  }
}
