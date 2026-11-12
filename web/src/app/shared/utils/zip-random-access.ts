import { Inflate, strFromU8 } from 'fflate';

/** Central-directory fields needed to read and verify one ZIP entry. */
export interface ZipEntryInfo {
  name: string;
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  directoryOffset: number;
}

export class ZipRandomAccessUnsupportedError extends Error { }

export interface ArchiveReadOptions {
  maxBytes?: number;
  signal?: AbortSignal;
}

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const ZIP64_LOCATOR_SIZE = 20;
const ZIP64_EOCD_SIZE = 56;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
const MAX_COMMENT_SIZE = 0xffff;
const ZIP64_SENTINEL = 0xffffffff;
const DIRECTORY_CHUNK_BYTES = 64 * 1024;
const INFLATE_CHUNK_BYTES = 16 * 1024;
// The caller receives one complete entry as a typed array. Bound that allocation
// independently of the archive size so many ordinary pages can still exceed 4 GiB in total.
const MAX_ENTRY_BYTES = 256 * 1024 * 1024;

function u16(view: DataView, offset: number): number { return view.getUint16(offset, true); }
function u32(view: DataView, offset: number): number { return view.getUint32(offset, true); }
function u64(view: DataView, offset: number): number {
  const value = u32(view, offset) + u32(view, offset + 4) * 0x100000000;
  if (!Number.isSafeInteger(value)) throw new ZipRandomAccessUnsupportedError('ZIP64 offset or size exceeds supported precision.');
  return value;
}

function checkRange(offset: number, length: number, limit: number): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || length > limit - offset) {
    throw new Error('ZIP data range lies outside the archive.');
  }
}

async function readView(file: Blob, offset: number, length: number, signal?: AbortSignal): Promise<DataView<ArrayBuffer>> {
  checkAbort(signal);
  checkRange(offset, length, file.size);
  const buffer = await file.slice(offset, offset + length).arrayBuffer();
  checkAbort(signal);
  return new DataView(buffer);
}

function checkDisk(disk: number): void {
  if (disk !== 0) throw new ZipRandomAccessUnsupportedError('Split ZIP archives are not supported.');
}

async function findDirectory(file: File, signal?: AbortSignal) {
  const tailOffset = Math.max(0, file.size - EOCD_SIZE - MAX_COMMENT_SIZE - ZIP64_LOCATOR_SIZE);
  const tail = await readView(file, tailOffset, file.size - tailOffset, signal);
  let end = tail.byteLength - EOCD_SIZE;
  for (; end >= 0; end--) {
    // Match the comment length too: the ZIP signature can occur inside the comment.
    if (u32(tail, end) === EOCD_SIGNATURE && end + EOCD_SIZE + u16(tail, end + 20) === tail.byteLength) break;
  }
  if (end < 0) throw new Error('Not a valid ZIP archive: end of central directory not found.');

  const locator = end - ZIP64_LOCATOR_SIZE;
  if (locator >= 0 && u32(tail, locator) === ZIP64_LOCATOR_SIGNATURE) {
    checkDisk(u32(tail, locator + 4));
    if (u32(tail, locator + 16) !== 1) throw new ZipRandomAccessUnsupportedError('Split ZIP archives are not supported.');
    const recordOffset = u64(tail, locator + 8);
    const locatorOffset = tailOffset + locator;
    checkRange(recordOffset, ZIP64_EOCD_SIZE, locatorOffset);
    const record = await readView(file, recordOffset, ZIP64_EOCD_SIZE, signal);
    if (u32(record, 0) !== ZIP64_EOCD_SIGNATURE || u64(record, 4) !== locatorOffset - recordOffset - 12) {
      throw new Error('Malformed ZIP64 end of central directory.');
    }
    checkDisk(u32(record, 16));
    checkDisk(u32(record, 20));
    const count = u64(record, 32);
    if (u64(record, 24) !== count) throw new Error('Inconsistent ZIP64 entry count.');
    return { count, size: u64(record, 40), offset: u64(record, 48), limit: recordOffset };
  }

  checkDisk(u16(tail, end + 4));
  checkDisk(u16(tail, end + 6));
  const count = u16(tail, end + 10);
  if (u16(tail, end + 8) !== count) throw new Error('Inconsistent ZIP entry count.');
  return { count, size: u32(tail, end + 12), offset: u32(tail, end + 16), limit: tailOffset + end };
}

function readZip64Fields(view: DataView, start: number, length: number, sizes: number[], disk: number): number {
  const end = start + length;
  for (let pos = start; pos + 4 <= end;) {
    const id = u16(view, pos);
    const fieldLength = u16(view, pos + 2);
    pos += 4;
    const fieldEnd = pos + fieldLength;
    if (fieldEnd > end) break;
    if (id === 1) {
      // Only the fields that overflowed the classic header appear here, in ZIP64 order.
      for (let i = 0; i < sizes.length; i++) {
        if (sizes[i] !== ZIP64_SENTINEL) continue;
        if (pos + 8 > fieldEnd) throw new Error('Truncated ZIP64 entry size or offset.');
        sizes[i] = u64(view, pos);
        pos += 8;
      }
      if (disk === 0xffff) {
        if (pos + 4 > fieldEnd) throw new Error('Truncated ZIP64 disk number.');
        disk = u32(view, pos);
      }
      return disk;
    }
    pos = fieldEnd;
  }
  throw new Error('Missing ZIP64 entry information.');
}

/** Reads the directory in small windows, including ZIP64 entries. */
export async function readZipCentralDirectory(file: File, signal?: AbortSignal): Promise<ZipEntryInfo[]> {
  const directory = await findDirectory(file, signal);
  checkAbort(signal);
  checkRange(directory.offset, directory.size, directory.limit);
  if (directory.count > Math.floor(directory.size / CENTRAL_HEADER_SIZE)) throw new Error('Invalid ZIP entry count.');

  const entries: ZipEntryInfo[] = [];
  const end = directory.offset + directory.size;
  let offset = directory.offset;
  let windowOffset = offset;
  let view = new DataView(new ArrayBuffer(0));
  for (let i = 0; i < directory.count; i++) {
    checkRange(offset, CENTRAL_HEADER_SIZE, end);
    if (offset - windowOffset + CENTRAL_HEADER_SIZE > view.byteLength) {
      view = await readView(file, offset, Math.min(DIRECTORY_CHUNK_BYTES, end - offset), signal);
      windowOffset = offset;
    }
    let pos = offset - windowOffset;
    if (u32(view, pos) !== CENTRAL_DIR_SIGNATURE) throw new Error('Malformed ZIP central directory entry.');
    const nameLength = u16(view, pos + 28);
    const extraLength = u16(view, pos + 30);
    const commentLength = u16(view, pos + 32);
    const recordLength = CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
    checkRange(offset, recordLength, end);
    if (pos + recordLength > view.byteLength) {
      view = await readView(file, offset, Math.min(Math.max(DIRECTORY_CHUNK_BYTES, recordLength), end - offset), signal);
      windowOffset = offset;
      pos = 0;
    }

    const flags = u16(view, pos + 8);
    const sizes = [u32(view, pos + 24), u32(view, pos + 20), u32(view, pos + 42)];
    let disk = u16(view, pos + 34);
    const nameStart = pos + CENTRAL_HEADER_SIZE;
    if (sizes.includes(ZIP64_SENTINEL) || disk === 0xffff) {
      disk = readZip64Fields(view, nameStart + nameLength, extraLength, sizes, disk);
    }
    checkDisk(disk);
    const [uncompressedSize, compressedSize, localHeaderOffset] = sizes;
    checkRange(localHeaderOffset, LOCAL_HEADER_SIZE + compressedSize, directory.offset);
    // Keep the same UTF-8/legacy filename decoding as the previous reader.
    const name = strFromU8(new Uint8Array(view.buffer, nameStart, nameLength), !(flags & 2048));
    entries.push({
      name, flags, uncompressedSize, compressedSize, localHeaderOffset,
      method: u16(view, pos + 10), crc32: u32(view, pos + 16), directoryOffset: directory.offset
    });
    offset += recordLength;
  }
  return entries;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value;
});

function updateCrc(crc: number, chunk: Uint8Array): number {
  for (let i = 0; i < chunk.length; i++) crc = CRC_TABLE[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
  return crc;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('ZIP read cancelled.', 'AbortError');
}

async function collectDeflate(data: Blob, append: (chunk: Uint8Array) => void, signal?: AbortSignal): Promise<void> {
  let stream: DecompressionStream | undefined;
  try { stream = new DecompressionStream('deflate-raw'); } catch { /* Older browsers use fflate below. */ }
  if (stream) {
    const reader = data.stream().pipeThrough(stream, { signal }).getReader();
    try {
      while (true) {
        checkAbort(signal);
        const result = await reader.read();
        checkAbort(signal);
        if (result.done) return;
        append(result.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  const inflater = new Inflate(append);
  for (let offset = 0; offset < data.size; offset += INFLATE_CHUNK_BYTES) {
    checkAbort(signal);
    // Read and expand one bounded block at a time, including on browsers without native raw DEFLATE.
    const end = Math.min(data.size, offset + INFLATE_CHUNK_BYTES);
    const bytes = new Uint8Array(await data.slice(offset, end).arrayBuffer());
    checkAbort(signal);
    inflater.push(bytes, end === data.size);
  }
}

/** Reads, expands and checks one entry. Archive offsets come from the central directory. */
export async function readZipEntry(file: File, entry: ZipEntryInfo, options: ArchiveReadOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
  const { signal } = options;
  checkAbort(signal);
  const maxBytes = Math.min(options.maxBytes ?? MAX_ENTRY_BYTES, MAX_ENTRY_BYTES);
  if (entry.uncompressedSize > maxBytes || entry.compressedSize > MAX_ENTRY_BYTES) {
    throw new Error(`ZIP entry "${entry.name}" exceeds the supported size.`);
  }
  const header = await readView(file, entry.localHeaderOffset, LOCAL_HEADER_SIZE, signal);
  if (u32(header, 0) !== LOCAL_FILE_SIGNATURE || u16(header, 8) !== entry.method) {
    throw new Error(`Malformed local file header for "${entry.name}".`);
  }
  if ((entry.flags | u16(header, 6)) & 0x41) {
    throw new ZipRandomAccessUnsupportedError(`Encrypted ZIP entry "${entry.name}" is not supported.`);
  }
  const start = entry.localHeaderOffset + LOCAL_HEADER_SIZE + u16(header, 26) + u16(header, 28);
  checkRange(start, entry.compressedSize, entry.directoryOffset);
  const data = file.slice(start, start + entry.compressedSize);

  let bytes: Uint8Array<ArrayBuffer>;
  let crc = 0xffffffff;
  if (entry.method === 0 && entry.compressedSize === entry.uncompressedSize) {
    bytes = new Uint8Array(await data.arrayBuffer());
    const chunkSize = 256 * 1024;
    let lastYield = performance.now();
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      checkAbort(signal);
      crc = updateCrc(crc, bytes.subarray(offset, offset + chunkSize));
      if (performance.now() - lastYield >= 16) {
        await new Promise(resolve => setTimeout(resolve, 0));
        lastYield = performance.now();
      }
    }
  } else if (entry.method === 8 && entry.compressedSize > 0) {
    bytes = new Uint8Array(entry.uncompressedSize);
    let written = 0;
    await collectDeflate(data, chunk => {
      if (chunk.length > bytes.length - written) throw new Error(`Invalid expanded size for ZIP entry "${entry.name}".`);
      bytes.set(chunk, written);
      crc = updateCrc(crc, chunk);
      written += chunk.length;
    }, signal);
    if (written !== bytes.length) throw new Error(`Invalid expanded size for ZIP entry "${entry.name}".`);
  } else if (entry.method === 0 || entry.method === 8) {
    throw new Error(`Invalid stored size for ZIP entry "${entry.name}".`);
  } else {
    throw new ZipRandomAccessUnsupportedError(`Unsupported compression method for ZIP entry "${entry.name}".`);
  }
  checkAbort(signal);
  if (((crc ^ 0xffffffff) >>> 0) !== entry.crc32) throw new Error(`CRC check failed for ZIP entry "${entry.name}".`);
  return bytes;
}

export interface ArchiveReader {
  names: string[];
  read(name: string, options?: ArchiveReadOptions): Promise<Uint8Array<ArrayBuffer>>;
}

/** Opens ZIP and ZIP64 archives without loading all compressed or expanded data at once. */
export async function openArchiveReader(file: File, signal?: AbortSignal): Promise<ArchiveReader> {
  const entries = await readZipCentralDirectory(file, signal);
  checkAbort(signal);
  const byName = new Map(entries.map(entry => [entry.name, entry]));
  return {
    names: entries.map(entry => entry.name),
    read: async (name, options) => {
      const entry = byName.get(name);
      if (!entry) throw new Error(`Archive entry not found: ${name}`);
      return readZipEntry(file, entry, options);
    }
  };
}
