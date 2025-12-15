/// <reference lib="webworker" />

interface InitMessage {
  type: 'init';
  host: string;
  port: number;
}

interface ProcessFileMessage {
  type: 'processFile';
  id: string;
  file: ArrayBuffer;
}

interface ProcessLocalMessage {
  type: 'processLocal';
  id: string;
  file: ArrayBuffer;
}

type IncomingMessage = InitMessage | ProcessFileMessage | ProcessLocalMessage;

interface ProgressMessage {
  type: 'progress';
  id: string;
  progress: number;
}

interface ServerOffMessage {
  type: 'serverOff';
  id: string;
  file?: ArrayBuffer;
}

interface ErrorMessage {
  type: 'error';
  id: string;
  error: string;
}

interface ImagesMessage {
  type: 'images';
  id: string;
  images: string[];
}

interface ResultMessage {
  type: 'result';
  id: string;
}

type OutgoingMessage =
  | ProgressMessage
  | ServerOffMessage
  | ErrorMessage
  | ImagesMessage
  | ResultMessage;

let baseUrl = '';
const IMAGE_QUOTED_REGEX =
  /"data:image\/(jpg|jpeg|png|gif|bmp|webp);base64,[^"]+"/gi;

self.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const data = event.data;

  if (data.type === 'init') {
    baseUrl = `http://${data.host}:${data.port}`;
    return;
  }

  if (data.type === 'processLocal') {
    await processFileLocal(data.id, data.file);
    return;
  }

  if (data.type === 'processFile') {
    const { id, file } = data;

    // check if server is available 
    try {
      const ping = await fetch(`${baseUrl}/ping`);
      if (!ping.ok) {
        postMessage({ type: 'serverOff', id, file });
        return;
      }
    } catch {
      postMessage({ type: 'serverOff', id, file });
      return;
    }

    // upload file in chunks
    const uint8 = new Uint8Array(file);
    const chunkSize = 5 * 1024 * 1024;
    const totalChunks = Math.ceil(uint8.length / chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;

      const end = Math.min(start + chunkSize, uint8.length);

      const chunk = uint8.slice(start, end);

      try {
        await fetch(`${baseUrl}/upload-chunk`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',

            'X-Chunk-Index': i as any,
            'X-Total-Chunks': totalChunks as any,
            'X-File-Id': id
          },
          body: chunk
        });
      } catch (err: any) {
        postMessage({
          type: 'error',
          id,
          error: err?.message ?? 'Upload failed'
        });
        return;
      }

      postMessage({
        type: 'progress',
        id,
        progress: ((i + 1) / totalChunks) * 80
      });
    }

    // merge chunks
    const mergeResponse = await fetch(`${baseUrl}/merge-chunks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: id })
    });

    if (!mergeResponse.ok) {
      postMessage({
        type: 'error',
        id,
        error: `Merge failed: ${mergeResponse.status}`
      });
      return;
    }

    postMessage({ type: 'progress', id, progress: 81 });

    // stream response and extract images
    const reader = mergeResponse.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let images: string[] = [];
    let chunkIndex = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunkIndex++;
      buffer += decoder.decode(value, { stream: true });

      const matches = buffer.match(IMAGE_QUOTED_REGEX);
      if (matches) {
        images.push(...matches.map(s => s.slice(1, -1)));

        while (images.length >= 5) {
          const batch = images.splice(0, 5);

          postMessage({ type: 'images', id, images: batch });
          postMessage({
            type: 'progress',
            id,
            progress: 81 + Math.min(9, chunkIndex * 0.2)
          });
        }

        const lastMatch = matches[matches.length - 1];
        const lastIndex =
          buffer.lastIndexOf(lastMatch) + lastMatch.length;
        buffer = buffer.slice(lastIndex);
      }
    }

    // send any remaining images
    if (images.length > 0) {
      postMessage({ type: 'images', id, images });
    }

    postMessage({ type: 'result', id });
  }
};
async function processFileLocal(id: string, file: ArrayBuffer) {
  try {
    const { READ_CHUNK } = chooseLocalChunkSize();

    const uint8 = new Uint8Array(file);
    const decoder = new TextDecoder("utf-8");

    const parts: string[] = []; // store chunks separately

    for (let pos = 0; pos < uint8.length; pos += READ_CHUNK) {
      const end = Math.min(pos + READ_CHUNK, uint8.length);

      parts.push(
        decoder.decode(uint8.subarray(pos, end), { stream: true })
      );

      postMessage({
        type: "progress",
        id,
        progress: Math.min(80, (pos / uint8.length) * 80)
      });
    }

    // join once 
    const raw = parts.join("");

    // decode whole mhtml
    const decoded = decodeQuotedPrintable(raw);

    postMessage({
      type: "html",
      id,
      html: decoded
    });

    postMessage({ type: "result", id });

  } catch (err: any) {
    postMessage({
      type: "error",
      id,
      error: err?.message ?? "Local parse failed"
    });
  }
}

// HELPERS
function decodeQuotedPrintable(input: string): string {
  if (!input) return input;

  // delete "soft line breaks" =\r\n or =\n
  let s = input.replace(/=\r?\n/g, '');

  s = s.replace(/=([0-9A-F]{2})/gi, (_, hex) => {
    try {
      return String.fromCharCode(parseInt(hex, 16));
    } catch {
      return '';
    }
  });

  return s;
}

function chooseLocalChunkSize() {
  const mem = (navigator as any).deviceMemory || 4; // GB
  // const cores = navigator.hardwareConcurrency || 2;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (isIOS) return { READ_CHUNK: 100 * 1024, KEEP_TAIL: 3000 };

  if (isMobile) {
    if (mem <= 2) return { READ_CHUNK: 100 * 1024, KEEP_TAIL: 2500 };
    if (mem <= 4) return { READ_CHUNK: 150 * 1024, KEEP_TAIL: 2000 };
    return { READ_CHUNK: 200 * 1024, KEEP_TAIL: 2000 };
  }

  // desktop
  if (mem >= 16) return { READ_CHUNK: 1 * 1024 * 1024, KEEP_TAIL: 1500 };
  if (mem >= 8) return { READ_CHUNK: 600 * 1024, KEEP_TAIL: 2000 };

  //weak PC with 4GB or less
  return { READ_CHUNK: 300 * 1024, KEEP_TAIL: 2500 };
}
