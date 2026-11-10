# Export / Import system

Covers both supported container formats (MHTML, ZIP/CBZ), the optional manga-structure metadata
that preserves chapters/order, and the incremental/streaming architecture that lets both formats
handle very large files (target: ~1GB) without materializing the whole file/document in memory.

Verified against the source code as of the streaming rewrite (2026-09). This document owns the
export/import facts; do not restate them in other `.ai/` files.

## File map

| Concern | File |
| --- | --- |
| Export entry point (MHTML + ZIP/CBZ) | `web/src/app/core/services/export.service.ts` |
| Import entry point / UI | `web/src/app/shared/components/molv-drop-uploader/molv-drop-uploader.components.ts` |
| Incremental quoted-printable codec | `web/src/app/shared/utils/quoted-printable-stream.ts` |
| Incremental base64 codec | `web/src/app/shared/utils/base64-stream.ts` |
| Incremental MHTML scanner (import) | `web/src/app/shared/utils/mhtml-stream-scanner.ts` |
| MHTML extraction service (worker + fallback) | `web/src/app/core/services/mhtml-extractor.service.ts` |
| MHTML parsing Web Worker | `web/src/app/app.worker.ts` |
| Random-access ZIP central-directory reader (import) | `web/src/app/shared/utils/zip-random-access.ts` |
| Manga structure metadata model | `web/src/app/shared/models/manga-structure-metadata.ts` |
| Manga structure metadata parser (versioned) | `web/src/app/shared/utils/manga-structure-metadata.ts` |
| Persisting an imported structure to IndexedDB | `TabsRepository.saveImportedMangaStructure` in `web/src/app/core/repositories/tabs.repository.ts` |
| Old whole-string QP/HTML helpers (superseded, kept for reference, unused by the current pipeline) | `web/src/app/shared/utils/file-parsing.ts` (`decodeQuotedPrintable`, `encodeQuotedPrintable`, `parseHTMLForImages`, `blobToDataURL`) |
| Optional Node helper server (no longer called by the client) | `server/server.js`, `server/mhtmlParser.js`, `server/utils.js` |

## MHTML container format (app-specific, not real multipart MIME)

Confirmed via source/history: the app's `.mhtml` export is **not** multipart/related MIME (no
boundaries, no `Content-Location`, no `Content-ID`). It is a single RFC822 message with plain-text
headers and one quoted-printable-encoded `text/html` body:

```
From: <Saved by MHTML Viewer>
Subject: <tab name>
Date: <UTC date>
MIME-Version: 1.0
Content-Type: text/html; charset=utf-8
Content-Transfer-Encoding: quoted-printable

<!DOCTYPE html>
<html>...
<div id="page-1">
<img src="data:image/png;base64,AAAA..." alt="Image 1" style="display:block;margin:10px 0;">
</div>

<script id="molv-manga-structure" type="application/json">{...}</script>
</body></html>
```

Fixed points relied upon by both the exporter and the scanner:
- Headers are **plain text**, never quoted-printable encoded. Only the HTML body is QP-encoded.
- Every page is one `<div id="page-N">` wrapping one `<img src="data:<mime>;base64,...">`.
- The manga-structure metadata `<script>` tag, if present, is always the **last** element before
  `</body>`, i.e. it always appears after every image in the document.

## Streaming primitives

### `quoted-printable-stream.ts`
`decodeQuotedPrintableChunk`/`encodeQuotedPrintableChunk` process one chunk of text at a time and
carry a tiny bit of state (`QPDecodeState.pending`, `QPEncodeState.pending`) across calls so a
pattern split across a chunk boundary (`=`, `4`, `1` arriving in three different reads) is still
decoded/encoded correctly. `finalizeQPDecode`/`finalizeQPEncode` flush whatever the last chunk left
pending. These are byte-for-byte equivalent to the old whole-string `decodeQuotedPrintable`/
`encodeQuotedPrintable` in `file-parsing.ts`, **including their non-RFC quirks** (no 76-column soft
wrap on encode; a non-Latin1 character's `charCodeAt(0).toString(16)` escape can be more than 2 hex
digits, which is technically a pre-existing decode/encode mismatch for non-ASCII tab names inherited
from the original code, not introduced here).

Performance note: the hot loop does **not** iterate character-by-character. It matches long runs of
"plain" characters with a sticky regex (`/[^=]+/y` for decode, `/[\x21-\x3C\x3E-\x7E]+/y` for encode)
and appends the whole run in one string operation; only the boundary characters (`=`, space, `\r`,
`\n`, non-ASCII) go through the slower per-character branch. This is not optional polish — the
naive per-character version was measured ~19x slower than the old whole-string approach at
realistic image sizes (see Benchmarks below).

### `base64-stream.ts`
`decodeBase64Chunk` turns base64 text directly into `Uint8Array` bytes; `encodeBase64Chunk` turns
bytes into base64 text. Both carry 0-3 leftover base64 characters / 0-2 leftover bytes
(`Base64DecodeState.pending` / `Base64EncodeState.pendingBytes`) across calls. `finalizeBase64Encode`
pads the final group with `=`/`==`; `finalizeBase64Decode` only ever returns bytes for
malformed/truncated trailing input (logs a warning, does not throw).

Performance note: encoding writes output character codes into a `Uint8Array` via a numeric lookup
table (`BASE64_CODES`) and converts the whole chunk to a string with **one** `TextDecoder().decode()`
call; decoding uses `charCodeAt` + an `Int16Array` lookup table (not a string-keyed object) and
writes into a preallocated `Uint8Array`. Do not revert to `output += char`/`array.push(byte)` loops
here — that regressed encode/decode throughput by close to 20x during development.

### `mhtml-stream-scanner.ts` — `scanMhtmlFile(file, onImage, onMetadata?, onProgress?, readChunkBytes?)`
Single pass over the file that reads it in small slices (`chooseMhtmlReadChunkBytes()`, device-memory
aware, same sizing the old worker used), decodes quoted-printable incrementally, and runs a 3-mode
state machine (`scan` / `base64` / `script`) looking for these literal markers in `scan` mode:
- `<div id="page-` → captures the page id for the next image.
- `src="data:image/` → starts streaming a base64 image payload straight into byte chunks; every
  incoming buffer is decoded and drained on the same call, never concatenated into a growing
  string, so memory during an image payload stays O(chunk size), regardless of the image's size.
  Matching this requires an **attribute-name boundary check** (the character right before it must
  not be a letter/digit/hyphen) — see "Attribute-priority resolution" below for why.
- `<script id="molv-manga-structure"` → buffers the (small) metadata JSON text until `</script>`.
- `<img` → only consulted when no real `src="data:image/` belongs to the same tag; once the tag's
  own `>` has streamed in, resolves one fallback attribute instead (see below). Bounded by
  `MAX_IMG_TAG_LOOKAHEAD` (64 KB) as a defensive limit against malformed/pathological input.

`onImage` is called once per image, in document order, as soon as it is fully decoded
(`{pageId: string | null, blob: Blob}`). `onMetadata` is called at most once, only if/when the
script tag is found (it always comes after every image per the format guarantee above, so no
metadata-before-images ordering needs to be handled).

Chunk-boundary safety: any of the scan-mode markers, or the `</script>` end needle, can be split
across two reads. `longestSuffixThatIsPrefixOfAny(buffer, markers, maxMarkerLen)` computes how
many trailing characters of the current buffer could still be the start of a marker and keeps only
that bounded tail for the next read — **this must be applied to every mode's boundary search**, not
just the first one added. A real bug was found and fixed here during development: `script` mode's
`</script>` search initially dropped this tail-carry (`scriptBuffer += buffer; buffer = ''`
unconditionally), which silently swallowed the entire remainder of the file whenever `</script>`
happened to straddle a chunk boundary. Any future change to this scanner must be re-verified with
adversarial tiny `readChunkBytes` (1, 2, 3, 7 bytes), not just a "reasonable" chunk size — that is
what caught this bug.

**Attribute-priority resolution (`resolveImgSrcAttribute`, `IMG_SRC_ATTR_PRIORITY`).** The old
DOM-based parser (`parseHTMLForImages()` in `file-parsing.ts`, now dead code) resolved each
`<img>` element's source with `img.getAttribute('src') || img.getAttribute('data-original-src') ||
img.getAttribute('data-src') || img.getAttribute('data-srcset') || img.getAttribute('srcset')`.
A real bug was found and fixed here: the streaming scanner's literal marker `src="data:image/` is
also a substring of `data-src="data:image/` and `data-original-src="data:image/` (both attribute
names end in "-src="), so a fallback attribute that happened to also hold a `data:image/` value was
mistaken for a second, separate `src`, producing more than one image from a single `<img>` tag. Fix:
`indexOfAttrNeedle()` rejects a `src=` match whose preceding character is a letter/digit/hyphen
(i.e. it's actually the tail of a longer attribute name), and a small tag-scoped fallback path
(`resolveImgSrcAttribute`, driven off the `<img` marker) resolves `data-original-src`/`data-src`/
`data-srcset`/`srcset` — in that priority, first PRESENT attribute wins regardless of whether its
value is a supported `data:image/...;base64,...` source — once the enclosing tag's own `>` has been
seen (its value is never an arbitrarily large payload the way a real `src` can be, so buffering up
to `>` is safe). A regression script covering this, the fallback chain, and adversarial tiny chunk
sizes lives at `web/scripts/mhtml-img-src-priority.regression.ts` (not wired into any test runner;
run manually per the header comment).

Metadata-driven import cannot know how to place a page until the whole file has been scanned
(metadata can reorder pages relative to their physical position in the document), so the only place
in the whole pipeline that still buffers multiple whole images at once is the caller
(`molv-drop-uploader`'s `extractMhtml`), which holds a `Map<string, Blob>` of every image keyed by
page id until the scan finishes. This is an accepted, documented limitation (buffers Blobs, not
base64 text or a giant string — still a large improvement over the old code, just not O(chunk)
for this one mode). The default (non-metadata) import path stays O(chunk + current image) with no
buffering across images.

## Import flow (`molv-drop-uploader.components.ts`)

`onFilesDropped` → `processFile` dispatches by extension: `.zip`/`.cbz` → `extractArchive`,
`.mhtml`/`.mht` → `extractMhtml`, image files → `addImageFile`.

### MHTML (`extractMhtml`)
- If `enableMangaStructureMetadata` is on **and** no items have been added yet in this drop: scans
  the file once via `MhtmlExtractorService.extractStreaming`, collecting images into
  `Map<pageId, Blob>` and capturing metadata JSON if present. If the JSON parses and validates
  (`parseMangaStructureMetadata`, asset ids checked against the collected page ids), imports via
  `importStructuredMhtml` (metadata order) and returns early. Otherwise falls back to importing the
  already-collected blobs in **physical document order** (no second scan) and disables
  `enableMangaStructureMetadata` for the rest of this drop.
- Otherwise (metadata disabled, or a second/later file in a multi-file drop): streams straight
  through, calling `addBlobImage` per image as it arrives; progress is driven by
  `MhtmlExtractorService.progress()` (byte-based percentage), since the streaming API doesn't know
  the total image count upfront.
- Known minor behavior nuance vs. the pre-streaming code: a metadata attempt is now skipped
  entirely (not attempted-then-discarded) once `items().length > 0`, so `enableMangaStructureMetadata`
  is not explicitly flipped off in that specific scenario. This has no functional effect (the
  metadata path was already a no-op once items exist) but means a 3rd+ file in one drop may not
  see the flag as `false` the way earlier code did.

### ZIP/CBZ (`extractArchive`)
Reads only the central directory up front (`openArchiveReader`/`zip-random-access.ts`), then reads
one entry's compressed bytes at a time via `File.slice()` — the whole archive is never buffered.
Falls back to `unzipSync` (fflate) for ZIP64 archives (`ZipRandomAccessUnsupportedError`), which
*does* fully buffer — ZIP64 manga archives are assumed rare/small enough that this is acceptable;
this is a known, deliberate gap, not an oversight.
If `.molv/manga-structure.json` exists and metadata is enabled/valid/no items yet, imports via
`importStructuredArchive` (metadata order); otherwise imports by filename in
`numericNameSort` order (physical/sorted order, not metadata order).

### Common import tail
Both structured import paths converge on `importStructured(metadata, addPage)`, which walks pages
in metadata order (flattening chapters if `mode === 'chapters'`), calls `addPage` per item, and
stores the resulting `Map<asset, Page>` plus the metadata object on the component
(`importedMetadata`/`importedPagesByAsset`) for `saveAll()` to persist later via
`TabsRepository.saveImportedMangaStructure` (creates chapters in metadata order, pages with
persisted `order`/`chapterOrder` fields, not filename/archive order — see `AGENTS.md`).
Non-metadata imports go through the same `addBlobImage`/`items` signal path used by manual
drag-and-drop reordering.

## Export flow (updated 2026-11-10)

`exportManga(tab, format)` loads only chapter metadata and ordered page IDs, using
`PagesRepository.getOrderedIds(tabId, chapter?)`. The normal compound-index path is key-only,
but its full ID set is checked against actual membership by chapterId (or tabId in Single mode).
Legacy plain imports can have chapterOrder = -1 despite belonging to a chapter with order = 1;
null/missing ordering fields can omit pages from the index too. On a mismatch, a cursor reads
one row at a time, retains only id/order/chapterOrder, then sorts those references. This must
check membership, not just counts: chapters with swapped orders can have equal page counts.
Each page is fetched by ID immediately before writing; no getAll/getByChapter payload arrays
or Promise.all over chapters. Existing rows export without reimport or a database migration.
New plain imports assign the actual chapter order after the chapter has been saved/created;
the temporary -1 used before chapter creation is no longer persisted for its pages.

`ExportOutput` writes to a unique OPFS temporary file through `export-output.worker.ts` and
`createSyncAccessHandle()`. Every chunk is acknowledged before producing the next, bounding
the queue. The worker awaits flush/close/truncate for older Safari implementations as well.
After close, getFile() supplies a disk-backed download without reading the whole result.
Object URLs and their temporary files are released after 60 seconds. Abort closes the handle
before terminating the worker and deleting the file; termination alone can race with lock release.
Expired temporary files (over one day) are cleaned on the next export.

If OPFS/getFile/Worker initialization is unavailable, output falls back to small Blob parts
(not retained Uint8Array buffers). This still needs O(output size) browser blob storage.
Write/quota errors after initialization abort; there is no partial-file fallback or download.
Errors propagate to callers; a service guard prevents simultaneous exports.

### MHTML
The legacy RFC822 headers and one shared QP state are preserved. Blob input is sliced BEFORE
arrayBuffer(), in 256 KiB windows, then incrementally base64/QP encoded. iOS strings have only
their data-URL header matched; the payload is sent to QP in small text slices, without fetch or
decode/re-encode. Existing codec quirks are unchanged.

Unconditional index-based page-N metadata naming is deliberately preserved per AGENTS.md:
unsupported sources can be skipped in the body while remaining referenced in the manifest.
The MIME fallback to image/png and metadata placement at the end are unchanged.

### ZIP/CBZ
Images use fflate ZipPassThrough (STORE), avoiding main-thread recompression of compressed
images. This may increase archive size, especially for compressible originals. Blob input is
sliced; iOS base64 is incrementally decoded without fetch(dataURL). Every synchronous Zip push
is fully drained to the async output before another push. Metadata uses chunked ZipDeflate.
Classic ZIP output is rejected before 32-bit size or 16-bit entry-count fields overflow; ZIP64
is not generated. Asset names are still recorded only for written images, and a skipped image
suppresses archive metadata. Names/extensions retain their legacy rules.

### Metadata
Marker/version and Single-mode omission are unchanged. Chapter grouping is linear in page
count rather than repeated filter/indexOf. See the tracked service export README for the current
flow, limitations and validation details.

## Metadata format (`manga-structure-metadata.ts` model + parser)

`{ marker: 'molv-manga-structure', version: 1, mode: 'single' | 'chapters', ... }`. The parser
(`parseMangaStructureMetadata` in `shared/utils/manga-structure-metadata.ts`) switches on `version`
and keeps one parser function per version — when the format changes, add a new `case`/`parseVN`
function and keep the old one; never repurpose or remove an existing version's parser, since older
exported files must keep importing (see `AGENTS.md`). Asset ids are validated against the
caller-supplied `availableAssets` set (image filenames for ZIP, collected page ids for MHTML)
before metadata is trusted.

## iOS-specific behavior

iOS Safari pages are stored as base64 data-URL **strings**, not `Blob`s
(`addBlobImage`/`FileReader.readAsDataURL`, in `molv-drop-uploader.components.ts`), because
Blob object URLs were unreliable on iOS Safari in earlier testing. Every place that touches page
sources branches on `isIOS && typeof page.src === 'string'` before falling back to the `Blob` path
(both MHTML and ZIP export, above). Do not remove the iOS string branch or assume `page.src` is
always a `Blob`.

## Removed integration: local helper server for MHTML parsing

`app.worker.ts` previously could offload MHTML parsing to an optional local Node helper server
(`server/server.js`, via `/ping`, `/upload-chunk`, `/merge-chunks`). This call graph has been
**removed from the client** (the worker only runs `scanMhtmlFile` now). Rationale, confirmed before
removal: the server fully buffered the file and returned one monolithic JSON response, so it never
solved the memory problem this rewrite targets, and it doesn't run on iOS Safari anyway (no local
server there). The `server/` files themselves were left untouched — this is a client-side scope
decision, not a deletion of the helper. Do not re-wire the client back to the helper server as a
"performance" fix without re-deriving that it actually helps; it did not.

## Memory model

- **Import (MHTML, non-metadata path)**: O(chunk size + current image bytes), independent of file
  size — verified at ~1GB scale with flat process heap usage.
- **Import (MHTML, metadata path)**: O(total image bytes) — every image `Blob` is buffered (not
  text) until the scan completes, because metadata can reorder pages. Still avoids ever holding a
  giant string.
- **Import (ZIP/CBZ)**: O(central directory size + current entry bytes); central directory and
  local-file headers are tiny relative to archive size.
- **Export (all formats, OPFS)**: O(page IDs + chapter metadata + current page + chunk)
  in application memory. Completed output is disk-backed. iOS still deserializes one full
  base64 page string from IndexedDB. Browser/OS internal memory is implementation-dependent.
- **Export (Blob fallback)**: incremental input and immediate Blob conversion avoid retained
  byte arrays, but total browser blob storage still scales with output size. No universal
  large-file guarantee on unsupported/private-mode browsers or devices with insufficient space.

2026-11-10 validation: Angular build plus real Chromium IndexedDB/OPFS/Worker tests, including
the iOS string branch via user agent (not actual Safari). Six 256 MiB runs covered all formats
and both source types; SHA-256 matched for all 64 reimported images. Outputs were ~256 MiB ZIP/CBZ
and ~341 MiB MHTML; measured test-page JS heap ~81–102 MiB (not process RSS). Failure cleanup,
disk-full injection, concurrent-export rejection, Blob fallback, single/empty manga, unsupported
sources and 1–7 byte MHTML scan boundaries passed. Native Chromium downloads for all three
formats were also saved and compared by size and SHA-256. Real Safari device validation remains.

## Benchmarks (throwaway scripts, not committed — see repo memory for how to reproduce)

At ~180MB of image data: old whole-string MHTML export/import took ~430ms; the initial
character-by-character streaming rewrite took ~8000ms (~19x regression) before the bulk-run/typed
array optimizations above were applied, after which it returned to ~550ms (export) / ~1200ms
(import) — comparable to the old code.

At ~1GB of image data: the **old** whole-string approach crashes with `RangeError: Invalid string
length` (V8's maximum string length) — it cannot complete this operation at all. The **new**
streaming approach completes export in ~3s and import in ~7s, with peak JS heap usage staying flat
(~100-130MB) regardless of the 1GB scale. This is the concrete, reproducible proof that the
streaming rewrite fixes a real failure, not just a theoretical one.

## Verification workflow for this area

There is no test framework in this repo (`AGENTS.md`/`.ai/development-rules.md`). Verify changes to
the codecs/scanner with a throwaway `ts-node` script run against a temporary `tsconfig.*.json`
(module: commonjs) extending `web/tsconfig.json`, comparing against the old whole-string
implementations as the oracle across many chunk-boundary splits (include 1-character splits — that
is what caught the script-end-needle boundary bug). Delete the script and temp tsconfig after the
run passes. Always include a large-payload (100MB+) timing pass, not just a correctness pass — a
correct-but-19x-slower implementation would otherwise ship unnoticed.
