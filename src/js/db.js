// IndexedDB, Worker, сохранение и чтение файлов/изображений

import { state } from './state.js';
import { updateProgress, delay, parseHTMLForImages, decodeQuotedPrintable } from './utils.js';

export async function initDB() {
    return new Promise((resolve, reject) => {
        try {
            if (!state.worker) {
                state.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
            } state.worker.onmessage = (e) => {
                const message = e.data;
                // TODO: messages from worker
            };
            state.worker.onerror = (error) => {
                console.error('Worker error:', error);
                initializeDBWithoutWorker(resolve, reject);
                state.worker = null;
            };
        } catch (e) {
            console.warn('Worker initialization failed, falling back', e);
            initializeDBWithoutWorker(resolve, reject);
        }

        const request = indexedDB.open('MHTMLViewerDB', 3);

        request.onerror = (event) => reject(event.target.error);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            if (!db.objectStoreNames.contains('files')) {
                db.createObjectStore('files', { keyPath: 'id' });
            }

            if (!db.objectStoreNames.contains('images')) {
                const imageStore = db.createObjectStore('images', { keyPath: 'id', autoIncrement: true });
                imageStore.createIndex('tabId', 'tabId', { unique: false });
            }
        };

        request.onsuccess = (event) => {
            state.db = event.target.result;
            resolve(state.db);
        };
    });
}

async function initializeDBWithoutWorker(resolve, reject) {
    const request = indexedDB.open('MHTMLViewerDB', 3);

    request.onerror = (event) => reject(event.target.error);

    request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains('files')) {
            db.createObjectStore('files', { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains('images')) {
            const imageStore = db.createObjectStore('images', { keyPath: 'id', autoIncrement: true });
            imageStore.createIndex('tabId', 'tabId', { unique: false });
        }
    };

    request.onsuccess = (event) => {
        state.db = event.target.result;
        resolve(state.db);
    };
}

export async function saveFileToDB(id, fileData) {
    const arrayBuffer = fileData instanceof ArrayBuffer ? fileData : await fileData.arrayBuffer();

    if (state.worker) {
        return new Promise((resolve, reject) => {
            let allImages= [];

            state.worker.onmessage = async (e) => {
                const message = e.data;

                if (message.type === 'progress') {
                    updateProgress(message.progress);
                }

                // заполняем отдельными пакетами
                if (message.type === 'images') {
                    allImages.push(...message.images);
                    if (state.isIOS) {
                        await new Promise(r => setTimeout(r, 0));
                    }
                }

                if (message.type === 'result') {
                    try {
                        updateProgress(90);

                        const preview = allImages.length > 0
                            ? await findFirstValidPreview(allImages)
                            : null;

                        await saveToIndexedDB(id, preview, allImages);
                        updateProgress(100);
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                }

                if (message.type === 'error') {
                    reject(new Error(message.error));
                }
            };

            state.worker.postMessage({
                id,
                file: arrayBuffer,
                type: 'processFile'
            }, [arrayBuffer]);
        });
    } else {
        // fallback без Worker
        const reader = new FileReader();
        let allImages = [];

        return new Promise((resolve, reject) => {
            reader.onload = async (event) => {
                try {
                    const text = event.target?.result;
                    const decoded = decodeQuotedPrintable(text);

                    allImages = parseHTMLForImages(decoded);

                    const preview = allImages.length > 0
                        ? await findFirstValidPreview(allImages)
                        : null;

                    await saveToIndexedDB(id, preview, allImages);
                    updateProgress(100);
                    resolve();
                } catch (err) {
                    reject(err);
                }
            };

            reader.onerror = () => reject(reader.error);
            reader.readAsText(new Blob([arrayBuffer]));
        });
    }
}

export async function readFromIndexedDB(id) {
    if (state.isIOS) {
        return readFromIndexedDB_iOS(id);
    } else {
        return new Promise((resolve, reject) => {
            const tx = state.db.transaction(['files'], 'readonly');
            const store = tx.objectStore('files');
            const req = store.get(id);

            req.onsuccess = () => {
                if (req.result) {
                    resolve(req.result);
                } else {
                    reject(new Error('Данные не найдены в IndexedDB'));
                }
            };
            req.onerror = () => reject(req.error);
        });
    }
}

async function readFromIndexedDB_iOS(id) {
    const tx = state.db.transaction(['files'], 'readonly');
    const store = tx.objectStore('files');

    const preview = await new Promise((res, rej) => {
        const req = store.get(`${id}::preview`);
        req.onsuccess = () => res(req.result?.data || null);
        req.onerror = () => rej(req.error);
    });

    let images = [];
    let i = 0;
    while (true) {
        try {
            const img = await new Promise((res, rej) => {
                const req = store.get(`${id}::img::${i}`);
                req.onsuccess = () => {
                    if (req.result && req.result.data) {
                        res(req.result.data);
                    } else {
                        res(null);
                    }
                };
                req.onerror = () => rej(req.error);
            });
            if (!img) break;
            images.push(img);
            i++;
        } catch (e) {
            console.error('Error reading image', i, e);
            break;
        }
    }

    return { id, preview, images };
}

// Сохранение в IndexedDB (ветки для iOS/десктопа)
export async function saveToIndexedDB(id, preview, images) {
    const MAX_IMAGES = state.isIOS ? images.length : images.length;
    const total = Math.min(images.length, MAX_IMAGES);

    if (state.isIOS) {
        return saveForIOS(id, preview, images, total);
    } else {
        return saveForDesktop(id, preview, images, total);
    }
}

async function saveForIOS(id, preview, images, total) {
    try {
        await putData({ id: `${id}::preview`, data: preview });

        for (let i = 0; i < total; i++) {
            await putData({ id: `${id}::img::${i}`, data: images[i] });
            updateProgress(92 + ((i + 1) / total) * 8);
            await delay(200);
        }

        updateProgress(100);

        if (images.length > total) {
            const start = total;
            scheduleBackgroundSave(id, images.slice(start), 1, 300);
        }
    } catch (e) {
        console.error('Error saving on iOS:', e);
        throw e;
    }
}

async function saveForDesktop(id, preview, images, total) {
    try {
        const baseData = { id, preview, images: images.slice(0, total) };
        await putData(baseData);
        updateProgress(100);

        if (images.length > total) {
            const start = total;
            scheduleBackgroundSave(id, images.slice(start), 5, 100);
        }
    } catch (e) {
        console.error('Error saving on Desktop:', e);
        throw e;
    }
}

// фоновая пакетная запись
function scheduleBackgroundSave(id, images, chunkSize, delayMs) {
    let index = 0;

    function processChunk(deadline) {
        while ((deadline && deadline.timeRemaining() > 0) || !deadline) {
            if (index >= images.length) return;
            const chunk = images.slice(index, index + chunkSize);
            index += chunkSize;

            if (state.isIOS) {
                chunk.forEach(async (image, i) => {
                    try {
                        const blob = new Blob([JSON.stringify(image)], { type: 'application/json' });
                        await putData({ id: `${id}::img::${index + i}`, blob });
                    } catch (e) {
                        console.warn('Background save error:', e);
                    }
                });
            } else {
                appendImagesToRecord(id, chunk).catch(e => console.warn('Background append error:', e));
            }
        }
        if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(processChunk);
        } else {
            setTimeout(processChunk, delayMs);
        }
    }

    if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(processChunk);
    } else {
        setTimeout(processChunk, delayMs);
    }
}

// Универсальная функция записи данных в IndexedDB
function putData(data) {
    return new Promise((resolve, reject) => {
        const tx = state.db.transaction(['files'], 'readwrite');
        const store = tx.objectStore('files');
        const req = store.put(data);

        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

// десктоп: считать запись -> дописать изображения -> записать обратно
export async function appendImagesToRecord(id, newImages) {
    const tx = state.db.transaction(['files'], 'readwrite');
    const store = tx.objectStore('files');
    const record = await new Promise((res, rej) => {
        const req = store.get(id);
        req.onsuccess = () => res(req.result || { id, preview: null, images: [] });
        req.onerror = () => rej(req.error);
    });

    record.images = record.images.concat(newImages);

    await new Promise((res, rej) => {
        const req = store.put(record);
        req.onsuccess = () => res();
        req.onerror = () => rej(req.error);
    });
}

// Получение превью из IndexedDB
export async function getPreviewByTabId(tabId) {
    const store = state.db.transaction(['files'], 'readonly').objectStore('files');

    const iosKey = `${tabId}::preview`;
    const desktopKey = tabId;

    const get = key => new Promise((res, rej) => {
        const req = store.get(key);
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
    });

    const data = await get(iosKey) || await get(desktopKey);
    if (!data) return null;

    if (data.data) return data.data;

    if (data.blob) {
        const text = await data.blob.text();
        return JSON.parse(text);
    }

    return data.preview || null;
}

// Удаление файла из IndexedDB
export async function deleteImagesByTabId(tabId) {
    return new Promise((resolve, reject) => {
        const transaction = state.db.transaction(['files'], 'readwrite');
        const store = transaction.objectStore('files');

        const request = store.delete(tabId);

        request.onerror = (event) => reject(event.target.error);
        request.onsuccess = () => resolve();
    });
}

export async function clearImagesDB() {
    return new Promise((resolve, reject) => {
        const transaction = state.db.transaction(['images'], 'readwrite');
        const store = transaction.objectStore('images');
        const clearRequest = store.clear();

        clearRequest.onerror = (event) => reject(event.target.error);
        clearRequest.onsuccess = () => resolve();
    });
}

// чтение файла чанками
async function readFileInChunks(arrayBuffer) {
    const CHUNK_SIZE = state.isIOS ? 128 * 1024 : 1 * 1024 * 1024;
    let fullText = '';
    const totalChunks = Math.ceil(arrayBuffer.byteLength / CHUNK_SIZE);

    for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, arrayBuffer.byteLength);
        const chunk = arrayBuffer.slice(start, end);
        fullText += new TextDecoder('utf-8').decode(chunk);

        updateProgress(Math.floor((i / totalChunks) * 25));

        if (state.isIOS && i % 3 === 0) {
            await new Promise(r => setTimeout(r, 20));
        }
    }

    return fullText;
}

// превью из набора изображений (берём первое валидное)
export async function findFirstValidPreview(images, maxImagesToCheck = 5) {
    const imagesToTry = images.slice(0, maxImagesToCheck);

    for (const img of imagesToTry) {
        try {
            const preview = await createPreview(img);
            if (preview) {
                return preview;
            }
        } catch (e) {
            console.warn(`Не удалось создать превью для изображения ${img}`, e);
        }
    }
    return null;
}

async function createPreview(imageUrl) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';

        img.onload = function () {
            const maxSize = 300;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxSize) {
                    height = height * (maxSize / width);
                    width = maxSize;
                }
            } else {
                if (height > maxSize) {
                    width = width * (maxSize / height);
                    height = maxSize;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            resolve(canvas.toDataURL('image/jpeg', 0.9));
        };

        img.onerror = () => resolve(null);
        img.src = imageUrl;
    });
}
