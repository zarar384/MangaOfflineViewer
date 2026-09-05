# Project Structure

## Root

- `web/` Angular application.
- `server/` optional MHTML helper (no longer called by the client - see `export-import.md`): `server.js` endpoints, `mhtmlParser.js` and `utils.js` parsing, `temp/` chunk scratch space.
- `start_server.bat` launches the helper with a hardcoded Node path and logs into `logs/`.
- `docs/images/` README media only, not application assets.
- `README.md` system overview written for humans.
- `AGENTS.md` committed agent instructions.

## `web/src/app/core`

Application-wide data and workflows.

- `database/` Dexie schema and migrations, only `manga-db.ts`. Nothing else belongs here.
- `db.config.ts` database name, store name constants, `PREVIEW_MAX_SIZE`, `USE_SEEDS`.
- `models/` entity interfaces mapped to Dexie tables: `tab.model.ts`, `chapter.model.ts`, `page.model.ts`, `bookmark.ts`, `usertab.ts`, `artist.model.ts`, `tag.model.ts`. Do not put UI-only types or file-format contracts here.
- `repositories/` all Dexie access, ordering queries, cascades, and transactions. Seed constants also live here.
- `services/` signal stores and workflows, root-provided unless noted in architecture.md.

## `web/src/app/features`

Screens and feature-specific behavior.

- `layout/` chooses the active screen from UI state and hosts windows and sidebar.
- `home/` library grid, paging, search.
- `manga-page/` manga details and chapter list editing; provides `ChaptersListService` and `BookmarksService`.
- `navbar/`, `sidebar/` navigation surfaces.
- `windows/` modal windows including upload, edit tab, settings, and reader settings.
- `reader/` reader component, `reader-wrapper/` shell that triggers export, `engine/` reader-only services, and `README.md` describing the runtime flow.

## `web/src/app/shared`

Reusable code.

- `components/` reusable controls prefixed `molv-` or `movl-`, including the drop uploader.
- `models/` shapes used across features: `page-meta.model.ts` (the persisted page shape without its payload), `item-meta.model.ts`, `search-token.model.ts`, and `manga-structure-metadata.ts` (export/import contract). Not every file here is non-persisted.
- `enums/` `ViewMod`, `FileFormat`, and similar value sets.
- `utils/` stateless helpers: `file-parsing.ts`, `preview.ts`, `constants.ts`, and `manga-structure-metadata.ts` validation.
- `styles/` CSS registered globally in `angular.json`.

## `web/src` configuration

- `main.ts` bootstrap and providers, `polyfills.ts`, `index.html`, `styles.css`.
- `app.worker.ts` MHTML worker, compiled through `tsconfig.worker.json` and excluded from `tsconfig.json`.
- `assets/` icons, images, per-environment PWA manifests, `i18n/` translations, `assets.config.ts`.
- `angular.json` defines `build`, `serve`, and `deploy` only. `ngsw-config.local.json` and `ngsw-config.gh.json` configure the service worker. `cheatsheet.txt` is the maintained command reference.

## Naming

Entities use singular names. Files use `*.model.ts`, `*.repository.ts`, `*.service.ts`, and `*.component.ts`, with pre-existing exceptions such as `bookmark.ts`, `usertab.ts`, and `molv-drop-uploader.components.ts`. Follow the closest existing neighbor instead of renaming existing files.