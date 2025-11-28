import { Page } from "src/app/core/models/page.model";

export async function createPreviewFromFirstPage(pages: Page[], preivewMaxSize: number): Promise<Blob | null> {
    if (!pages.length) return null;

    try {
        const firstPage = pages[0];
        return await createPreview(firstPage.src, preivewMaxSize);
    } catch (error) {
        console.warn('Failed to create preview from first page:', error);
        return null;
    }
}

async function createPreview(imageBlob: Blob, preivewMaxSize: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(imageBlob);

        img.onload = () => {
            URL.revokeObjectURL(url);

            const { width, height } = calculatePreviewSize(img.width, img.height, preivewMaxSize);

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const context = canvas.getContext('2d');
            if (!context) {
                reject(new Error('Could not get canvas context'));
                return;
            }

            // high-quality image
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = 'high';
            context.drawImage(img, 0, 0, width, height);

            // export as JPEG blob
            canvas.toBlob(
                (blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Failed to create blob from canvas'));
                    }
                },
                'image/jpeg',
                0.85 // quality 85%
            );
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image for preview'));
        };

        img.src = url;
    });
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

async function getPreviewAsDataUrl(previewBlob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
            } else {
                reject(new Error('Failed to read blob as data URL'));
            }
        };

        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(previewBlob);
    });
}