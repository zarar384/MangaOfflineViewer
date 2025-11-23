import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { IndexedDbService } from 'src/app/core/database/indexeddb.service';
import { DomSanitizer } from '@angular/platform-browser';
import * as JSZip from 'jszip';
import { decodeQuotedPrintable, generateId, numericNameSort, parseHTMLForImages, sleepIfNeeded } from '../../utils/file-parsing';

@Component({
  selector: 'drop-uploader',
  imports: [CommonModule, DragDropModule],
  templateUrl: './drop-uploader.components.html',
  styleUrl: './drop-uploader.components.css',
})
export class DropUploaderComponents implements OnChanges {
  @Input() visible = true;
  @Output() onFinished = new EventEmitter<void>();

  filesProcessing = false;
  progress = 0;
  thumbnails: { id: string; src: string; name?: string }[] = [];
  // TODO saved as Blobs:
  // items: { id:string; blob: Blob; name?:string }[] = [];

  constructor(private db: IndexedDbService, private sanitizer: DomSanitizer) { }
  ngOnChanges(changes: SimpleChanges) {
    if ('visible' in changes && !this.visible) {
      this.clearAll();
    }
  }

  clearAll() {
    this.thumbnails = [];
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
      this.onFinished.emit();
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
    const url = URL.createObjectURL(blob);
    this.thumbnails.push({ id: generateId(), src: url, name });
  }

  private async addDataUrl(dataUrl: string) {
    this.thumbnails.push({ id: generateId(), src: dataUrl });
  }

  remove(index: number) {
    const it = this.thumbnails[index];
    if (it?.src?.startsWith('blob:')) URL.revokeObjectURL(it.src);
    this.thumbnails.splice(index, 1);
  }

  drop(event: CdkDragDrop<any[]>) {
    moveItemInArray(this.thumbnails, event.previousIndex, event.currentIndex);
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
