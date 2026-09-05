# Architecture

## Subsystems

### Persistence

`core/database/manga-db.ts` defines the Dexie database `mangaDB` with tables `tabs`, `pages`, `bookmarks`, `chapters`, `userTabs`, `artists`, `tags`, and schema versions 1 through 15. `core/models` holds the entity interfaces. `core/repositories` holds all query and write code and is the only place that touches `db` directly. Source of truth is IndexedDB.

### Library and selection

`TabsService` (root) owns the library list, paging, search filtering, preview URLs, the active tab, and the `open()` flow that loads pages and hands them to the reader. It is the entry point for opening a manga or chapter.

### Reader state

`ReaderService` (root) is a signal store for the active manga, active chapter, the full page buffer, current page, bookmark marker, reading mode, gap, and a navigation tick. It never loads data itself; callers supply pages.

### Reader runtime

`features/reader/reader-component/reader.component.ts` with `features/reader/engine/*` renders the reader. `VirtualizationEngineService` owns the sliding render window (`WINDOW = 60`, `JUMP_THRESHOLD = 50`). `ImagePipelineService` owns lazy payload loading, the blob URL cache keyed by page id, image loading with a 12 second timeout, and eviction. `ScrollControllerService` owns scroll math and anchor selection. `GestureEngineService` owns touch gestures. `SettingsStoreService` owns reader settings and persists them through `UiStateService`. `DeviceCapabilitiesService` exposes capability signals.

### UI state

`UiStateService` (root) owns current view, selected manga, sidebar, window visibility, opened chapters, reader setting values, and update availability, persisted to the local storage key `ui-state`.

### Draft editing

`MangaDraftService` (root) holds an unsaved manga edit and mirrors it to local storage key `manga_draft` with a 300 ms debounce. `ChaptersListService` holds chapter list state plus an uncommitted `pendingOrder` draft. `BookmarksService` holds a chapter to bookmark lookup.

`ChaptersListService` and `BookmarksService` are declared `@Injectable()` without `providedIn: 'root'` and are provided by `MangaPageComponent`. They are component-scoped, so a new consumer must live inside that provider scope or declare its own.

### Import

`shared/components/molv-drop-uploader` is the single import surface for ZIP, CBZ, MHTML, and plain images. It converts input into `Page` objects held in a local `items` signal and persists them through `TabsRepository`. Parent windows drive it through `saveAll$` and `clearAll$` subjects.

### Export

`ExportService` (root) writes ZIP, CBZ, and MHTML. For chapter-mode manga it reloads the complete ordered structure from `ChaptersRepository` and `PagesRepository` instead of trusting the caller's page list.

### MHTML/ZIP streaming

`MhtmlExtractorService` (root) creates the module worker `app.worker.ts`, which runs the incremental scanner in `mhtml-stream-scanner.ts` off the main thread; it no longer calls the optional helper server (that integration was removed). ZIP/CBZ import reads entries on demand via `zip-random-access.ts`. See `export-import.md` for the full architecture, format details, and memory model.

## Dependency boundaries

Observed direction:

- `core/database` imports `core/models` and one shared util. It imports nothing from features.
- `core/repositories` import `core/database`, `core/models`, shared utils, and shared contracts.
- `core/services` import repositories, models, shared code, and other services.
- `features` import core and shared.
- `shared` imports core models and core services, and never imports features.

Exceptions that already exist in the code. Treat them as the local convention, not as violations to fix during unrelated work:

- Components inject repositories directly rather than going through a service: `ChapterItemComponent`, `MolvDropUploaderComponents`, `ReaderComponent`, `ReaderWrapperComponent`, `ReaderSettingsWindowComponent`, `MangaPageComponent`.
- `shared/components/molv-drop-uploader` performs persistence and archive parsing although it lives in `shared`.
- `features/reader/engine` holds root-provided services inside a feature folder, and `ImagePipelineService` there injects `PagesRepository` directly.
- `shared/models/page-meta.model.ts` defines the persisted page shape, so a persisted structure lives in `shared` and not only in `core/models`.

## Source of truth

| Data | Authoritative | Derived | Temporary |
| --- | --- | --- | --- |
| Manga entry | `tabs` table | `TabsService.tabsState`, preview URLs | `MangaDraftService` draft |
| Chapters | `chapters` table | `ChaptersListService.chapters` | `ChaptersListService.pendingOrder` |
| Pages and image payloads | `pages` table, `src` is a Blob or a data URL on iOS | `PageMeta` projections, uploader thumbnails | blob URLs in `ImagePipelineService` and `ObjectUrlService` |
| Chapter order | `Chapter.order` | `Page.chapterOrder` mirror | pending reorder draft |
| Page order within a chapter | `Page.order` | reader buffer index, `pageIndexMap` | virtualized window slice |
| Manga mode | `Tab.mode` | `UiStateService.currentView()` | none |
| Reading position | `ReaderService` signals, `bookmarks` table | observer derived anchors | scroll offsets |
| UI state | local storage `ui-state` via `UiStateService` | component fields initialized from it | none |
| Imported content | uploader `Page` objects, then IndexedDB after save | uploader thumbnails | captured metadata held until save |
| Exported content | IndexedDB read at export time | the written ZIP or MHTML | none |

`Page.chapterOrder` is a denormalized copy of `Chapter.order` that exists so `[tabId+chapterOrder+order]` returns a whole manga in reading order in one query. `Chapter.order` wins on conflict.

## Invariants

**Chapter and page ordering.** `Chapter.order` is sequential from 1 per tab. `Page.chapterOrder` must equal the order of the chapter referenced by `Page.chapterId`, and `Page.order` is sequential within its chapter. `ChaptersRepository.reorder()` rewrites both sides in one transaction. Breaking the mirror makes `PagesRepository.getAll` and `getByChapterOrder` return pages in the wrong order or skip them, and the reader loads the wrong chapter.

**Compound index availability.** Ordering queries rely on `[tabId+chapterOrder+order]`, `[tabId+chapterId]`, and `[tabId+order]`. Removing or renaming an indexed field without a new Dexie version silently breaks those queries against existing user databases.

**Schema versions are append-only.** Users hold live databases at version 15. Editing a released `version(n).stores(...)` block instead of adding a new one corrupts upgrades. Migrations must be additive and must not delete user content.

**Blob URL ownership.** `ObjectUrlService` caches by string key, and `ImagePipelineService` caches by page id and delegates revocation to it. Creating a URL outside these owners leaks memory; revoking one directly leaves a stale cache entry that later returns a dead URL.

**iOS payload duality.** When `isIOS` is true, pages store data URL strings instead of Blobs and `ObjectUrlService.createUrl` returns the string unchanged. Code that assumes `src instanceof Blob` breaks on iOS.

**Reader guard flags.** `isNavigating`, `isPrepending`, and `isRestoringScroll`, plus `loadToken` and `navToken`, stop the intersection observer from overwriting the reading position during merges and restores. Reordering or removing these guards reintroduces viewport jumps and stuck loaders.

**Offline operation.** No normal user flow may require the helper server or any network call. The service worker caches assets only.

**Import compatibility.** Files without structure metadata are valid legacy input and must import through the existing image-only path.