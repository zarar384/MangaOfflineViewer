# Implementation Notes

Non-obvious behavior and traps. These are current implementation details, not permanent principles.

## Persistence traps

- `DB_VERSION = 1` in `db.config.ts` is stale. The real schema is at version 15 and the constant is only referenced by commented-out recreate code in `manga-db.ts`. Do not treat it as the schema version.
- `STORE_ARTISTS = 'artist'` and `STORE_TAGS = 'tag'` do not match the real table names `artists` and `tags`. They are unused.
- Schema version 12 is skipped; versions go 11 then 13.
- `USE_SEEDS` is `false`, so `SeedService` no-ops and the seed constants inside the repositories are dead in normal runs.
- `TabsRepository.delete()` cascades inside one transaction, but `ChaptersRepository.delete()` performs three separate deletes without a transaction. That inconsistency is pre-existing.
- `ChaptersRepository.update()` has a side effect: it reorders every chapter of the tab.
- `PagesRepository.getMeta()` spreads the whole row and therefore still carries `src`, while `getMetaByChapter()` sets `src: null`. Chapter-mode reader buffers have no payloads and rely on `ImagePipelineService.ensurePayload()`.

## Save paths

`TabsRepository.saveOrUpdateTabWithPages()` is the normal upload and edit path. It builds a preview from the first page in single mode, assigns `order` by array index, defaults `chapterOrder` to `-1` when no chapter is supplied, deletes pages no longer present in the target scope, and writes in chunks of 10 on iOS and 50 elsewhere.

`TabsRepository.saveImportedMangaStructure()` is used only for a validated new structured import. It creates chapters and pages in one transaction using metadata array positions as order.

## Export pipeline

`ReaderWrapperComponent.onExportButtonClicked(format)` loads the tab through `TabsService.getTabById()` and calls `ExportService.exportManga(tab, reader.pages(), format)`.

`getExportStructure()` returns the caller pages for single mode. For chapter mode it reloads `ChaptersRepository.getAll()` and `PagesRepository.getByChapter()` per chapter, because the reader buffer may hold only the chapters currently loaded.

`exportArchive()` writes images as `1.ext`, `2.ext`, and so on, skipping unsupported sources with a warning. `exportMHTML()` writes `div#page-N` containers holding data URLs and then wraps the HTML with quoted-printable encoding. Both call `createMetadata()`, which returns undefined when any page lacks a physical asset, so a partial manifest is never written.

## Import pipeline

`MolvDropUploaderComponents.onFilesDropped()` iterates files through `processFile()`, which dispatches by extension to `extractArchive()`, `extractMhtml()`, or `addImageFile()`.

`extractArchive()` unzips with `fflate`, looks for `.molv/manga-structure.json`, validates it, and on success imports in metadata order. Otherwise it filters image entries, sorts them with `numericNameSort`, and imports them.

`extractMhtml()` calls `MhtmlExtractorService.extractImportData()`. Metadata import pre-fetches every referenced asset before touching the item list so a failure cannot leave a partial structure. Otherwise it falls back to `extractImagesFromMhtml()` and fetches each source with a 5 second abort timeout, warning and continuing on failure.

Structured import is only attempted when the item list is empty, so mixing files cannot silently apply a stale structure. Manual removal, reordering, or adding a plain image clears the captured structure and returns the save to the flat path.

`saveAll()` chooses `saveImportedMangaStructure()` only when captured metadata exists and the tab has no id; otherwise it uses `saveOrUpdateTabWithPages()`.

## Metadata contract

Defined in `shared/models/manga-structure-metadata.ts` with validation in `shared/utils/manga-structure-metadata.ts`. It lives in `shared` because both `core/services/export.service.ts` and the shared uploader consume it, and because it is a file-format contract rather than a Dexie entity.

It is format independent: marker `molv-manga-structure`, `version: 1`, a mode discriminant, and ordered chapter or page arrays referencing opaque asset ids. Array position carries order; database ids, order fields, and page names are deliberately not serialized. ZIP stores the JSON at `.molv/manga-structure.json` and uses archive filenames as assets. MHTML embeds a JSON script element with id `molv-manga-structure` and uses `page-N` element ids as assets.

Behavior by case: valid metadata reconstructs the structure; absent metadata uses the legacy path; malformed, unknown version, wrong mode, missing asset, or duplicate asset warns and uses the legacy path. No case aborts the import.

## MHTML worker and streaming

The helper-server-assisted parsing path (ping/upload-chunk/merge-chunks) has been removed from the client. `MhtmlExtractorService.extractStreaming()` runs the same incremental scanner (`mhtml-stream-scanner.ts`) either in the worker or, if the worker throws, on the main thread. See `export-import.md` for the full architecture, chunk-boundary-safety details, and memory model.

## PWA

Both ngsw configs prefetch `index.html`, JS, and CSS, and lazily cache `/assets/**`. They also declare `dataGroups` for `/previews/**` and `/manga/**`, but no code fetches those URLs because images live in IndexedDB. Treat those groups as vestigial; this is inferred from the absence of matching requests, not from documentation.

`provideServiceWorker` is registered only when `isDevMode()` is false, so service worker behavior cannot be observed with `ng serve`.

## Build and tests

`angular.json` defines `build`, `serve`, and `deploy` targets only. There is no `test` target and no spec files, so `npm test` fails. `npm run build` selects a nonexistent `production` configuration and also fails. Working commands are in `web/cheatsheet.txt`.