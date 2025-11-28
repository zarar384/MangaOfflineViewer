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

type IncomingMessage = InitMessage | ProcessFileMessage;

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

self.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const data = event.data;

  if (data.type === 'init') {
    baseUrl = `http://${data.host}:${data.port}`;
    return;
  }

  if (data.type === 'processFile') {
    const { id, file } = data;

    // check if server is available 
    try {
      const ping = await fetch(`${baseUrl}/ping`, { method: 'GET' });
      if (!ping.ok) {
        postMessage({ type: 'serverOff', id, file } satisfies OutgoingMessage);
        return;
      }
    } catch {
      postMessage({ type: 'serverOff', id, file } satisfies OutgoingMessage);
      return;
    }

   
    // upload file in chunks
    const uint8 = new Uint8Array(file);
    const chunkSize = 5 * 1024 * 1024;
    const totalChunks = Math.ceil(uint8.length / chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.max(start + chunkSize, uint8.length);
      const chunk = uint8.slice(start, end);

      try {
        await fetch(`${baseUrl}/upload-chunk`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Chunk-Index': i.toString(),
            'X-Total-Chunks': totalChunks.toString(),
            'X-File-Id': id
          },
          body: chunk
        });
      } catch (err: any) {
        postMessage({
          type: 'error',
          id,
          error: err?.message ?? 'Unknown upload error'
        } satisfies OutgoingMessage);
        return;
      }

      postMessage({
        type: 'progress',
        id,
        progress: ((i + 1) / totalChunks) * 80
      } satisfies OutgoingMessage);
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
      } satisfies OutgoingMessage);
      return;
    }

    postMessage({
      type: 'progress',
      id,
      progress: 81
    } satisfies OutgoingMessage);

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

      const matches = buffer.match(
        /"data:image\/(jpg|jpeg|png|gif|bmp|webp);base64,[^"]+"/gi
      );

      if (matches) {
        images.push(...matches.map(s => s.slice(1, -1)));

        while (images.length >= 5) {
          const batch = images.splice(0, 5);

          postMessage({
            type: 'images',
            id,
            images: batch
          } satisfies OutgoingMessage);

          postMessage({
            type: 'progress',
            id,
            progress: 81 + Math.min(9, chunkIndex * 0.2)
          } satisfies OutgoingMessage);
        }

        const lastMatch = matches[matches.length - 1];
        const lastIndex = buffer.lastIndexOf(lastMatch) + lastMatch.length;
        buffer = buffer.slice(lastIndex);
      }
    }

    // send any remaining images
    if (images.length > 0) {
      postMessage({
        type: 'images',
        id,
        images
      } satisfies OutgoingMessage);
    }

    postMessage({
      type: 'result',
      id
    } satisfies OutgoingMessage);
  }
};
