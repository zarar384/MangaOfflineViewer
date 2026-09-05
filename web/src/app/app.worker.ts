/// <reference lib="webworker" />

/**
 * MHTML parsing worker.
 *
 * Runs the incremental MHTML scanner (see shared/utils/mhtml-stream-scanner.ts) off the main
 * thread. The File object is posted here directly (a cheap structured-clone, not a full-file
 * copy) and read incrementally via File.slice()/arrayBuffer() - this worker never holds the
 * whole file, the whole decoded document, or the whole set of images in memory at once. Each
 * decoded image is posted back to the main thread as soon as it's found, as its own small
 * message, instead of being accumulated and sent as one giant payload at the end.
 *
 * This worker previously also supported uploading the file to an optional local helper server
 * (server/server.js) for parsing. That path never actually solved the memory problem (the
 * server fully buffered and parsed the file too, returning one big JSON response) and doesn't
 * run on iOS Safari anyway, so it has been removed in favor of this local streaming scanner,
 * which is now used unconditionally.
 */
import { scanMhtmlFile } from './shared/utils/mhtml-stream-scanner';

interface ProcessLocalMessage {
  type: 'processLocal';
  id: string;
  file: File;
}

type IncomingMessage = ProcessLocalMessage;

self.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const data = event.data;

  if (data.type === 'processLocal') {
    const { id, file } = data;

    try {
      await scanMhtmlFile(
        file,
        (img) => {
          postMessage({ type: 'image', id, pageId: img.pageId, blob: img.blob });
        },
        (json) => {
          postMessage({ type: 'metadata', id, json });
        },
        (progress) => {
          postMessage({ type: 'progress', id, progress });
        }
      );

      postMessage({ type: 'result', id });
    } catch (err: any) {
      postMessage({ type: 'error', id, error: err?.message ?? 'Local MHTML parse failed' });
    }
  }
};
