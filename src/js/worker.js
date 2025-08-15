import {  parseHTMLForImages, decodeQuotedPrintable } from './utils.js';

self.onmessage = async function(e) {
    const { id, fileData, type } = e.data;

    try {
        if (type === 'processFile') {
            // декодирование бинарные данные в строку
            const text = new TextDecoder().decode(fileData);
            self.postMessage({ type: 'progress', progress: 25 });

            // декодирование Quoted Printable
            const decodedHTML  = decodeQuotedPrintable(text);
            self.postMessage({ type: 'progress', progress: 75 });

            // извлечение изображений
            const images = parseHTMLForImages(decodedHTML);

            // отправка обратно декодированный HTML
            self.postMessage({
                type: 'decodedHTML',
                id,
                images
            });
        }
    } catch (error) {
        self.postMessage({
            type: 'error',
            error: error.message
        });
    }
};