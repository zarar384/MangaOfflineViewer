import { Injectable, signal } from '@angular/core';
import type { MhtmlWorkerRequest, MhtmlWorkerResponse } from '../../shared/models/mhtml-worker-message';
import { scanMhtmlFile, MhtmlScannedImage } from '../../shared/utils/mhtml-stream-scanner';

export type MhtmlImageHandler = (image: MhtmlScannedImage) => Promise<void> | void;

export type MhtmlExtractResult = {
  metadataJson?: string;
};

const WORKER_IDLE_TIMEOUT_MS = 60_000;

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('MHTML import cancelled', 'AbortError');
}

@Injectable({ providedIn: 'root' })
export class MhtmlExtractorService {
  private extracting = false;
  private progressSignal = signal<number>(0);
  readonly progress = this.progressSignal.asReadonly();

  async extractStreaming(file: File, onImage: MhtmlImageHandler, signal?: AbortSignal): Promise<MhtmlExtractResult> {
    if (signal?.aborted) throw abortReason(signal);
    if (this.extracting) throw new Error('Another MHTML import is already running');
    this.extracting = true;
    this.progressSignal.set(0);

    try {
      if (typeof Worker !== 'undefined') {
        let consumerStarted = false;
        try {
          return await this.extractWithWorker(file, image => {
            consumerStarted = true;
            return onImage(image);
          }, signal);
        } catch (error) {
          // Replaying after a callback started can duplicate pages or overlap its writes.
          if (consumerStarted || signal?.aborted) throw error;
          console.warn('Worker-based MHTML extraction failed, falling back to main thread:', error);
          this.progressSignal.set(0);
        }
      }

      return await this.extractOnMainThread(file, onImage, signal);
    } finally {
      this.extracting = false;
    }
  }

  private async extractOnMainThread(file: File, onImage: MhtmlImageHandler, signal?: AbortSignal): Promise<MhtmlExtractResult> {
    let metadataJson: string | undefined;
    let consumerFailure: { error: unknown } | undefined;
    const checkFailure = () => {
      if (signal?.aborted) throw abortReason(signal);
      if (consumerFailure) throw consumerFailure.error;
    };

    await scanMhtmlFile(
      file,
      async image => {
        // The scanner normally skips a callback failure. Prevent further writes and report
        // the failure in its progress callback, which runs after processing the current slice.
        if (signal?.aborted || consumerFailure) return;
        try {
          await onImage(image);
        } catch (error) {
          consumerFailure = { error };
        }
      },
      json => { metadataJson = json; },
      progress => {
        checkFailure();
        this.progressSignal.set(progress);
      }
    );

    checkFailure();
    return { metadataJson };
  }

  private extractWithWorker(file: File, onImage: MhtmlImageHandler, signal?: AbortSignal): Promise<MhtmlExtractResult> {
    const worker = new Worker(new URL('../../app.worker', import.meta.url), { type: 'module' });

    return new Promise((resolve, reject) => {
      let metadataJson: string | undefined;
      let stopped = false;
      let delivery: Promise<void> | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        stopped = true;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
      };

      const fail = (error: unknown) => {
        if (stopped) return;
        cleanup();
        // Let an already-started write settle before the caller rolls back the import.
        if (delivery) void delivery.then(() => reject(error), () => reject(error));
        else reject(error);
      };

      const onAbort = () => fail(abortReason(signal!));
      const resetTimeout = () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fail(new Error('MHTML worker stopped responding')), WORKER_IDLE_TIMEOUT_MS);
      };

      worker.onmessage = ({ data }: MessageEvent<MhtmlWorkerResponse>) => {
        if (stopped) return;

        switch (data.type) {
          case 'image': {
            // The worker is waiting for us. Do not count consumer time as worker inactivity.
            clearTimeout(timeout);
            delivery = Promise.resolve().then(() => {
              if (!stopped) return onImage(data.image);
            });
            void delivery.then(() => {
              delivery = undefined;
              if (stopped) return;
              try {
                worker.postMessage({ type: 'ackImage' } satisfies MhtmlWorkerRequest);
                resetTimeout();
              } catch (error) {
                fail(error);
              }
            }, error => {
              delivery = undefined;
              fail(error);
            });
            break;
          }
          case 'progress':
            resetTimeout();
            this.progressSignal.set(data.progress);
            break;
          case 'metadata':
            resetTimeout();
            metadataJson = data.json;
            break;
          case 'result':
            cleanup();
            resolve({ metadataJson });
            break;
          case 'error':
            fail(new Error(data.message));
            break;
        }
      };

      worker.onerror = event => {
        event.preventDefault();
        fail(new Error(event.message || 'MHTML worker failed'));
      };
      worker.onmessageerror = () => fail(new Error('Could not read MHTML worker response'));
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }

      try {
        worker.postMessage({ type: 'processLocal', file } satisfies MhtmlWorkerRequest);
        resetTimeout();
      } catch (error) {
        fail(error);
      }
    });
  }
}
