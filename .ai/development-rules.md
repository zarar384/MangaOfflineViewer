# Development Rules

These are instructions. The facts behind them live in architecture.md and implementation-notes.md.

## Architecture

- Extend the existing owner instead of adding a layer. Search for an existing repository method, service, shared component, shared util, or reader engine service first.
- Follow the closest existing pattern in the file being edited, including the documented dependency exceptions. Do not add a wrapper only to satisfy stricter layering than the project uses.
- Do not import features from `core` or `shared`.

## Persistence

- Adding or changing a persisted field, index, or table requires a new `version(n).stores(...)` block, plus a migration when existing data needs conversion. Never edit a released version block.
- Keep `Chapter.order`, `Page.chapterOrder`, and `Page.order` consistent. Reorder chapters through `ChaptersRepository.reorder()`.
- Use repository ordering queries. Do not sort persisted content by filename when order fields exist.
- Never delete or recreate the user database as a workaround.
- Preserve iOS handling: data URL payloads, chunked writes, and yields between heavy steps.

## State

- Reuse the owning store: `TabsService` for library and selection, `ReaderService` for reader state, `UiStateService` for UI state, `MangaDraftService` for unsaved manga edits, `ChaptersListService` for chapter drafts.
- Do not add another state mechanism. Signals plus the existing RxJS usage are the convention.
- Remember that `ChaptersListService` and `BookmarksService` are component-scoped, not root-provided.

## Offline and PWA

- Do not make any normal flow depend on the helper server, and keep the worker fallback intact.
- Keep application data in IndexedDB. Do not cache manga content through the service worker and do not add remote persistence, synchronization, or authentication.
- Service worker registration stays production-only.

## Import and export

- Preserve existing archive entry naming, MHTML generation, extraction order, and the image-only import path.
- Structure metadata is optional. Absent, malformed, unknown-version, or unusable metadata must warn and fall back to the legacy path rather than fail the import.
- Keep marker and version checks and the one-asset-per-page rule. Metadata array order is authoritative.
- Keep physical format handling in the format owner, and persist a reconstructed structure through a repository transaction.

## Reader

- Read `web/src/app/features/reader/README.md` before touching the reader component or engine.
- Preserve guard flags, token cancellation, window sizing, and eviction radii. Route blob URL creation and release through `ImagePipelineService` or `ObjectUrlService`.

## Security

- Treat imported archives and MHTML as untrusted. Do not add `innerHTML`, `bypassSecurityTrust*`, or template injection; none exist today.
- Keep the abort timeout and error handling around fetches of imported sources.

## Performance

- Assume large libraries and long chapters. Avoid loading page payloads when a `PageMeta` projection is enough, and avoid materializing every page of a manga in memory.
- Keep bulk writes chunked and image work incremental.

## Verification

- Run `npx ng build` from `web/` after TypeScript or template changes.
- There is no test target and no spec files. Do not add a test framework unless asked.
- Do not modify `npm run build` or `npm test`; both are known broken and intentionally left alone.
- Review `git status --short` and `git diff --check`. Preserve unrelated worktree changes.

## AI context files

- `AGENTS.md` is tracked and must stay small, stable, and self-sufficient, because a clone may not contain `.ai/`.
- `.ai/` is local and git-ignored. Do not duplicate its detail into `AGENTS.md`.