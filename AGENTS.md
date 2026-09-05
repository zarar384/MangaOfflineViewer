# AGENTS.md

MangaOfflineViewer is an offline-first Angular 20 PWA that stores manga locally in the browser.
`web/` is the application and owns all data. `server/` is an optional Node helper for MHTML parsing that the client no longer calls (see Export/Import section below); it is not part of the active import/export path.

A detailed local knowledge base may exist in `.ai/`. It is git-ignored and absent from a fresh clone.
Read it when present. This file is authoritative when it is not.

## Commands

Run from `web/`:

- `npx ng build` - default build, use it to verify TypeScript and template changes.
- `npx ng build --configuration production-local` or `production-gh` - configured production builds.
- `npx ng serve --open` - dev server.
- `web/cheatsheet.txt` is the maintained command reference.

There is no test setup: `angular.json` defines no `test` target and the repository contains no spec files, so `npm test` fails.
`npm run build` also fails because it selects a `production` configuration that does not exist. Do not change these scripts unless asked.

## Architectural invariants

- IndexedDB through Dexie (`web/src/app/core/database/manga-db.ts`) is the only store for application data. The helper server never owns state.
- The application must keep working without network access. Do not add required backend calls, synchronization, authentication, or remote persistence.
- The service worker caches application assets only. Never move manga, chapter, or page data into service worker caching.
- MHTML import runs via a Web Worker with a main-thread fallback if the worker fails; it does not call the helper server (that integration was intentionally removed - see Export/Import below).
- Chapter and page order are persisted fields (`Chapter.order`, `Page.chapterOrder`, `Page.order`), not filename or archive order.
- Import and export formats are user-facing compatibility surfaces. Files produced by older versions must keep importing.

## Export / Import

MHTML and ZIP/CBZ import/export are streaming/incremental end to end, designed to handle files around 1GB without materializing the whole file, document, or image set in memory at once. Full technical detail: `.ai/export-import.md` (git-ignored, read it when present).

Critical, do-not-casually-revert decisions:

- Never reintroduce whole-string processing (build one giant HTML string, then one whole-string quoted-printable/base64 pass) for MHTML import or export. It caps out around ~1GB (`RangeError: Invalid string length`) and was the exact problem this streaming pipeline fixes.
- Quoted-printable/base64 decode and encode must stay chunk-boundary-safe (a marker like `=41` or `</script>` can legitimately split across two reads). Any change to `quoted-printable-stream.ts`, `base64-stream.ts`, or `mhtml-stream-scanner.ts` must be re-verified with adversarial tiny chunk sizes (1-7 bytes), not just a normal chunk size.
- Do not replace bulk/typed-array codec paths with per-character `+=`/`push` loops "for clarity" - that regressed throughput by ~19x during development.
- Do not re-wire MHTML parsing back to the local helper server (`server/`); it never reduced memory use (fully buffers server-side) and does not run on iOS Safari.
- Manga-structure metadata (chapters/order, `manga-structure-metadata.ts`) is versioned; add a new parser per format version and keep old versions' parsers working, never repurpose one.
- iOS pages are stored as base64 data-URL strings, not `Blob`s - every export/import code path must keep branching on `isIOS && typeof page.src === 'string'` rather than assuming `Blob`.
- The MHTML exporter's unconditional index-based asset naming (`page-${index+1}` regardless of whether a page was actually written) is a known, intentionally-preserved latent bug for backward compatibility - do not "fix" it without deliberate discussion; the ZIP/CBZ exporter's asset-map approach is the correct pattern and must not be changed to match MHTML's.
- `mhtml-stream-scanner.ts`'s image-source matching requires an attribute-name boundary check before accepting a `src="` match - without it, that literal text is also a substring of `data-src="`/`data-original-src="` (both end in "-src="), so a fallback attribute holding a `data:image/` value gets mistaken for a second `src` and over-extracts images from one `<img>` tag. Do not simplify this back to a plain `indexOf`. See `.ai/export-import.md` and `web/scripts/mhtml-img-src-priority.regression.ts`.

## Rules

- Make the smallest change at the existing owner. Search for an existing service, repository, or shared helper before adding an abstraction.
- Do not change a persisted entity, index, or ordering field without checking `manga-db.ts` versions and migrations plus the repositories that query them.
- Do not introduce a second source of truth for state already owned by `TabsService`, `ReaderService`, or `UiStateService`.
- Do not refactor unrelated code, weaken types, or silence compiler errors instead of fixing them.
- Reader runtime code is timing sensitive. Read `web/src/app/features/reader/README.md` before changing scrolling, virtualization, navigation, or image loading.
- Treat imported files as untrusted input. Do not introduce unsanitized HTML rendering or bypass Angular sanitization.

## Verification

Run `npx ng build` from `web/`, then review `git status --short` and `git diff --check`. Do not revert unrelated work.