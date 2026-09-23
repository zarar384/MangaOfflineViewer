import { Component, computed, effect, HostListener, Input, OnDestroy, OnInit, signal } from '@angular/core';
import { FileFormat } from 'src/app/shared/enums/file-format';
import { ReaderSettingsWindowComponent } from '../../windows/reader-settings-window/reader-settings-window.component';
import { CommonModule } from '@angular/common';
import { ReaderComponent } from '../reader-component/reader.component';
import { ReaderHudComponent } from '../reader-hud/reader-hud.component';
import { UiStateService } from '../../../core/services/ui-state.service';
import { ExportService } from '../../../core/services/export.service';
import { LoadingService } from '../../../core/services/loading.service';
import { ReaderService } from '../../../core/services/reader.service';
import { BookmarksRepository } from 'src/app/core/repositories/bookmark.repository';
import { TabsService } from 'src/app/core/services/tabs.service';
import { ReadingMode } from '../engine/interfaces/reader-settings.interface';

@Component({
  selector: 'app-manga-reader',
  standalone: true,
  imports: [ReaderComponent, ReaderHudComponent, ReaderSettingsWindowComponent, CommonModule],
  templateUrl: './reader-wrapper.component.html',
  styleUrl: './reader-wrapper.component.css'
})
export class ReaderWrapperComponent implements OnInit, OnDestroy {

  @Input() activeManga: number | null = null;

  gap = 0.5;
  mode: ReadingMode = 'scroll';
  downloadMod: FileFormat = FileFormat.MHTML;

  readonly hudVisible = signal(true);
  readonly currentPageBookmarked = signal(false);
  readonly bookmarkPending = signal(false);

  private readonly currentPageMeta = computed(() => {
    const pageId = this.reader.currentPageBookmark() ?? this.reader.currentPageId();
    if (pageId == null) return null;

    return this.reader.pages().find(page => page.id === pageId) ?? null;
  });

  // Adjacent chapters are preloaded into the same buffer, so progress must
  // stay scoped to the chapter of the currently visible page.
  private readonly currentPageScope = computed(() => {
    const currentPage = this.currentPageMeta();
    if (!currentPage) return [];

    const pages = this.reader.pages();
    if (currentPage.chapterId == null) return pages;

    return pages.filter(page => page.chapterId === currentPage.chapterId);
  });

  readonly currentPageNumber = computed(() => {
    const currentPage = this.currentPageMeta();
    if (!currentPage) return 0;

    if (currentPage.order != null) return currentPage.order;

    const index = this.currentPageScope().findIndex(page => page.id === currentPage.id);
    return index >= 0 ? index + 1 : 0;
  });

  readonly currentPageTotal = computed(() => this.currentPageScope().length);

  readonly currentChapterOrder = computed(() => {
    const currentPage = this.currentPageMeta();
    return currentPage?.chapterId != null
      ? currentPage.chapterOrder ?? null
      : null;
  });

  private readonly HUD_HIDE_DELAY_MS = 3500;
  private hudHideTimer: ReturnType<typeof setTimeout> | null = null;
  private hudLastActivity = Date.now();
  private hudInteractionActive = false;
  private bookmarkLookupToken = 0;

  get showSettingsWindow() {
    return this.uiState.readerSettingsWindow();
  }

  constructor(
    private tabsService: TabsService,
    private bookmarksRepo: BookmarksRepository,
    private uiState: UiStateService,
    private exportService: ExportService,
    private loading: LoadingService,
    private reader: ReaderService
  ) {
    effect(() => {
      const mangaId = this.reader.mangaId();
      const pageId = this.currentPageMeta()?.id ?? null;

      void this.loadBookmarkState(mangaId, pageId);
    });
  }

  ngOnInit(): void {
    // Restore reader UI settings from last session.
    this.gap = this.uiState.getValue<number>('readerGap') || 0.5;
    this.mode = this.uiState.getValue<ReadingMode>('readerMode') || 'scroll';
    this.downloadMod = this.uiState.getValue<FileFormat>('downloadMod') || FileFormat.MHTML;

    // Apply restored settings right away so reader opens in the same state.
    this.reader.setSettings({ gap: this.gap, mode: this.mode });

    this.onReaderActivity();
  }

  ngOnDestroy(): void {
    this.bookmarkLookupToken++;
    this.clearHudHideTimer();
  }

  goToBookmark = async (bookmarkId: number | string) => {
    const id = Number(bookmarkId);

    const bm = await this.bookmarksRepo.get(id);
    if (!bm) return;

    this.reader.goToPage(bm.pageId);
  }

  onSettingsWindowHide() {
    this.uiState.setReaderSettingsWindow(false);

    void this.loadBookmarkState(
      this.reader.mangaId(),
      this.currentPageMeta()?.id ?? null
    );

    this.releaseHud();
  }

  openReaderSettings(): void {
    this.holdHud();
    this.uiState.setReaderSettingsWindow(true);
  }

  onReaderActivity(): void {
    this.hudLastActivity = Date.now();
    this.hudVisible.set(true);
    this.scheduleHudHide();
  }

  @HostListener('document:keydown')
  onReaderKeyboardActivity(): void {
    if (!this.showSettingsWindow) {
      this.onReaderActivity();
    }
  }

  holdHud(): void {
    this.hudInteractionActive = true;
    this.hudVisible.set(true);
    this.clearHudHideTimer();
  }

  releaseHud(): void {
    this.hudInteractionActive = false;
    this.onReaderActivity();
  }

  async toggleCurrentPageBookmark(): Promise<void> {
    const mangaId = this.reader.mangaId();
    const page = this.currentPageMeta();

    if (!mangaId || page?.id == null || this.bookmarkPending()) return;

    const pageId = page.id;
    const lookupToken = ++this.bookmarkLookupToken;
    this.bookmarkPending.set(true);

    try {
      const bookmark = await this.bookmarksRepo.getByPage(mangaId, pageId);

      if (bookmark?.id != null) {
        await this.bookmarksRepo.delete(bookmark.id);
      } else {
        await this.bookmarksRepo.put({
          tabId: mangaId,
          pageId,
          chapterId: page.chapterId ?? null,
          createdAt: Date.now(),
          title: this.getBookmarkTitle()
        });
      }

      // Ignore a slower result if the reader already moved to another page.
      if (lookupToken === this.bookmarkLookupToken && this.currentPageMeta()?.id === pageId) {
        this.currentPageBookmarked.set(bookmark == null);
      }
    } catch (err) {
      console.error('Failed to toggle bookmark', err);
    } finally {
      this.bookmarkPending.set(false);
      this.onReaderActivity();
    }
  }

  async onExportButtonClicked(format: FileFormat) {
    if (this.activeManga === null) return;

    try {
      this.loading.show();

      const tab = await this.tabsService.getTabById(this.activeManga);
      if (!tab) return;

      await this.exportService.exportManga(tab, format);

      console.log(`Manga exported as ${format}`);

    } catch (err) {
      console.error(`Error exporting manga as ${format}`, err);
    } finally {
      this.loading.hide();
    }
  }

  private async loadBookmarkState(mangaId: number | null, pageId: number | null): Promise<void> {
    const lookupToken = ++this.bookmarkLookupToken;

    if (!mangaId || pageId == null) {
      this.currentPageBookmarked.set(false);
      return;
    }

    try {
      const bookmark = await this.bookmarksRepo.getByPage(mangaId, pageId);

      if (lookupToken === this.bookmarkLookupToken) {
        this.currentPageBookmarked.set(bookmark != null);
      }
    } catch (err) {
      console.error('Failed to load bookmark state', err);
    }
  }

  private getBookmarkTitle(): string {
    const pageNumber = this.currentPageNumber();
    const chapterOrder = this.currentChapterOrder();

    return chapterOrder == null
      ? `${pageNumber}`
      : `${chapterOrder} - ${pageNumber}`;
  }

  private scheduleHudHide(): void {
    if (this.hudHideTimer || this.hudInteractionActive) return;

    // Keep one timer. Pointer movement only updates the last activity time,
    // so the reader does not create a new timeout for every mouse event.
    const elapsed = Date.now() - this.hudLastActivity;
    const delay = Math.max(0, this.HUD_HIDE_DELAY_MS - elapsed);

    this.hudHideTimer = setTimeout(() => {
      this.hudHideTimer = null;

      if (this.hudInteractionActive) return;

      const remaining = this.HUD_HIDE_DELAY_MS - (Date.now() - this.hudLastActivity);
      if (remaining > 0) {
        this.scheduleHudHide();
        return;
      }

      this.hudVisible.set(false);
    }, delay);
  }

  private clearHudHideTimer(): void {
    if (!this.hudHideTimer) return;

    clearTimeout(this.hudHideTimer);
    this.hudHideTimer = null;
  }
}
