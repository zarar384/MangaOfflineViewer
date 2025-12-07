import { Component, Input, OnChanges, OnInit, SimpleChanges, ViewChild } from '@angular/core';
import { ReaderSettingsWindowComponent } from '../../windows/reader-settings-window/reader-settings-window.component';
import { CommonModule } from '@angular/common';
import { ReaderComponent } from '../reader-component/reader.component';
import { PagesRepository } from 'src/app/core/repositories/pages.repository';
import { Page } from 'src/app/core/models/page.model';
import { numericNameSort } from 'src/app/shared/utils/file-parsing';
import { UiStateService } from 'src/app/core/services/ui-state.service';
import { ExportService } from 'src/app/core/services/export.service';
import { TabsRepository } from 'src/app/core/repositories/tabs.repository';
import { firstValueFrom } from 'rxjs';
import { Tab } from 'src/app/core/models/tab.model';
import { LoadingService } from 'src/app/core/services/loading.service';
import { BookmarksRepository } from 'src/app/core/repositories/bookmark.repository';
import { Bookmark } from 'src/app/core/models/bookmark';

@Component({
  selector: 'app-manga-reader',
  imports: [ReaderComponent, ReaderSettingsWindowComponent, CommonModule],
  templateUrl: './reader-wrapper.comoponent.html',
  styleUrl: './reader-wrapper.comoponent.css',
  standalone: true
})
export class ReaderWrapperComoponent implements OnInit, OnChanges {
  @Input() activeManga: number | null = null;;

  pages: Page[] = [];
  gap = 0.5;
  mode: 'scroll' | 'page' = 'scroll';
  downloadMod: 'mhtml' | 'zip' = 'mhtml';
  zoom = 1;
  showSettingsWindow = true;
  bookmarks: Bookmark[] = [];
  selectedBookmarkId: number | null = null;

  @ViewChild(ReaderComponent) readerRef!: ReaderComponent;

  constructor(private pagesRepo: PagesRepository, private tabsRepo: TabsRepository, private bookmarksRepo: BookmarksRepository,
    private uiState: UiStateService, private exportService: ExportService, private loading: LoadingService) { }

  ngOnInit(): void {
    this.gap = this.uiState.getValue<number>('readerGap') || 0.5;
    this.mode = this.uiState.getValue<'scroll' | 'page'>('readerMode') || 'scroll';
    this.zoom = this.uiState.getValue<number>('readerZoom') || 1;
    this.downloadMod = this.uiState.getValue<'mhtml' | 'zip'>('downloadMod') || 'mhtml';

    this.loadPages();
    this.loadBookmarks();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['activeManga'] && !changes['activeManga'].firstChange) {
      this.loadPages();
      this.loadBookmarks();
    }
  }

  loadPages() {
    if (!this.activeManga) return;

    this.pagesRepo.getByTab(this.activeManga)
      .subscribe({
        next: pages => {
          this.pages = pages.sort((a, b) => numericNameSort(`${a}`, `${b}`));
        },
        error: err => console.error('Error loading pages', err)
      });
  }

  // windows
  onSettingsWindowHide() {
    this.showSettingsWindow = false;
  }

  //export
  async onExportButtonClicked(format: 'mhtml' | 'zip') {
    if (this.activeManga === null) return;

    try {
      this.loading.show();
      const tab: Tab = await firstValueFrom(this.tabsRepo.get(this.activeManga));
      if (!tab) return;

      await this.exportService.exportManga(tab, this.pages, format);
      console.log(`Manga exported as ${format}`);
    } catch (err) {
      console.error(`Error exporting manga as ${format}`, err);
    } finally {
      this.loading.hide();
    }
  }

  // bookmark
  saveBookmark() {
    if (!this.activeManga || !this.readerRef) return;

    const data = this.readerRef.getCurrentBookmark();
    if (!data) return;

    this.bookmarksRepo.add({
      tab: this.activeManga,
      page: data.pageId,
      createdAt: Date.now(),
      title: `Page ${data.pageId}`
    }).subscribe(savedBookmarkid => {
      this.bookmarksRepo.getByTab(this.activeManga!).subscribe(bms => {
        this.bookmarks = bms.sort((a, b) => b.createdAt - a.createdAt);
        this.selectedBookmarkId = Number(savedBookmarkid);
      });
    });
  }

  goToBookmark(bookmarkId: number) {
    const bm = this.bookmarks.find(b => b.id === +bookmarkId);
    if (!bm || !this.readerRef) return;

    this.readerRef.scrollToBookmark(bm);
  }

  loadBookmarks(newSelectedId?: number) {
    if (!this.activeManga) return;

    this.bookmarksRepo.getByTab(this.activeManga).subscribe(bms => {
      this.bookmarks = bms.sort((a, b) => b.createdAt - a.createdAt);

      if (newSelectedId) {
        this.selectedBookmarkId = newSelectedId;
      }
    });
  }
}
