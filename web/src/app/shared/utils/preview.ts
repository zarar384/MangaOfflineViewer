import { Page } from "../../core/models/page.model";
import { isIOS } from "./constants";

export async function createPreviewFromFirstPage(pages: Page[], preivewMaxSize: number): Promise<Blob | string | null> {
    if (!pages.length) return null;

    try {
        const firstPage = pages[0];
        return await createPreview(firstPage.src!, preivewMaxSize);
    } catch (error) {
        console.warn('Failed to create preview from first page:', error);
        return null;
    }
}

export async function createPreview(imageSrc: Blob | string, previewMaxSize: number): Promise<Blob | string> {
    return (await createImagePreview(imageSrc, previewMaxSize)).preview;
}

export async function createImagePreview(
    imageSrc: Blob | string,
    maxSize: number,
    signal?: AbortSignal
): Promise<{ preview: Blob | string; width: number; height: number }> {
    signal?.throwIfAborted();
    if (typeof imageSrc !== 'string' && !(imageSrc instanceof Blob)) {
        throw new Error('Unsupported image source type');
    }
    const img = new Image();
    const objectUrl = imageSrc instanceof Blob ? URL.createObjectURL(imageSrc) : undefined;
    const source = typeof imageSrc === 'string' ? imageSrc : objectUrl!;
    const canvas = document.createElement('canvas');
    let cancelLoad: (() => void) | undefined;
    try {
        await new Promise<void>((resolve, reject) => {
            cancelLoad = () => reject(signal?.reason);
            signal?.addEventListener('abort', cancelLoad, { once: true });
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('Failed to load image for preview'));
            img.src = source;
        });
        signal?.throwIfAborted();
        const width = img.naturalWidth;
        const height = img.naturalHeight;
        const size = calculatePreviewSize(width, height, maxSize);
        canvas.width = Math.max(1, size.width);
        canvas.height = Math.max(1, size.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not get canvas context');
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(img, 0, 0, canvas.width, canvas.height);

        const preview = isIOS
            ? canvas.toDataURL('image/jpeg', 0.85)
            : await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob(blob => blob
                    ? resolve(blob)
                    : reject(new Error('Failed to create image preview')), 'image/jpeg', 0.85);
            });
        signal?.throwIfAborted();
        return { preview, width, height };
    } finally {
        if (cancelLoad) signal?.removeEventListener('abort', cancelLoad);
        img.onload = null;
        img.onerror = null;
        img.removeAttribute('src');
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        canvas.width = 0;
        canvas.height = 0;
    }
}

// calculating preview sizes
function calculatePreviewSize(originalWidth: number, originalHeight: number, maxSize: number): { width: number; height: number } {

    let width = originalWidth;
    let height = originalHeight;

    if (width > height) {
        if (width > maxSize) {
            height = Math.round(height * (maxSize / width));
            width = maxSize;
        }
    } else {
        if (height > maxSize) {
            width = Math.round(width * (maxSize / height));
            height = maxSize;
        }
    }

    return { width, height };
}
