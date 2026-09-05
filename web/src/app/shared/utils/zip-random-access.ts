import { inflateSync, strFromU8, unzipSync } from 'fflate';

/**
 * Minimal ZIP central-directory reader/entry extractor.
 *
 * Reads only the End-Of-Central-Directory record and the central directory
 * itself (both tiny relative to archive size) to build an entry index, then
 * reads a single entry's compressed bytes on demand via File.slice(), so the
 * whole archive is never fully buffered in memory at once.
 *
 * Reuses fflate's inflateSync for the actual DEFLATE decompression; only the
 * (small, stable) ZIP header layout is parsed here.
 */

export interface ZipEntryInfo {
  name: string;
  method: number; // 0 = stored, 8 = deflate
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/** Thrown when the archive uses a feature (ZIP64) this reader doesn't support. Callers should fall back to unzipSync. */
export class ZipRandomAccessUnsupportedError extends Error { }

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT_SIZE = 65535;
const ZIP64_SENTINEL = 0xffffffff;

function u16(view: DataView, offset: number): number { return view.getUint16(offset, true); }
function u32(view: DataView, offset: number): number { return view.getUint32(offset, true); }

async function readSlice(file: File, start: number, end: number): Promise<ArrayBuffer> {
  return file.slice(start, end).arrayBuffer();
}

/** Parses the ZIP central directory without reading entry data. */
export async function readZipCentralDirectory(file: File): Promise<ZipEntryInfo[]> {
  const tailSize = Math.min(file.size, EOCD_MIN_SIZE + MAX_COMMENT_SIZE);
  const tailBuffer = await readSlice(file, file.size - tailSize, file.size);
  const tail = new DataView(tailBuffer);

  let eocdPos = -1;
  for (let i = tail.byteLength - EOCD_MIN_SIZE; i >= 0; i--) {
    if (u32(tail, i) === EOCD_SIGNATURE) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos === -1) {
    throw new Error('Not a valid ZIP archive: End Of Central Directory record not found.');
  }

  const entryCount = u16(tail, eocdPos + 10);
  const centralDirSize = u32(tail, eocdPos + 12);
  const centralDirOffset = u32(tail, eocdPos + 16);

  if (entryCount === 0xffff || centralDirSize === ZIP64_SENTINEL || centralDirOffset === ZIP64_SENTINEL) {
    throw new ZipRandomAccessUnsupportedError('ZIP64 archives are not supported by the random-access reader.');
  }

  const cdBuffer = await readSlice(file, centralDirOffset, centralDirOffset + centralDirSize);
  const cdBytes = new Uint8Array(cdBuffer);
  const cdView = new DataView(cdBuffer);

  const entries: ZipEntryInfo[] = [];
  let pos = 0;

  for (let i = 0; i < entryCount; i++) {
    if (pos + 46 > cdBytes.length || u32(cdView, pos) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error('Malformed ZIP central directory entry.');
    }

    const flag = u16(cdView, pos + 8);
    const method = u16(cdView, pos + 10);
    const compressedSize = u32(cdView, pos + 20);
    const uncompressedSize = u32(cdView, pos + 24);
    const nameLength = u16(cdView, pos + 28);
    const extraLength = u16(cdView, pos + 30);
    const commentLength = u16(cdView, pos + 32);
    const localHeaderOffset = u32(cdView, pos + 42);

    if (compressedSize === ZIP64_SENTINEL || uncompressedSize === ZIP64_SENTINEL || localHeaderOffset === ZIP64_SENTINEL) {
      throw new ZipRandomAccessUnsupportedError('ZIP64 entries are not supported by the random-access reader.');
    }

    const nameStart = pos + 46;
    // Bit 11 of the general purpose flag marks UTF-8 names; otherwise fall back to legacy codepage (latin1), same as fflate's own unzipSync.
    const name = strFromU8(cdBytes.subarray(nameStart, nameStart + nameLength), !(flag & 2048));

    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });

    pos = nameStart + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** Reads and decompresses a single entry's bytes, without touching any other entry. */
export async function readZipEntry(file: File, entry: ZipEntryInfo): Promise<Uint8Array<ArrayBuffer>> {
  const headerBuffer = await readSlice(file, entry.localHeaderOffset, entry.localHeaderOffset + 30);
  const headerView = new DataView(headerBuffer);

  if (u32(headerView, 0) !== LOCAL_FILE_SIGNATURE) {
    throw new Error(`Malformed local file header for entry "${entry.name}".`);
  }

  const nameLength = u16(headerView, 26);
  const extraLength = u16(headerView, 28);
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;

  const compressedBuffer = await readSlice(file, dataStart, dataStart + entry.compressedSize);
  const compressed = new Uint8Array(compressedBuffer);

  if (entry.method === 0) return compressed;
  if (entry.method === 8) return inflateSync(compressed, { out: new Uint8Array(entry.uncompressedSize) });

  throw new Error(`Unsupported compression method ${entry.method} for entry "${entry.name}".`);
}

/** Entry-name-keyed access to an archive's contents, backed by either random-access reads or a fallback in-memory archive. */
export interface ArchiveReader {
  names: string[];
  read(name: string): Promise<Uint8Array<ArrayBuffer>>;
}

/**
 * Opens an archive for entry-by-entry reading without buffering the whole file when possible.
 * Falls back to whole-buffer unzipSync only for ZIP64 archives, which this reader doesn't parse.
 */
export async function openArchiveReader(file: File): Promise<ArchiveReader> {
  try {
    const entries = await readZipCentralDirectory(file);
    const byName = new Map(entries.map(e => [e.name, e]));
    return {
      names: entries.map(e => e.name),
      read: name => {
        const entry = byName.get(name);
        if (!entry) return Promise.reject(new Error(`Archive entry not found: ${name}`));
        return readZipEntry(file, entry);
      }
    };
  } catch (error) {
    if (!(error instanceof ZipRandomAccessUnsupportedError)) throw error;

    console.warn('Falling back to whole-archive extraction:', error.message);
    const buffer = new Uint8Array(await file.arrayBuffer());
    const archive = unzipSync(buffer);
    return {
      names: Object.keys(archive),
      read: name => {
        const bytes = archive[name];
        if (!bytes) return Promise.reject(new Error(`Archive entry not found: ${name}`));
        return Promise.resolve(bytes);
      }
    };
  }
}
