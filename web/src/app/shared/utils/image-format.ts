export interface ImageFormat {
  readonly mimeType: string;
  readonly extension: string;
}

const JPEG = { mimeType: 'image/jpeg', extension: 'jpg' };
const PNG = { mimeType: 'image/png', extension: 'png' };
const GIF = { mimeType: 'image/gif', extension: 'gif' };
const WEBP = { mimeType: 'image/webp', extension: 'webp' };
const BMP = { mimeType: 'image/bmp', extension: 'bmp' };

export function imageFormatFromMime(mimeType: string): ImageFormat | undefined {
  switch (mimeType.trim().toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg': return JPEG;
    case 'image/png': return PNG;
    case 'image/gif': return GIF;
    case 'image/webp': return WEBP;
    case 'image/bmp':
    case 'image/x-ms-bmp': return BMP;
    default: return undefined;
  }
}

export function imageFormatFromFilename(filename: string): ImageFormat | undefined {
  const extension = filename.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
  switch (extension) {
    case 'jpg':
    case 'jpeg': return JPEG;
    case 'png': return PNG;
    case 'gif': return GIF;
    case 'webp': return WEBP;
    case 'bmp': return BMP;
    default: return undefined;
  }
}

function hasSignature(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

// Twelve bytes are enough for the supported signatures. Compare before consulting the
// stored MIME type or name because earlier exports mislabeled some JPEGs as PNGs.
export function detectImageFormat(bytes: Uint8Array): ImageFormat | undefined {
  if (hasSignature(bytes, [0xff, 0xd8, 0xff])) return JPEG;
  if (hasSignature(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return PNG;
  if (hasSignature(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
      hasSignature(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return GIF;
  if (hasSignature(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      hasSignature(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return WEBP;
  if (hasSignature(bytes, [0x42, 0x4d])) return BMP;
  return undefined;
}
