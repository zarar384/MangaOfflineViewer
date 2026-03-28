import { Injectable, signal, computed } from '@angular/core';
import { Page } from '../models/page.model';

// Centralized state manager for Manga Reader.
// Provides reactive signals for reader state and settings, and methods to manipulate them.
@Injectable({ providedIn: 'root' })
export class ReaderService {

  // STATES

  /** Current manga identifier */
  private _mangaId = signal<number | null>(null);

  /** Current chapter identifier */
  private _chapterId = signal<number | null>(null);

  /** Pages of the current chapter */
  private _pages = signal<Page[]>([]);

  /** Target current page for navigation (scroll target) */
  private _currentPageId = signal<number | undefined>(undefined);
  /** Navigation trigger to force scroll even if pageId doesn't change */
  private _navTick = signal(0);

  /** Reader visibility state */
  private _isOpen = signal<boolean>(false);

  // UI SETTINGS (not persisted, can be reset on each open)

  /** Reading mode: 'scroll' or 'page' */
  private _mode = signal<'scroll' | 'page'>('scroll');

  /** Zoom level (e.g., 1 = 100%) */
  private _zoom = signal<number>(1);

  /** Gap between pages in 'scroll' mode (in rem) */
  private _gap = signal<number>(0.5);

  // COMPUTED 

  /** Indicates whether reader is currently open */
  readonly isOpen = computed(() => this._isOpen());

  /** Returns current pages */
  readonly pages = computed(() => this._pages());

  /** Returns current manga id */
  readonly mangaId = computed(() => this._mangaId());

  /** Returns current chapter id */
  readonly chapterId = computed(() => this._chapterId());

  /** Returns page id that should be focused */
  readonly currentPageId = computed(() => this._currentPageId());

  /** Returns current navigation trigger value */
  readonly navTick = computed(() => this._navTick());

  /** Returns current reading mode */
  readonly mode = computed(() => this._mode());

  /** Returns current zoom level */
  readonly zoom = computed(() => this._zoom());

  /** Returns current gap between pages */
  readonly gap = computed(() => this._gap());

  setSettings(settings: {
    mode?: 'scroll' | 'page';
    zoom?: number;
    gap?: number;
  }) {
    if (settings.mode !== undefined) this._mode.set(settings.mode);
    if (settings.zoom !== undefined) this._zoom.set(settings.zoom);
    if (settings.gap !== undefined) this._gap.set(settings.gap);
  }

  /**
   * Open reader with provided data
   *
   * @param mangaId - parent manga identifier
   * @param chapterId - chapter identifier
   * @param pages - full list of pages
   * @param currentPageId - optional page to scroll to
   */
  open(params: {
    mangaId: number;
    chapterId: number;
    pages: Page[];
    currentPageId?: number;
  }): void {
    this._mangaId.set(params.mangaId);
    this._chapterId.set(params.chapterId);
    this._pages.set(params.pages);
    this._currentPageId.set(params.currentPageId);
    this._isOpen.set(true);
  }

  // Close reader and reset state
  close(): void {
    this._isOpen.set(false);
    this._mangaId.set(null);
    this._chapterId.set(null);
    this._pages.set([]);
    this._currentPageId.set(undefined);
  }

  /**
   * Navigate to specific page inside reader
   *
   * @param pageId - target page identifier
   */
  goToPage(pageId: number): void {
    if(pageId === this._currentPageId())  return; // no need to navigate if already on target page
    // if (!this._isOpen()) return;
    this._currentPageId.set(pageId);
    this._navTick.update(v => v + 1); // trigger navigation even if pageId is the same
  }

  /**
   * Replace current pages (e.g., when switching chapter)
   *
   * @param pages - new pages list
   * @param chapterId - optional new chapter id
   */
  setPages(pages: Page[], chapterId?: number): void {
    this._pages.set(pages);

    if (chapterId !== undefined) {
      this._chapterId.set(chapterId);
    }
  }

  // Returns current state snapshot (for imperative use only)
  getSnapshot() {
    return {
      mangaId: this._mangaId(),
      chapterId: this._chapterId(),
      pages: this._pages(),
      currentPageId: this._currentPageId(),
      isOpen: this._isOpen()
    };
  }
}