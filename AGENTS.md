# AGENTS.md

MangaOfflineViewer is an offline-first Angular 20 PWA that stores manga locally in the browser.
`web/` is the application and owns all data. `server/` is an optional Node helper that only speeds up MHTML parsing.

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
- MHTML import must keep its local Web Worker fallback for when the helper server is unreachable.
- Chapter and page order are persisted fields (`Chapter.order`, `Page.chapterOrder`, `Page.order`), not filename or archive order.
- Import and export formats are user-facing compatibility surfaces. Files produced by older versions must keep importing.

## Rules

- Make the smallest change at the existing owner. Search for an existing service, repository, or shared helper before adding an abstraction.
- Do not change a persisted entity, index, or ordering field without checking `manga-db.ts` versions and migrations plus the repositories that query them.
- Do not introduce a second source of truth for state already owned by `TabsService`, `ReaderService`, or `UiStateService`.
- Do not refactor unrelated code, weaken types, or silence compiler errors instead of fixing them.
- Reader runtime code is timing sensitive. Read `web/src/app/features/reader/README.md` before changing scrolling, virtualization, navigation, or image loading.
- Treat imported files as untrusted input. Do not introduce unsanitized HTML rendering or bypass Angular sanitization.

## Verification

Run `npx ng build` from `web/`, then review `git status --short` and `git diff --check`. Do not revert unrelated work.