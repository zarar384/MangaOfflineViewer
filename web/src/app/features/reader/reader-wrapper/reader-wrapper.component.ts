import { Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { ReaderSettingsWindowComponent } from '../../windows/reader-settings-window/reader-settings-window.component';
import { CommonModule } from '@angular/common';
import { ReaderComponent } from '../reader-component/reader.component';
import { PagesRepository } from 'src/app/core/repositories/pages.repository';
import { Page } from 'src/app/core/models/page.model';
import { numericNameSort } from 'src/app/shared/utils/file-parsing';
import { UiStateService } from 'src/app/core/services/ui-state.service';
import { ExportService } from 'src/app/core/services/export.service';
import { TabsRepository } from 'src/app/core/repositories/tabs.repository';
import { LoadingService } from 'src/app/core/services/loading.service';
import { BookmarksRepository } from 'src/app/core/repositories/bookmark.repository';
import { Bookmark } from 'src/app/core/models/bookmark';
import { ReaderService } from 'src/app/core/services/reader.service';

@Component({
  selector: 'app-manga-reader',
  standalone: true,
  imports: [ReaderComponent, ReaderSettingsWindowComponent, CommonModule],
  templateUrl: './reader-wrapper.comoponent.html',
  styleUrl: './reader-wrapper.comoponent.css'
})
export class ReaderWrapperComoponent implements OnInit, OnChanges {

  @Input() activeManga: number | null = null;

  // Local state (for UI)
  pages: Page[] = [];
  bookmarks: Bookmark[] = [];

  gap = 0.5;
  mode: 'scroll' | 'page' = 'scroll';
  zoom = 1;
  downloadMod: 'mhtml' | 'zip' = 'mhtml';

  showSettingsWindow = true;
  selectedBookmarkId: number | null = null;

  constructor(
    private pagesRepo: PagesRepository,
    private tabsRepo: TabsRepository,
    private bookmarksRepo: BookmarksRepository,
    private uiState: UiStateService,
    private exportService: ExportService,
    private loading: LoadingService,
    private reader: ReaderService
  ) {}

  ngOnInit(): void {
     // Restore UI settings from previous session
    this.gap = this.uiState.getValue<number>('readerGap') || 0.5;
    this.mode = this.uiState.getValue<'scroll' | 'page'>('readerMode') || 'scroll';
    this.zoom = this.uiState.getValue<number>('readerZoom') || 1;
    this.downloadMod = this.uiState.getValue<'mhtml' | 'zip'>('downloadMod') || 'mhtml';

    this.loadPages();
    this.loadBookmarks();
  }

  ngOnChanges(changes: SimpleChanges): void {
     // reload data when manga changes
    if (changes['activeManga'] && !changes['activeManga'].firstChange) {
      this.loadPages();
      this.loadBookmarks();
    }
  }


  async loadPages() {
    if (!this.activeManga) return;

    try {
      const pages = await this.pagesRepo.getAll(this.activeManga);

      const sorted = pages.sort((a, b) =>
        numericNameSort(`${a}`, `${b}`)
      );

      this.pages = sorted;

      // Update reader state with new pages
      this.reader.setPages(sorted);

    } catch (err) {
      console.error('Error loading pages', err);
    }
  }

  async loadBookmarks(newSelectedId?: number) {
    if (!this.activeManga) return;

    try {
      const bookmarks = await this.bookmarksRepo.getAll(this.activeManga);

      this.bookmarks = bookmarks.sort((a, b) =>
        numericNameSort(`${a}`, `${b}`)
      );

      if (newSelectedId) {
        this.selectedBookmarkId = newSelectedId;
      }

    } catch (err) {
      console.log(`Error loading bookmarks for ${this.activeManga}`, err);
    }
  }

 // SETTINGS WINDOW: MAIN
  get pageNumbers(): { id: number, number: number }[] {
    return (this.pages ?? [])
      .map(p => ({ id: p.id, number: p.pageNumber }))
      .filter((p): p is { id: number, number: number } => p.id !== undefined);
  }

  goToPage(pageNumber: number) {
    const pageId = this.pages.find(p => p.pageNumber === pageNumber)?.id;
    if (!pageId) return;

    this.reader.goToPage(pageId);
  }

  goToBookmark(bookmarkId: number) {
    const bm = this.bookmarks.find(b => b.id === +bookmarkId);
    if (!bm) return;

    this.reader.goToPage(bm.pageId);
  }

  // SETTINGS WINDOW: BOOKMARKS
  async saveBookmark() {
    if (!this.activeManga) return;

    // Get current page from reader state
    const pageId = this.reader.getSnapshot().startPageId;
    if (!pageId) return;

    // Load all bookmarks for current manga
    try {
      const page = this.pages.find(p => p.id === pageId);
      if (!page || page.pageNumber === undefined) return;

      const newBookmarkId = await this.bookmarksRepo.put({
        tabId: this.activeManga,
        pageId,
        createdAt: Date.now(),
        title: `Page ${page.pageNumber}`
      });

      await this.loadBookmarks(Number(newBookmarkId));

    } catch (err) {
      console.log('Error while saving bookmark', err);
    }
  }

  // SETTINGS WINDOW: VISUAL
  onSettingsWindowHide() {
    this.showSettingsWindow = false;
  }

  // SETTINGS WINDOW: EXPORT
  async onExportButtonClicked(format: 'mhtml' | 'zip') {
    if (this.activeManga === null) return;

    try {
      this.loading.show();

      const tab = await this.tabsRepo.get(this.activeManga);
      if (!tab) return;

      await this.exportService.exportManga(tab, this.pages, format);

      console.log(`Manga exported as ${format}`);

    } catch (err) {
      console.error(`Error exporting manga as ${format}`, err);
    } finally {
      this.loading.hide();
    }
  }
}