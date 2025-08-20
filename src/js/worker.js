let HOST, PORT, BASE_URL;

self.onmessage = async function (e) {
    const { id, file, type } = e.data;

    if (type === 'init') {
        HOST = e.data.host;
        PORT = e.data.port;
        BASE_URL = `http://${HOST}:${PORT}`;
    }

    if (type === 'processFile') {
        try {
            const resp = await fetch(`${BASE_URL}/ping`, { method: "GET" });
            if (!resp.ok) {
                self.postMessage({ type: 'serverOff', id, file });
                return;
            }
        } catch (err) {
            self.postMessage({ type: 'serverOff', id, file });
            return;
        }

        const uint8 = new Uint8Array(file);

        const chunkSize = 5 * 1024 * 1024; // 5MB
        const totalChunks = Math.ceil(uint8.length / chunkSize);

        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, uint8.length);
            const chunk = uint8.slice(start, end);

            try {
                await fetch(`${BASE_URL}/upload-chunk`, {
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

            self.postMessage({ type: 'progress', id, progress: ((i + 1) / totalChunks) * 80 });
        }

        // собрать файл после всех чанков
        const mergeResp = await fetch(`${BASE_URL}/merge-chunks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId: id })
        });

        if (!mergeResp.ok) throw new Error(`Server returned ${mergeResp.status}`);
        self.postMessage({ type: 'progress', id, progress: 81 });

        const reader = mergeResp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let images = [];
        let chunkIndex = 0;

        while (true) {
            const { done, value } = await reader.read(); // браузер сам задает размер чанка (value.length)

            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            chunkIndex++;

            // Base64 строки изображений в буфере
            const matches = buffer.match(/"data:image\/png;base64,[^"]+"/g);
            if (matches) {
                images.push(...matches.map(s => s.slice(1, -1))); // убрать кавычки

                // по 5
                while (images.length >= 5) {
                    const batch = images.splice(0, 5);
                    self.postMessage({ type: 'images', id, images: batch });
                    self.postMessage({ type: 'progress', id, progress: 81 + Math.min(9, chunkIndex * 0.2) });
                }

                // обрезать буфер до последнего найденного совпадения
                const lastMatch = matches[matches.length - 1];
                const lastIndex = buffer.lastIndexOf(lastMatch) + lastMatch.length;
                buffer = buffer.slice(lastIndex);
            }
        }

        // отправить остаток
        if (images.length > 0) {
            self.postMessage({ type: 'images', id, images });
        }

        self.postMessage({ type: 'result', id });
    }
};
