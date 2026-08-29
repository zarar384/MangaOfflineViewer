import { Injectable, signal } from '@angular/core';
import { isIOS } from '../../shared/utils/constants';
import { decodeQuotedPrintable, parseHTMLForImages } from '../../shared/utils/file-parsing';
import { MangaStructureMetadata } from '../../shared/models/manga-structure-metadata';
import { parseMangaStructureMetadata } from 'src/app/shared/utils/manga-structure-metadata';

export type MhtmlImportData = {
  images: string[];
  metadata?: MangaStructureMetadata;
  assets?: Map<string, string>;
};

@Injectable({ providedIn: 'root' })
export class MhtmlExtractorService {
  private worker: Worker | null = null;

  private progressSignal = signal<number>(0);
  readonly progress = this.progressSignal.asReadonly();

  constructor() {
    try {
      this.worker = new Worker(
        new URL('../../app.worker', import.meta.url),
        { type: 'module' }
      );

      this.worker.postMessage({
        type: 'init',
        host: 'localhost',
        port: 3000
      });
    } catch {
      this.worker = null;
    }
  }

  // extract images from MHTML file (using worker if available)
  public async extractImagesFromMhtml(file: File): Promise<string[]> {
    this.progressSignal.set(0);
    const arrayBuffer = await file.arrayBuffer();

    if (this.worker) {
      return await this.extractWithWorker(arrayBuffer);
    }

    return await this.extractWithoutWorker(arrayBuffer);
  }

  public async extractImportData(file: File): Promise<MhtmlImportData> {
    const arrayBuffer = await file.arrayBuffer();
    const decoded = decodeQuotedPrintable(new TextDecoder().decode(arrayBuffer));
    const document = new DOMParser().parseFromString(decoded, 'text/html');
    const metadataElement = document.querySelector('#molv-manga-structure[type="application/json"]');

    if (metadataElement?.textContent) {
      try {
        const assets = new Map<string, string>();
        for (const container of Array.from(document.querySelectorAll<HTMLElement>('div[id^="page-"]'))) {
          const src = container.querySelector<HTMLImageElement>('img')?.getAttribute('src');
          if (src) assets.set(container.id, src);
        }

        const result = parseMangaStructureMetadata(JSON.parse(metadataElement.textContent), new Set(assets.keys()));
        if (result.metadata) return { images: [], metadata: result.metadata, assets };
        console.warn('Ignoring invalid MHTML manga structure metadata:', result.error);
      } catch (error) {
        console.warn('Ignoring unreadable MHTML manga structure metadata:', error);
      }
    }

    return { images: await this.extractImagesFromMhtml(file) };
  }

  // worker-based extraction
  private extractWithWorker(arrayBuffer: ArrayBuffer): Promise<string[]> {
    const arrayBufferCopy = arrayBuffer.slice(0); //fallback

    return new Promise((resolve, reject) => {
      const allImages: string[] = [];

      this.worker!.onmessage = async (e: MessageEvent) => {
        const msg = e.data;

        if (msg.type === 'serverOff') {
          console.warn('SERVER OFF — fallback to JS parser');
          this.worker!.postMessage(
            {
              type: 'processLocal',
              id: msg.id,
              file: arrayBufferCopy
            },
            [arrayBufferCopy]
          );
          return;
        }

        if (msg.type === 'progress') {
          this.progressSignal.set(msg.progress);
        }

        if (msg.type === 'html') {
          const images = parseHTMLForImages(msg.html);
          allImages.push(...images);
          return;
        }

        if (msg.type === 'images') {
          allImages.push(...msg.images);
          await this.sleepIfIOS();
        }

        if (msg.type === 'result') {
          this.progressSignal.set(85);
          resolve(allImages);
        }

        if (msg.type === 'error') {
          reject(new Error(msg.error));
        }
      };

      // отправляем в воркер
      this.worker!.postMessage(
        {
          id: crypto.randomUUID(),
          file: arrayBuffer,
          type: 'processFile'
        },
        [arrayBuffer] // transfer ownership
      );
    });
  }

  // fallback without worker
  private async extractWithoutWorker(arrayBuffer: ArrayBuffer): Promise<string[]> {
    try {
      const text = new TextDecoder().decode(arrayBuffer);
      const decoded = decodeQuotedPrintable(text);
      const imgs = parseHTMLForImages(decoded);

      this.progressSignal.set(85);
      return imgs;
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  // for iOS devices, we need to wait a bit to avoid issues with Blob URLs
  private sleepIfIOS(): Promise<void> {
    return new Promise(resolve => {
      if (isIOS) {
        setTimeout(resolve, 0);
      } else {
        resolve();
      }
    });
  }
}
