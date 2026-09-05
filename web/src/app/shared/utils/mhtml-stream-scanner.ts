/**
 * Incremental scanner for MangaOfflineViewer's own MHTML export format.
 *
 * The app's .mhtml files are NOT real multipart/related MIME (no boundaries, no Content-Location,
 * no Content-ID - confirmed via repo-wide search and git history). They are a single quoted-printable
 * encoded text/html part whose body always looks like:
 *
 *   <div id="page-1">
 *   <img src="data:image/png;base64,AAAA...." alt="Image 1" style="display:block;margin:10px 0;">
 *   </div>
 *
 *   <script id="molv-manga-structure" type="application/json">{...}</script>
 *
 * This scanner reads the file in small slices, decodes quoted-printable incrementally, and looks
 * for these fixed literal markers as they stream by:
 *   - `<div id="page-`      -> associates the following image with a page/asset id
 *   - `src="data:image/`    -> starts streaming a base64 image payload straight into byte chunks
 *   - `<script id="molv-manga-structure"` -> buffers the (small) metadata JSON text
 *   - `<img`                -> only consulted when no real `src="data:image/` belongs to this same
 *                              tag; once the tag's own `>` is seen, resolves one fallback attribute
 *                              (`data-original-src`/`data-src`/`data-srcset`/`srcset`, in that
 *                              priority) exactly like the old DOM-based parser did per `<img>`
 *                              element - see `resolveImgSrcAttribute` and `IMG_SRC_ATTR_PRIORITY`.
 *
 * Matching `src="data:image/` requires an attribute-name boundary check (the char right before it
 * must not be a letter/digit/hyphen): without it, that literal text is also a substring of
 * `data-src="data:image/` and `data-original-src="data:image/` (both attribute names end in
 * "-src="), which would make a fallback attribute holding a data:image/ value look like a second,
 * separate `src` and produce multiple images from a single `<img>` tag.
 *
 * The only unbounded content in the document is the base64 image payload behind a real `src`; every
 * other buffer used here is bounded (the length of the longest marker, or - only when a tag has no
 * real `src` - up to that one tag's closing `>`, per `MAX_IMG_TAG_LOOKAHEAD`). While a `src` payload
 * is being read, each incoming buffer is decoded and drained on the same call - it is never held
 * onto or concatenated into a growing string, so memory stays O(chunk size + current image),
 * regardless of how large the file or an individual image is.
 */

import { createQPDecodeState, decodeQuotedPrintableChunk, finalizeQPDecode, QPDecodeState } from './quoted-printable-stream';
import { createBase64DecodeState, decodeBase64Chunk, Base64DecodeState } from './base64-stream';

export interface MhtmlScannedImage {
  /** The id of the enclosing `<div id="page-N">`, if any (e.g. "page-3"). Null if not found. */
  pageId: string | null;
  blob: Blob;
}

export type MhtmlImageCallback = (image: MhtmlScannedImage) => Promise<void> | void;
export type MhtmlMetadataCallback = (metadataJson: string) => void;
export type MhtmlProgressCallback = (percent: number) => void;

const DIV_NEEDLE = '<div id="page-';
const IMG_TAG_NEEDLE = '<img';
const IMG_SRC_NEEDLE = 'src="data:image/';
const BASE64_MARKER = ';base64,';
const SCRIPT_NEEDLE = '<script id="molv-manga-structure"';
const SCRIPT_END_NEEDLE = '</script>';
const SCAN_MARKERS = [DIV_NEEDLE, IMG_SRC_NEEDLE, IMG_TAG_NEEDLE, SCRIPT_NEEDLE];
const MAX_MARKER_LEN = Math.max(...SCAN_MARKERS.map(m => m.length));

/**
 * Attribute names checked, in priority order, when resolving which value an `<img>` tag's image
 * source should use - mirrors what the old DOM-based parser (`parseHTMLForImages` in
 * `file-parsing.ts`) did per element: `img.getAttribute('src') || img.getAttribute('data-original-src')
 * || img.getAttribute('data-src') || img.getAttribute('data-srcset') || img.getAttribute('srcset')`.
 * Only the first PRESENT attribute is ever used, regardless of whether its value turns out to be a
 * supported `data:image/...;base64,...` source - the remaining attributes are never consulted, even
 * if one of them would have held usable image data. This matches the old semantics exactly (it also
 * never "fell through" to a lower-priority attribute just because the winning one wasn't fetchable).
 */
const IMG_SRC_ATTR_PRIORITY = ['src', 'data-original-src', 'data-src', 'data-srcset', 'srcset'] as const;

// How far past an unresolved "<img" we're willing to buffer while looking for its closing ">" (to
// conclusively decide it has no recognized src-like attribute at all). Real attribute lists never
// get remotely close to this; it only guards against pathological/malformed input.
const MAX_IMG_TAG_LOOKAHEAD = 64 * 1024;

function isAttrNameChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9-]/.test(ch);
}

/**
 * Leftmost occurrence of `needle` in `buffer` that actually starts an attribute, rather than being
 * the tail of a longer attribute name. Without this check, the literal text `src="data:image/` is
 * also a substring of `data-src="data:image/` and `data-original-src="data:image/` (both attribute
 * names end in "-src="), so a fallback/lazy-load attribute that happens to also hold a data:image/
 * value would be mistaken for a second, separate `src`, causing multiple images to be extracted
 * from what should be a single `<img>` tag - this was the root cause of the over-extraction bug.
 * `precedingChar` is the character logically right before `buffer[0]` (or '' at the very start of
 * the document) - needed because a previous read may have already discarded that character.
 */
function indexOfAttrNeedle(buffer: string, needle: string, precedingChar: string): number {
  let from = 0;
  for (;;) {
    const idx = buffer.indexOf(needle, from);
    if (idx === -1) return -1;
    const prev = idx === 0 ? precedingChar : buffer[idx - 1];
    if (!isAttrNameChar(prev)) return idx;
    from = idx + 1;
  }
}

function findAttrValue(text: string, name: string): string | null {
  const needle = `${name}=`;
  let from = 0;
  for (;;) {
    const idx = text.indexOf(needle, from);
    if (idx === -1) return null;
    const prev = idx === 0 ? undefined : text[idx - 1];
    if (isAttrNameChar(prev)) { from = idx + 1; continue; }
    const quote = text[idx + needle.length];
    if (quote !== '"' && quote !== '\'') { from = idx + 1; continue; }
    const valueStart = idx + needle.length + 1;
    const closeIdx = text.indexOf(quote, valueStart);
    if (closeIdx === -1) return null;
    return text.slice(valueStart, closeIdx);
  }
}

/**
 * Resolves the single value an `<img ...>` tag's source should use, given the tag's full raw text
 * (attributes only; quoted values required), following `IMG_SRC_ATTR_PRIORITY`. Returns null if
 * none of the recognized attributes are present. Exported for testing; also used by the scanner to
 * resolve fallback attributes once it has confirmed (by seeing the tag's closing ">") that it has
 * no real `src` (see `scanMhtmlFile`) - unlike `src`, whose value may be an arbitrarily large
 * base64 payload and is therefore matched directly in the streaming buffer without ever requiring
 * the whole tag to be buffered first.
 */
export function resolveImgSrcAttribute(imgTagText: string): string | null {
  for (const name of IMG_SRC_ATTR_PRIORITY) {
    const value = findAttrValue(imgTagText, name);
    if (value !== null) return value;
  }
  return null;
}

// Same device-memory-aware sizing used by the (legacy) worker chunker, kept in one place so the
// main-thread path and the worker path agree on how much of the file to read into memory at once.
export function chooseMhtmlReadChunkBytes(): number {
  const nav: any = typeof navigator !== 'undefined' ? navigator : undefined;
  const mem = nav?.deviceMemory || 4; // GB
  const ua: string = nav?.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);

  if (isIOS) return 100 * 1024;
  if (isMobile) {
    if (mem <= 2) return 100 * 1024;
    if (mem <= 4) return 150 * 1024;
    return 200 * 1024;
  }
  if (mem >= 16) return 1024 * 1024;
  if (mem >= 8) return 600 * 1024;
  return 300 * 1024;
}

function longestSuffixThatIsPrefixOfAny(buffer: string, markers: string[], maxMarkerLen: number): number {
  const maxLen = Math.min(buffer.length, maxMarkerLen - 1);
  for (let len = maxLen; len > 0; len--) {
    const suffix = buffer.slice(buffer.length - len);
    for (const marker of markers) {
      if (marker.startsWith(suffix)) return len;
    }
  }
  return 0;
}

function longestMarkerPrefixSuffix(buffer: string): number {
  return longestSuffixThatIsPrefixOfAny(buffer, SCAN_MARKERS, MAX_MARKER_LEN);
}

/**
 * Scans an MHTML file/blob, calling onImage for every image found (in document order) and
 * onMetadata once if/when the manga-structure script tag is found. Never materializes the whole
 * decoded document, the whole set of images, or a whole image's base64 text as one string.
 */
export async function scanMhtmlFile(
  file: File | Blob,
  onImage: MhtmlImageCallback,
  onMetadata?: MhtmlMetadataCallback,
  onProgress?: MhtmlProgressCallback,
  readChunkBytes: number = chooseMhtmlReadChunkBytes()
): Promise<void> {
  const size = file.size;
  const textDecoder = new TextDecoder('utf-8');
  let qpState: QPDecodeState = createQPDecodeState();

  type Mode = 'scan' | 'base64' | 'script';
  let mode: Mode = 'scan';
  let buffer = '';
  // The character logically right before buffer[0] in the full decoded stream (or '' at the very
  // start of the document/after a chunk boundary we can't see past) - kept so attribute-boundary
  // checks still work correctly even when a marker match starts at position 0 of a freshly-carried
  // buffer tail. Always kept in sync via `dropFromBuffer`.
  let precedingChar = '';
  let pendingPageId: string | null = null;
  let currentMime = '';
  let base64State: Base64DecodeState = createBase64DecodeState();
  let currentImageChunks: Uint8Array[] = [];
  let scriptBuffer = '';

  function dropFromBuffer(count: number): void {
    if (count <= 0) return;
    precedingChar = buffer[count - 1] ?? precedingChar;
    buffer = buffer.slice(count);
  }

  async function finishImage(): Promise<void> {
    const chunks = currentImageChunks;
    currentImageChunks = [];
    const pageId = pendingPageId;
    pendingPageId = null;
    const blob = new Blob(chunks as BlobPart[], { type: currentMime || 'image/png' });
    try {
      await onImage({ pageId, blob });
    } catch (error) {
      console.warn('Failed to process an image found in the MHTML file, skipping it:', error);
    }
  }

  // Starts base64-streaming the image whose real `src="data:image/` needle was found at `srcIdx`
  // (already boundary-checked by the caller). Returns 'wait' if not enough of the buffer has been
  // read yet to tell (caller should keep the buffer from `srcIdx` and return), 'handled' otherwise
  // (caller should `continue` the scan loop).
  function beginImageFromSrcMatch(srcIdx: number): 'handled' | 'wait' {
    const markerEnd = srcIdx + IMG_SRC_NEEDLE.length;
    const base64Idx = buffer.indexOf(BASE64_MARKER, markerEnd);
    if (base64Idx === -1) {
      if (buffer.length - markerEnd > 32) {
        // Not really "data:image/...;base64,"; treat literally and keep scanning past it.
        dropFromBuffer(srcIdx + 1);
        return 'handled';
      }
      dropFromBuffer(srcIdx);
      return 'wait';
    }
    currentMime = 'image/' + buffer.slice(markerEnd, base64Idx);
    dropFromBuffer(base64Idx + BASE64_MARKER.length);
    base64State = createBase64DecodeState();
    currentImageChunks = [];
    mode = 'base64';
    return 'handled';
  }

  // Decodes a complete (already fully buffered) "data:image/<mime>;base64,<data>" value - used for
  // the fallback attributes (`data-original-src`/`data-src`/`data-srcset`/`srcset`), whose value is
  // only ever consulted once the enclosing `<img>` tag's own closing ">" has already been seen, so
  // it is always available in full (unlike a real `src`, which may hold an arbitrarily large
  // payload and is therefore streamed directly instead of buffered).
  async function finishImageFromCompleteDataUri(dataUri: string): Promise<void> {
    const prefix = 'data:image/';
    if (!dataUri.startsWith(prefix)) return;
    const rest = dataUri.slice(prefix.length);
    const base64At = rest.indexOf(BASE64_MARKER);
    if (base64At === -1) return;
    currentMime = 'image/' + rest.slice(0, base64At);
    const data = rest.slice(base64At + BASE64_MARKER.length);
    base64State = createBase64DecodeState();
    currentImageChunks = [];
    if (data.length > 0) {
      const result = decodeBase64Chunk(data, base64State);
      base64State = result.state;
      if (result.output.length > 0) currentImageChunks.push(result.output);
    }
    await finishImage();
  }

  async function processBuffer(): Promise<void> {
    for (;;) {
      if (mode === 'scan') {
        const divIdx = buffer.indexOf(DIV_NEEDLE);
        const scriptIdx = buffer.indexOf(SCRIPT_NEEDLE);
        const imgTagIdx = buffer.indexOf(IMG_TAG_NEEDLE);
        const srcIdx = indexOfAttrNeedle(buffer, IMG_SRC_NEEDLE, precedingChar);

        let bestIndex = -1;
        let bestMarker = '';
        if (divIdx !== -1) { bestIndex = divIdx; bestMarker = DIV_NEEDLE; }
        if (scriptIdx !== -1 && (bestIndex === -1 || scriptIdx < bestIndex)) { bestIndex = scriptIdx; bestMarker = SCRIPT_NEEDLE; }
        if (imgTagIdx !== -1 && (bestIndex === -1 || imgTagIdx < bestIndex)) { bestIndex = imgTagIdx; bestMarker = IMG_TAG_NEEDLE; }
        if (srcIdx !== -1 && (bestIndex === -1 || srcIdx < bestIndex)) { bestIndex = srcIdx; bestMarker = IMG_SRC_NEEDLE; }

        if (bestIndex === -1) {
          const keep = longestMarkerPrefixSuffix(buffer);
          dropFromBuffer(buffer.length - keep);
          return;
        }

        if (bestMarker === DIV_NEEDLE) {
          const idEnd = buffer.indexOf('"', bestIndex + DIV_NEEDLE.length);
          if (idEnd === -1) {
            dropFromBuffer(bestIndex);
            return;
          }
          pendingPageId = 'page-' + buffer.slice(bestIndex + DIV_NEEDLE.length, idEnd);
          dropFromBuffer(idEnd + 1);
          continue;
        }

        if (bestMarker === IMG_SRC_NEEDLE) {
          const outcome = beginImageFromSrcMatch(bestIndex);
          if (outcome === 'wait') return;
          continue;
        }

        if (bestMarker === IMG_TAG_NEEDLE) {
          const tagEnd = buffer.indexOf('>', imgTagIdx);
          if (srcIdx !== -1 && (tagEnd === -1 || srcIdx < tagEnd)) {
            // The real `src` we found belongs to this same tag (it appears before this tag's own
            // closing ">", or that ">" hasn't streamed in yet at all) - use it directly without
            // waiting for the tag to close, since its value may be a huge base64 payload.
            const outcome = beginImageFromSrcMatch(srcIdx);
            if (outcome === 'wait') return;
            continue;
          }
          if (tagEnd !== -1) {
            // The whole tag is buffered and it has no real `src`; resolve one of the fallback
            // attributes instead (or skip it if none of them are present/supported).
            const tagText = buffer.slice(imgTagIdx, tagEnd + 1);
            dropFromBuffer(tagEnd + 1);
            const fallbackValue = resolveImgSrcAttribute(tagText);
            if (fallbackValue) await finishImageFromCompleteDataUri(fallbackValue);
            continue;
          }
          if (buffer.length - imgTagIdx < MAX_IMG_TAG_LOOKAHEAD) {
            // Tag not fully buffered yet and no `src` found so far; wait for more data.
            dropFromBuffer(imgTagIdx);
            return;
          }
          // Implausibly long without closing; treat "<img" as ordinary text and keep scanning past it.
          dropFromBuffer(imgTagIdx + 1);
          continue;
        }

        if (bestMarker === SCRIPT_NEEDLE) {
          const tagEnd = buffer.indexOf('>', bestIndex + SCRIPT_NEEDLE.length);
          if (tagEnd === -1) {
            dropFromBuffer(bestIndex);
            return;
          }
          dropFromBuffer(tagEnd + 1);
          scriptBuffer = '';
          mode = 'script';
          continue;
        }
      }

      if (mode === 'base64') {
        const quoteIdx = buffer.indexOf('"');
        if (quoteIdx === -1) {
          if (buffer.length > 0) {
            const result = decodeBase64Chunk(buffer, base64State);
            base64State = result.state;
            if (result.output.length > 0) currentImageChunks.push(result.output);
            dropFromBuffer(buffer.length);
          }
          return;
        }

        const finalChars = buffer.slice(0, quoteIdx);
        if (finalChars.length > 0) {
          const result = decodeBase64Chunk(finalChars, base64State);
          base64State = result.state;
          if (result.output.length > 0) currentImageChunks.push(result.output);
        }
        dropFromBuffer(quoteIdx + 1);
        mode = 'scan';
        await finishImage();
        continue;
      }

      if (mode === 'script') {
        const endIdx = buffer.indexOf(SCRIPT_END_NEEDLE);
        if (endIdx === -1) {
          // Keep back a bounded tail that could still be the start of "</script>" split across
          // a chunk boundary; commit the rest to scriptBuffer.
          const keep = longestSuffixThatIsPrefixOfAny(buffer, [SCRIPT_END_NEEDLE], SCRIPT_END_NEEDLE.length);
          scriptBuffer += keep > 0 ? buffer.slice(0, buffer.length - keep) : buffer;
          dropFromBuffer(buffer.length - keep);
          return;
        }
        scriptBuffer += buffer.slice(0, endIdx);
        dropFromBuffer(endIdx + SCRIPT_END_NEEDLE.length);
        mode = 'scan';
        if (onMetadata) onMetadata(scriptBuffer);
        scriptBuffer = '';
        continue;
      }
    }
  }

  let pos = 0;
  while (pos < size) {
    const end = Math.min(pos + readChunkBytes, size);
    const arrayBuffer = await file.slice(pos, end).arrayBuffer();
    const textChunk = textDecoder.decode(arrayBuffer, { stream: true });
    const qpResult = decodeQuotedPrintableChunk(textChunk, qpState);
    qpState = qpResult.state;
    buffer += qpResult.output;
    await processBuffer();
    pos = end;
    if (onProgress) onProgress(Math.min(99, (pos / size) * 100));
  }

  const finalText = textDecoder.decode();
  if (finalText) {
    const qpResult = decodeQuotedPrintableChunk(finalText, qpState);
    qpState = qpResult.state;
    buffer += qpResult.output;
  }
  const flushedQP = finalizeQPDecode(qpState);
  if (flushedQP) buffer += flushedQP;
  await processBuffer();

  if (mode !== 'scan') {
    console.warn('MHTML file ended unexpectedly while parsing; the last entry may be incomplete and was dropped.');
  }

  if (onProgress) onProgress(100);
}
