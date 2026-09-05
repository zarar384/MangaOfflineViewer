/**
 * Incremental (chunk-based) base64 decode/encode.
 *
 * Decoding turns base64 text chunks directly into Uint8Array byte chunks without ever building
 * a full base64 string for an image. Encoding turns byte chunks into base64 text chunks without
 * ever holding the whole image in memory as one big string. Both carry a tiny bit of state
 * (at most 3 leftover base64 characters, or 2 leftover bytes) across calls.
 */

export interface Base64DecodeState {
  /** 0-3 leftover base64 characters not yet forming a full 4-character group. */
  pending: string;
}

export interface Base64EncodeState {
  /** 0-2 leftover bytes not yet forming a full 3-byte group. */
  pendingBytes: Uint8Array;
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Char-code-indexed lookup tables (instead of string-keyed objects) so the hot decode/encode
// loops below never hash or allocate single-character strings; '=' (code 61) and anything outside
// the base64 alphabet map to -1. Also backs encodeBase64Chunk(), which writes output as raw bytes
// into a typed array and converts the whole chunk to a string with one native TextDecoder call
// instead of concatenating one JS string per output character (which dominated runtime for large
// images).
const DECODE_CODES = new Int16Array(128).fill(-1);
for (let i = 0; i < BASE64_CHARS.length; i++) DECODE_CODES[BASE64_CHARS.charCodeAt(i)] = i;
const PAD_CODE = '='.charCodeAt(0);

const BASE64_CODES = new Uint8Array(64);
for (let i = 0; i < BASE64_CHARS.length; i++) BASE64_CODES[i] = BASE64_CHARS.charCodeAt(i);
const textDecoder = new TextDecoder();

export function createBase64DecodeState(): Base64DecodeState {
  return { pending: '' };
}

export function createBase64EncodeState(): Base64EncodeState {
  return { pendingBytes: new Uint8Array(0) };
}

/** Decodes one chunk of base64 text into bytes, carrying any leftover partial group forward. */
export function decodeBase64Chunk(chunk: string, state: Base64DecodeState): { output: Uint8Array; state: Base64DecodeState } {
  const input = state.pending + chunk;
  const usableLen = input.length - (input.length % 4);
  const out = new Uint8Array((usableLen / 4) * 3);
  let o = 0;

  for (let i = 0; i < usableLen; i += 4) {
    const cc0 = input.charCodeAt(i);
    const cc1 = input.charCodeAt(i + 1);
    const cc2 = input.charCodeAt(i + 2);
    const cc3 = input.charCodeAt(i + 3);

    const v0 = cc0 < 128 ? DECODE_CODES[cc0] : -1;
    const v1 = cc1 < 128 ? DECODE_CODES[cc1] : -1;
    if (v0 < 0 || v1 < 0) continue; // malformed group, skip defensively

    const isPad2 = cc2 === PAD_CODE;
    const isPad3 = cc3 === PAD_CODE;
    const v2 = isPad2 ? 0 : (cc2 < 128 ? DECODE_CODES[cc2] : -1);
    const v3 = isPad3 ? 0 : (cc3 < 128 ? DECODE_CODES[cc3] : -1);
    if (v2 < 0 || v3 < 0) continue;

    const triple = (v0 << 18) | (v1 << 12) | (v2 << 6) | v3;
    out[o++] = (triple >> 16) & 0xff;
    if (!isPad2) out[o++] = (triple >> 8) & 0xff;
    if (!isPad2 && !isPad3) out[o++] = triple & 0xff;
  }

  return { output: out.subarray(0, o), state: { pending: input.slice(usableLen) } };
}

/** Flushes leftover base64 characters. Only non-empty for malformed/truncated input. */
export function finalizeBase64Decode(state: Base64DecodeState): Uint8Array {
  if (state.pending.length === 0) return new Uint8Array(0);
  console.warn(`Base64 stream ended with ${state.pending.length} incomplete trailing character(s); ignoring.`);
  return new Uint8Array(0);
}

/** Encodes one chunk of bytes into base64 text, carrying any leftover 1-2 bytes forward. */
export function encodeBase64Chunk(bytes: Uint8Array, state: Base64EncodeState): { output: string; state: Base64EncodeState } {
  const combinedLength = state.pendingBytes.length + bytes.length;
  const combined = new Uint8Array(combinedLength);
  combined.set(state.pendingBytes, 0);
  combined.set(bytes, state.pendingBytes.length);

  const usableLen = combinedLength - (combinedLength % 3);
  const outBytes = new Uint8Array((usableLen / 3) * 4);
  let o = 0;

  for (let i = 0; i < usableLen; i += 3) {
    const b0 = combined[i];
    const b1 = combined[i + 1];
    const b2 = combined[i + 2];
    outBytes[o++] = BASE64_CODES[b0 >> 2];
    outBytes[o++] = BASE64_CODES[((b0 & 0x03) << 4) | (b1 >> 4)];
    outBytes[o++] = BASE64_CODES[((b1 & 0x0f) << 2) | (b2 >> 6)];
    outBytes[o++] = BASE64_CODES[b2 & 0x3f];
  }

  const output = o > 0 ? textDecoder.decode(outBytes) : '';
  return { output, state: { pendingBytes: combined.slice(usableLen) } };
}

/** Flushes 0-2 leftover bytes, padding with '=' as needed to complete the final group. */
export function finalizeBase64Encode(state: Base64EncodeState): string {
  const remaining = state.pendingBytes;
  if (remaining.length === 0) return '';

  if (remaining.length === 1) {
    const b0 = remaining[0];
    return BASE64_CHARS[b0 >> 2] + BASE64_CHARS[(b0 & 0x03) << 4] + '==';
  }

  const b0 = remaining[0];
  const b1 = remaining[1];
  return BASE64_CHARS[b0 >> 2] + BASE64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)] + BASE64_CHARS[(b1 & 0x0f) << 2] + '=';
}
