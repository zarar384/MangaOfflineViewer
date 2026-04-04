import { Page } from "../../core/models/page.model";
import { isIOS } from "./constants";

export async function createPreviewFromFirstPage(pages: Page[], preivewMaxSize: number): Promise<Blob | string | null> {
    if (!pages.length) return null;

    try {
        const firstPage = pages[0];
        return await createPreview(firstPage.src, preivewMaxSize);
    } catch (error) {
        console.warn('Failed to create preview from first page:', error);
        return null;
    }
}

export async function createPreview(imageSrc: Blob | string, preivewMaxSize: number): Promise<Blob | string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        let objectUrl: string | null = null;

        img.onload = () => {
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }

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

            if (isIOS) {
                //  iOS to data URL
                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                resolve(dataUrl);
            } else {
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
            }
        };


        img.onerror = () => {
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
            reject(new Error('Failed to load image for preview'));
        };

        if (isIOS && typeof imageSrc === 'string') {
            // iOS / base64
            img.src = imageSrc;
        } 
        else if (imageSrc instanceof Blob) {
            // Blob
            objectUrl = URL.createObjectURL(imageSrc);
            img.src = objectUrl;
        }
        else {
            reject(new Error('Unsupported image source type'));
        }
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