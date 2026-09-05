# Project Overview

An offline-first manga reader delivered as an Angular 20 PWA. Users import manga from local files, organize them as single-volume or multi-chapter entries, read them in several reading modes, bookmark pages, tag and search their library, and export manga back to files.

## Runtime parts

`web/` is the Angular client. It owns all application data in IndexedDB and works without network access after first load.

`server/` is an optional Express helper started manually (`start_server.bat` or `node server.js`, port 3000). It has no database. The client no longer calls it: MHTML import/export is fully streaming/incremental in-browser (Web Worker with a main-thread fallback) - see `export-import.md`.

## Technology

- Angular 20 standalone components with signals and `effect`; RxJS where streams already exist.
- Dexie over IndexedDB for persistence.
- Angular service worker, registered only when `isDevMode()` is false, with separate `ngsw-config.local.json` and `ngsw-config.gh.json`.
- Transloco for i18n, loaded over HTTP from `src/assets/i18n`.
- `fflate` for ZIP and CBZ; `DOMParser` plus custom quoted-printable decoding for MHTML.
- TypeScript `strict` with `strictTemplates`.

## Entry points and navigation

`src/main.ts` bootstraps `AppComponent` with `provideHttpClient`, `provideTransloco`, an app initializer calling `LanguageService.init()`, and `provideServiceWorker` only outside dev mode.

`AppComponent` renders `LayoutComponent` and the global loader, runs `SeedService.seedIfNeeded()`, and polls `SwUpdate` every 60 seconds. Seeding is inert because `USE_SEEDS` is `false`.

There is no router configuration. `@angular/router` is installed but no routes are provided. `LayoutComponent` selects the active screen from `UiStateService.currentView()`, which persists a `ViewMod` value in local storage. Navigation is state driven, not URL driven.