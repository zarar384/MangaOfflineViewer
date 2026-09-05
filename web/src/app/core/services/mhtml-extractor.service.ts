import { Injectable, signal } from '@angular/core';
import { scanMhtmlFile, MhtmlScannedImage } from '../../shared/utils/mhtml-stream-scanner';

export type MhtmlImageHandler = (image: MhtmlScannedImage) => Promise<void> | void;

export type MhtmlExtractResult = {
  metadataJson?: string;
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
    } catch {
      this.worker = null;
    }
  }

  /**
   * Streams every image found in the MHTML file to onImage as soon as it is decoded (in document
   * order), and resolves with the manga-structure metadata JSON text if one was found. Never
   * materializes the whole document, the whole set of images, or a whole image's base64 text as
   * one string - memory stays O(chunk size + current image) for the duration of the scan.
   */
  public async extractStreaming(file: File, onImage: MhtmlImageHandler): Promise<MhtmlExtractResult> {
    this.progressSignal.set(0);

    if (this.worker) {
      try {
        return await this.extractWithWorker(file, onImage);
      } catch (error) {
        console.warn('Worker-based MHTML extraction failed, falling back to main thread:', error);
      }
    }

    return await this.extractOnMainThread(file, onImage);
  }

  private async extractOnMainThread(file: File, onImage: MhtmlImageHandler): Promise<MhtmlExtractResult> {
    let metadataJson: string | undefined;

    await scanMhtmlFile(
      file,
      onImage,
      json => { metadataJson = json; },
      progress => this.progressSignal.set(progress)
    );

    return { metadataJson };
  }

  // Runs the same scanner off the main thread. The File object itself is posted to the worker
  // (a cheap structured-clone, not a full-file copy); the worker streams back one small message
  // per image instead of accumulating results and posting one giant payload at the end.
  private extractWithWorker(file: File, onImage: MhtmlImageHandler): Promise<MhtmlExtractResult> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      let metadataJson: string | undefined;
      let pending: Promise<void> = Promise.resolve();

      this.worker!.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.id !== id) return;

        if (msg.type === 'progress') {
          this.progressSignal.set(msg.progress);
        }

        if (msg.type === 'image') {
          // Chain onto `pending` so images are handed to the caller strictly in the order they
          // were found, one at a time (mirrors the backpressure the main-thread path gets for
          // free from awaiting each callback before reading the next chunk).
          pending = pending.then(() => onImage({ pageId: msg.pageId, blob: msg.blob }));
        }

        if (msg.type === 'metadata') {
          metadataJson = msg.json;
        }

        if (msg.type === 'result') {
          pending.then(() => resolve({ metadataJson })).catch(reject);
        }

        if (msg.type === 'error') {
          reject(new Error(msg.error));
        }
      };

      this.worker!.postMessage({ type: 'processLocal', id, file });
    });
  }
}
