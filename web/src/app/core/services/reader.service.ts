import { Injectable, signal, computed, inject } from '@angular/core';
import { PageMeta } from 'src/app/shared/models/page-meta.model';
import { UiStateService } from './ui-state.service';


/**
 * Centralized state manager for Manga Reader.
 * Provides reactive signals for reader state and settings,
 * and methods to manipulate them.
 */
@Injectable({ providedIn: 'root' })
export class ReaderService {

  //  STATE 
  // TODO: save current manga info in uiState 
    //private uiState = inject(UiStateService);

  
  /** Current manga identifier */
  private _mangaId = signal<number | null>(null);

  /**
   * Chapter the user is currently reading.
   * Updated by the component when bookmark crosses a chapter boundary.
   * NEVER changed by mergePages - merge is invisible to this field.
   */
  private _chapterId = signal<number | null>(null);

  /**
   * Full pages buffer - grows as adjacent chapters are merged in.
   * Memory is managed by the component (cleanupFarImages + updateVisiblePages).
   * This array is NEVER trimmed here - trimming caused the "only 2 chapters" bug.
   */
  private _pages = signal<PageMeta[]>([]);

  /** Target page for scroll navigation */
  private _currentPageId = signal<number | undefined>(undefined);

  /** Bookmark tracking the last visible page (does not trigger scroll) */
  private _currentPageBookmark = signal<number | undefined>(undefined);

  /** Navigation trigger - forces scroll even if pageId didn't change */
  private _navTick = signal(0);

  /** Reader visibility state */
  private _isOpen = signal<boolean>(false);

  /**
   * Describes how the pages buffer was last updated.
   * Stored as a signal so component effects can reliably distinguish
   * a clean open from a seamless prev/next chapter merge.
   */
  private _pagesUpdateKind = signal<'open' | 'merge' | 'reset'>('reset');

  //  UI SETTINGS 

  /** Reading mode: 'scroll' | 'page' */
  private _mode = signal<'scroll' | 'page'>('scroll');

  /** Zoom level (1 = 100%) */
  private _zoom = signal<number>(1);

  /** Gap between pages in scroll mode (in px) */
  private _gap = signal<number>(0.5);

  //  COMPUTED 

  readonly isOpen              = computed(() => this._isOpen());
  readonly pages               = computed(() => this._pages());
  readonly mangaId             = computed(() => this._mangaId());
  readonly chapterId           = computed(() => this._chapterId());
  readonly currentPageId       = computed(() => this._currentPageId());
  readonly currentPageBookmark = computed(() => this._currentPageBookmark());
  readonly navTick             = computed(() => this._navTick());
  readonly pagesUpdateKind     = computed(() => this._pagesUpdateKind());
  readonly mode                = computed(() => this._mode());
  readonly zoom                = computed(() => this._zoom());
  readonly gap                 = computed(() => this._gap());

  //  SETTINGS 

  setSettings(settings: { mode?: 'scroll' | 'page'; zoom?: number; gap?: number }) {
    if (settings.mode !== undefined) this._mode.set(settings.mode);
    if (settings.zoom !== undefined) this._zoom.set(settings.zoom);
    if (settings.gap !== undefined) this._gap.set(settings.gap);
  }

  //  LIFECYCLE 

  /**
   * Open reader with fresh chapter data.
   * Resets all state including scroll position.
   */
  open(params: {
    mangaId: number;
    chapterId: number | null;
    pages: PageMeta[];
    currentPageId?: number;
    isOpen?: boolean;
  }): void {
    this._pagesUpdateKind.set('open');
    this._isOpen.set(params.isOpen ?? true);
    this._mangaId.set(params.mangaId);
    this._chapterId.set(params.chapterId);
    this._pages.set(params.pages);
    this._currentPageId.set(params.currentPageId);
    this._currentPageBookmark.set(params.currentPageId);
  }

  /** Close reader and reset all state */
  close(): void {
    this._pagesUpdateKind.set('reset');
    this._isOpen.set(false);
    this._mangaId.set(null);
    this._chapterId.set(null);
    this._pages.set([]);
    this._currentPageId.set(undefined);
    this._currentPageBookmark.set(undefined);
  }

  /**
   * Navigate to specific page inside reader.
   * Triggers scroll even if pageId is the same.
   */
  goToPage(pageId: number): void {
    this._currentPageId.set(pageId);
    this._navTick.update(v => v + 1);
  }

  /** Update current page id without triggering scroll */
  setCurrentPage(pageId: number): void {
    if(this._currentPageId() === pageId) return; // no update if pageId is the same
    
    this._currentPageId.set(pageId);
    //this.uiState.saveState({ lastPageId: pageId });
  }

  /** Update bookmark to the last observed visible page */
  setCurrentPageBookmark(pageId: number): void {
    this._currentPageBookmark.set(pageId);
  }

  /**
   * Update the active chapter id.
   * Called by the component when bookmark crosses a chapter boundary.
   */
  setChapterId(chapterId: number): void {
    this._chapterId.set(chapterId);
  }

  /* Reset after check if pages is valid */
  resetIsOpen() {
    this._isOpen.set(false);
  }

  /* Set pages */
  setPages(pages: PageMeta[]) {
    this._pages.set(pages);
  }

  /**
   * Seamlessly append or prepend pages from an adjacent chapter.
   *
   * For 'next': append new pages at the end of the buffer.
   * For 'prev': prepend new pages at the start of the buffer.
   *
   * The buffer is NEVER trimmed here - it only grows.
   * Memory cleanup is handled by the component via cleanupFarImages
   * and updateVisiblePages (which only renders a ~120 page window).
   *
   * The update kind is marked as `merge` before mutating the signal so the
   * component can reliably preserve scroll and skip clean-open reset logic.
   */
  mergePages(newPages: PageMeta[], direction: 'next' | 'prev'): void {
    const current    = this._pages();
    const currentIds = new Set(current.map(p => p.id));

    // filter duplicates - pages already in buffer are skipped
    const fresh = newPages.filter(p => !currentIds.has(p.id));
    if (!fresh.length) return;

    const merged = direction === 'next'
      ? [...current, ...fresh]   // append at end
      : [...fresh, ...current];  // prepend at start

    this._pagesUpdateKind.set('merge');
    this._pages.set(merged);
  }

  /** Returns current state snapshot (for imperative use only) */
  getSnapshot() {
    return {
      mangaId:             this._mangaId(),
      chapterId:           this._chapterId(),
      pages:               this._pages(),
      currentPageId:       this._currentPageId(),
      currentPageBookmark: this._currentPageBookmark(),
      isOpen:              this._isOpen(),
    };
  }
}