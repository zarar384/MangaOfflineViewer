/**
 * Incremental (chunk-based) quoted-printable decode/encode.
 *
 * These mirror decodeQuotedPrintable()/encodeQuotedPrintable() in file-parsing.ts BYTE-FOR-BYTE
 * (including their non-strict-RFC quirks, e.g. no 76-column soft wrap on encode), but never
 * require the whole document to be materialized as one string. Each function processes one
 * chunk at a time and carries a tiny bit of state (at most a few characters) across calls so a
 * pattern split across a chunk boundary (e.g. "=" / "4" / "1" arriving in three different reads)
 * is still decoded/encoded correctly.
 *
 * Usage:
 *   let state = createQPDecodeState();
 *   for (const chunk of chunks) {
 *     const r = decodeQuotedPrintableChunk(chunk, state);
 *     state = r.state;
 *     use(r.output);
 *   }
 *   use(finalizeQPDecode(state)); // flush whatever couldn't be resolved (malformed tail, if any)
 */

export interface QPDecodeState {
  /** Unresolved trailing text, always starting with '=' when non-empty (max length 3: "=", "=X", "=\r"). */
  pending: string;
}

export interface QPEncodeState {
  /** At most one raw character whose escaped form depends on what follows it. */
  pending: '' | ' ' | '=';
}

export function createQPDecodeState(): QPDecodeState {
  return { pending: '' };
}

export function createQPEncodeState(): QPEncodeState {
  return { pending: '' };
}

function isHexDigit(ch: string): boolean {
  return (ch >= '0' && ch <= '9') || (ch >= 'A' && ch <= 'F') || (ch >= 'a' && ch <= 'f');
}

// Runs of characters that decodeQuotedPrintableChunk() always copies through untouched (i.e.
// everything except '='). Matching these in bulk via the regex engine instead of one JS loop
// iteration + string concat per character is dramatically faster for large payloads (base64
// image text is almost entirely made of such runs).
const DECODE_PLAIN_RUN = /[^=]+/y;

// Runs of characters that encodeQuotedPrintableChunk() always copies through untouched: printable
// ASCII other than space and '=' (both of which need one-character lookahead to encode). \r/\n
// and anything outside \x20-\x7E still go through the slow per-character path below.
const ENCODE_PLAIN_RUN = /[\x21-\x3C\x3E-\x7E]+/y;

/**
 * Decodes one chunk of quoted-printable text. Equivalent to running decodeQuotedPrintable()
 * on the concatenation of all chunks ever passed in (plus finalizeQPDecode() at the end).
 */
export function decodeQuotedPrintableChunk(chunk: string, state: QPDecodeState): { output: string; state: QPDecodeState } {
  const input = state.pending + chunk;
  const n = input.length;
  let out = '';
  let i = 0;

  while (i < n) {
    DECODE_PLAIN_RUN.lastIndex = i;
    const run = DECODE_PLAIN_RUN.exec(input);
    if (run && run.index === i) {
      out += run[0];
      i += run[0].length;
      continue;
    }

    // input[i] === '=' here : could be a soft line break (=\n or =\r\n), a hex escape (=XX), or a
    // literal '='.
    const remaining = n - i - 1;
    if (remaining === 0) {
      // Not enough lookahead yet to decide; hold back and wait for more data.
      return { output: out, state: { pending: input.slice(i) } };
    }

    const c1 = input[i + 1];

    if (c1 === '\n') {
      // Soft line break "=\n" -> removed entirely.
      i += 2;
      continue;
    }

    if (c1 === '\r') {
      if (remaining === 1) {
        return { output: out, state: { pending: input.slice(i) } };
      }
      const c2 = input[i + 2];
      if (c2 === '\n') {
        // Soft line break "=\r\n" -> removed entirely.
        i += 3;
        continue;
      }
      // "=\r" not followed by "\n" -> not a valid pattern, '=' stays literal, re-scan from '\r'.
      out += '=';
      i += 1;
      continue;
    }

    if (remaining === 1) {
      return { output: out, state: { pending: input.slice(i) } };
    }
    const c2 = input[i + 2];
    if (isHexDigit(c1) && isHexDigit(c2)) {
      out += String.fromCharCode(parseInt(c1 + c2, 16));
      i += 3;
      continue;
    }

    // Not a recognized escape -> '=' stays literal.
    out += '=';
    i += 1;
  }

  return { output: out, state: { pending: '' } };
}

/** Flushes whatever trailing text could not be resolved (matches original's "no match -> literal" behavior). */
export function finalizeQPDecode(state: QPDecodeState): string {
  return state.pending;
}

/**
 * Encodes one chunk of raw text as quoted-printable. Equivalent to running encodeQuotedPrintable()
 * on the concatenation of all chunks ever passed in (plus finalizeQPEncode() at the end).
 */
export function encodeQuotedPrintableChunk(chunk: string, state: QPEncodeState): { output: string; state: QPEncodeState } {
  let out = '';
  let pending = state.pending;
  let i = 0;
  const n = chunk.length;

  while (i < n) {
    ENCODE_PLAIN_RUN.lastIndex = i;
    const run = ENCODE_PLAIN_RUN.exec(chunk);
    if (run && run.index === i) {
      if (pending === ' ') out += ' ';
      else if (pending === '=') out += '=';
      pending = '';
      out += run[0];
      i += run[0].length;
      continue;
    }

    const ch = chunk[i];

    if (ch === '\r' || ch === '\n') {
      if (pending === ' ') out += '=20';
      else if (pending === '=') out += '=3D';
      out += ch;
      pending = '';
      i++;
      continue;
    }

    if (ch === ' ') {
      if (pending === ' ') out += ' ';
      else if (pending === '=') out += '=';
      pending = ' ';
      i++;
      continue;
    }

    if (ch === '=') {
      if (pending === ' ') out += ' ';
      else if (pending === '=') out += '=';
      pending = '=';
      i++;
      continue;
    }

    // Outside \x20-\x7E (and not \r/\n, already handled above): hex-escape it.
    if (pending === ' ') out += ' ';
    else if (pending === '=') out += '=';
    pending = '';
    out += '=' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');
    i++;
  }

  return { output: out, state: { pending } };
}

/** Flushes a trailing pending space/'=' that turned out to be at the very end of the document. */
export function finalizeQPEncode(state: QPEncodeState): string {
  if (state.pending === ' ') return '=20';
  if (state.pending === '=') return '=3D';
  return '';
}
