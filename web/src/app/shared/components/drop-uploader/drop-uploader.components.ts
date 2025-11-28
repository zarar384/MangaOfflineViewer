import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { DomSanitizer } from '@angular/platform-browser';
import * as JSZip from 'jszip';
import { decodeQuotedPrintable, generateId, numericNameSort, parseHTMLForImages, sleepIfNeeded } from '../../utils/file-parsing';
import { Tab } from 'src/app/core/models/tab.model';
import { TabsRepository } from 'src/app/core/repositories/tabs.repository';
import { Page } from 'src/app/core/models/page.model';
import { ObjectUrlService } from 'src/app/core/services/object-url.service';

@Component({
  selector: 'drop-uploader',
  imports: [CommonModule, DragDropModule],
  templateUrl: './drop-uploader.components.html',
  styleUrl: './drop-uploader.components.css',
})
export class DropUploaderComponents {
  @Input() visible = true;
  @Output() onDropFinished = new EventEmitter<void>();
  @Output() fileSelected = new EventEmitter<string>();

  filesProcessing = false;
  progress = 0;
  pages:Page[] = [];
  urls:{name?:string; src: string}[] = [];
  // TODO saved as Blobs:
  // items: { id:string; blob: Blob; name?:string }[] = [];

  constructor(private tabsRepo: TabsRepository, private urlService: ObjectUrlService) { }

  saveAll(tab: Tab) {
    this.tabsRepo.saveOrUpdateTabWithPages(tab, this.pages).then(() => {
      console.log('DropUploaderComponents.saveAll - saved', tab, this.pages);
    }).catch(err => {
      console.error('DropUploaderComponents.saveAll - error saving', err);
    });
  }

  clearAll() {
    this.pages = [];
    console.log('DropUploaderComponents.clearAll - parent window closed');
  }

  async onFilesDropped(files: FileList | File[]) {
    if (this.filesProcessing) return;
    this.filesProcessing = true;
    this.progress = 0;

    try {
      for (const f of Array.from(files)) {
        await this.processFile(f);
      }
      this.onDropFinished.emit();
      this.fileSelected.emit(files[0]?.name);
    } catch (err) {
      console.error('Upload error', err);
    } finally {
      this.filesProcessing = false;
      this.progress = 100;
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
    } else {
      console.warn('Unsupported file', file.name);
    }
  }

  private isImageFile(f: File) {
    return f.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp)$/i.test(f.name);
  }

  // ZIP
  private async extractZip(file: File) {
    const zip = await JSZip.loadAsync(file);
    // filter images only
    const entries = Object.keys(zip.files)
      .filter(k => !zip.files[k].dir && /\.(jpe?g|png|gif|webp|bmp)$/i.test(k))
      .sort((a, b) => numericNameSort(a, b));
    // read in batches
    for (const entryName of entries) {
      const entry = zip.files[entryName];
      const blob = await entry.async('blob');
      await this.addBlobImage(blob, entryName);

      this.progress = Math.min(90, this.progress + 1);
      await sleepIfNeeded();
    }
  }

  // MHTML
  private async extractMhtml(file: File) {
    const arrayBuffer = await file.arrayBuffer();
    const text = new TextDecoder().decode(arrayBuffer);
    const decoded = decodeQuotedPrintable(text);
    const imgs = parseHTMLForImages(decoded);

    // add images
    for (const src of imgs) {
      const blob = await fetch(src).then(r => r.blob());
      await this.addBlobImage(blob, `mhtml-${generateId()}`);
      this.progress = Math.min(90, this.progress + 1);
      await sleepIfNeeded();
    }
  }

  // File image
  private async addImageFile(file: File) {
    await this.addBlobImage(file, file.name);
  }

  private async addBlobImage(blob: Blob, name?: string) {
    const url = this.urlService.createUrl(name!, blob);
    this.pages.push({
      src: blob, name,
      tab: 0
    });
    this.urls.push({
      src: url, name,
    });
  }

  remove(index: number) {
    const it = this.pages[index];
    const itUrl = this.urls[index];
    if (itUrl?.src?.startsWith('blob:')) URL.revokeObjectURL(itUrl.src);
    this.pages.splice(index, 1);
    this.urls.splice(index, 1);
  }

  drop(event: CdkDragDrop<any[]>) {
    moveItemInArray(this.pages, event.previousIndex, event.currentIndex);
  }

  // Drop handling
  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.onFilesDropped(files);
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
  }

  onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.onFilesDropped(input.files);
    }
  }
}
