let HOST, PORT;

self.onmessage = async function (e) {
    const { id, file, type } = e.data;

    if (type === 'init') {
        HOST = e.data.host;
        PORT = e.data.port;
    }

    if (type === 'processFile') {
        const uint8 = new Uint8Array(file);

        const chunkSize = 5 * 1024 * 1024; // 5MB
        const totalChunks = Math.ceil(uint8.length / chunkSize);

        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, uint8.length);
            const chunk = uint8.slice(start, end);

            try {
                await fetch(`https://${HOST}:${PORT}/upload-chunk`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/octet-stream',
                        'X-Chunk-Index': i,
                        'X-Total-Chunks': totalChunks,
                        'X-File-Id': id
                    },
                    body: chunk
                });
            } catch (err) {
                self.postMessage({ type: 'error', id, error: err.message });
                return;
            }

            self.postMessage({ type: 'progress', id, progress: ((i + 1) / totalChunks) * 100 });
        }

        // собрать файл после всех чанков
        const mergeResp = await fetch(`https://${HOST}:${PORT}/merge-chunks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId: id })
        });

        if (!mergeResp.ok) throw new Error(`Server returned ${mergeResp.status}`);

        const result = await mergeResp.json();

        self.postMessage({ type: 'result', id, images: result.images });
    }
};
