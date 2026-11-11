/// <reference lib="webworker" />

import type { MhtmlWorkerRequest, MhtmlWorkerResponse } from './shared/models/mhtml-worker-message';
import { scanMhtmlFile } from './shared/utils/mhtml-stream-scanner';

let started = false;
let acknowledgeImage: (() => void) | undefined;

function reportFailure(error: unknown): void {
  postMessage({
    type: 'error',
    message: error instanceof Error ? error.message : 'Local MHTML parse failed'
  } satisfies MhtmlWorkerResponse);
}

self.onmessage = ({ data }: MessageEvent<MhtmlWorkerRequest>) => {
  if (data.type === 'ackImage') {
    acknowledgeImage?.();
    acknowledgeImage = undefined;
    return;
  }

  if (started) return;
  started = true;

  void scanMhtmlFile(
    data.file,
    image => new Promise<void>(resolve => {
      // The scanner waits for the consumer before decoding the next image.
      acknowledgeImage = resolve;
      try {
        postMessage({ type: 'image', image } satisfies MhtmlWorkerResponse);
      } catch (error) {
        // The scanner normally skips a callback error. A transport failure must stop the run.
        reportFailure(error);
        self.close();
      }
    }),
    json => postMessage({ type: 'metadata', json } satisfies MhtmlWorkerResponse),
    progress => postMessage({ type: 'progress', progress } satisfies MhtmlWorkerResponse)
  ).then(
    () => postMessage({ type: 'result' } satisfies MhtmlWorkerResponse),
    reportFailure
  );
};
