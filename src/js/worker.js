function decodeQuotedPrintable(str) {
    return str.replace(/=\r?\n/g, '')
              .replace(/=([0-9A-F]{2})/gi, (_, hex) =>
                  String.fromCharCode(parseInt(hex, 16)));
}

self.onmessage = async function(e) {
    const { id, fileData, type } = e.data;

    try {
        if (type === 'processFile') {
            // декодирование бинарные данные в строку
            const text = new TextDecoder().decode(fileData);
            self.postMessage({ type: 'progress', progress: 25 });

            // декодирование Quoted Printable
            const decoded = decodeQuotedPrintable(text);
            self.postMessage({ type: 'progress', progress: 75 });

            // отправка обратно декодированный HTML
            self.postMessage({
                type: 'decodedHTML',
                id,
                decoded
            });
        }
    } catch (error) {
        self.postMessage({
            type: 'error',
            error: error.message
        });
    }
};
