import { Injectable, signal, computed } from '@angular/core';
import { PageMeta } from 'src/app/shared/models/page-meta.model';
import { isIOS } from 'src/app/shared/utils/constants';
import { ReadingMode } from '../../features/reader/engine/interfaces/reader-settings.interface';

/**
 * Reader state store.
 */
@Injectable({ providedIn: 'root' })
export class ReaderService {

  private _mangaId = signal<number | null>(null);

  // Updated from viewport tracking, not from mergePages.
  private _chapterId = signal<number | null>(null);

  // Full page buffer grows when adjacent chapters are merged.
  private _pages = signal<PageMeta[]>([]);

  private _currentPageId = signal<number | undefined>(undefined);

  // Last visible page marker. Does not trigger navigation.
  private _currentPageBookmark = signal<number | undefined>(undefined);

  // Increments on navigation so effects rerun even for same page id.
  private _navTick = signal(0);

  private _isOpen = signal<boolean>(false);

  // Helps component distinguish open flow from merge flow.
  private _pagesUpdateKind = signal<'open' | 'merge' | 'reset'>('reset');

  private _mode = signal<ReadingMode>('scroll');

  private _gap = signal<number>(0.5);

  // Other settings
  private _debug = signal<boolean>(false);

  readonly isOpen = computed(() => this._isOpen());
  readonly pages = computed(() => this._pages());
  readonly mangaId = computed(() => this._mangaId());
  readonly chapterId = computed(() => this._chapterId());
  readonly currentPageId = computed(() => this._currentPageId());
  readonly currentPageBookmark = computed(() => this._currentPageBookmark());
  readonly navTick = computed(() => this._navTick());
  readonly pagesUpdateKind = computed(() => this._pagesUpdateKind());
  readonly mode = computed(() => this._mode());
  readonly gap = computed(() => this._gap());
  readonly debug = computed(() => this._debug());

  setSettings(settings: {
    mode?:      ReadingMode;
    gap?:       number;
  }): void {
    if (settings.mode !== undefined) this._mode.set(settings.mode);
    if (settings.gap !== undefined) this._gap.set(settings.gap);
  }

  setOtherSettings(settings: {
    debug?: boolean;
  }): void {
    if (settings.debug !== undefined) this._debug.set(settings.debug);
  }

  /** Opens reader with fresh chapter data. */
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

  /** Closes reader and clears state. */
  close(): void {
    this._pagesUpdateKind.set('reset');
    this._isOpen.set(false);
    this._mangaId.set(null);
    this._chapterId.set(null);
    this._pages.set([]);
    this._currentPageId.set(undefined);
    this._currentPageBookmark.set(undefined);
  }

  /** Navigates to page and forces nav effect. */
  goToPage(pageId: number): void {
    this._currentPageId.set(pageId);
    this._currentPageBookmark.set(pageId);
    this._navTick.update(v => v + 1);
  }

  /** Updates current page marker without navigation side effects. */
  setCurrentPage(pageId: number): void {
    if(this._currentPageId() === pageId) return;
    this._currentPageId.set(pageId);
  }

  /** Updates bookmark marker for current viewport page. */
  setCurrentPageBookmark(pageId: number): void {
    if (this._currentPageBookmark() !== pageId)
      this._currentPageBookmark.set(pageId);
  }

  /** Updates active chapter inferred from visible page. */
  setChapterId(chapterId: number): void {
    console.warn('[setChapterId]', { from: this._chapterId(), to: chapterId,
      stack: new Error().stack?.split('\n').slice(1,6).join(' | ') });
    this._chapterId.set(chapterId);
  }

  /** Marks open flag as consumed by UI flow. */
  resetIsOpen() {
    this._isOpen.set(false);
  }

  /** Replaces full pages buffer. */
  setPages(pages: PageMeta[]) {
    this._pages.set(pages);
  }

  /**
   * Merges adjacent chapter pages into existing buffer.
   * Buffer only grows here, trimming is handled in component render window.
   */
  mergePages(newPages: PageMeta[], direction: 'next' | 'prev'): void {
    const current = this._pages();
    const currentIds = new Set(current.map(p => p.id));

    // Skip pages that already exist in buffer.
    const fresh = newPages.filter(p => !currentIds.has(p.id));
    if (!fresh.length) return;

    const merged = direction === 'next'
      ? [...current, ...fresh]
      : [...fresh, ...current];

    this._pagesUpdateKind.set('merge');
    this._pages.set(merged);
  }

  /** Returns current state snapshot. */
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