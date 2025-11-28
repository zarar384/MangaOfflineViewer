import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { decodeQuotedPrintable, parseHTMLForImages } from 'src/app/shared/utils/file-parsing';

@Injectable({ providedIn: 'root' })
export class MhtmlExtractorService {
  private worker: Worker | null = null;

  public progress$ = new BehaviorSubject<number>(0);

  constructor() {
    try {
      this.worker = new Worker(
        new URL('../../app.worker', import.meta.url),
        { type: 'module' }
      );
    } catch {
      this.worker = null;
    }
  }

  // extract images from MHTML file (using worker if available)
  public async extractImagesFromMhtml(file: File): Promise<string[]> {
    this.progress$.next(0);
    const arrayBuffer = await file.arrayBuffer();

    if (this.worker) {
      return await this.extractWithWorker(arrayBuffer);
    }

    return await this.extractWithoutWorker(arrayBuffer);
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
          resolve(await this.extractWithoutWorker(arrayBufferCopy));
          return;
        }

        if (msg.type === 'progress') {
          this.progress$.next(msg.progress);
        }

        if (msg.type === 'images') {
          allImages.push(...msg.images);
          await this.sleepIfIOS();
        }

        if (msg.type === 'result') {
          this.progress$.next(85);
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

      this.progress$.next(85);
      return imgs;
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  // for iOS devices, we need to wait a bit to avoid issues with Blob URLs
  private sleepIfIOS(): Promise<void> {
    return new Promise(resolve => {
      if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
        setTimeout(resolve, 0);
      } else {
        resolve();
      }
    });
  }
}
