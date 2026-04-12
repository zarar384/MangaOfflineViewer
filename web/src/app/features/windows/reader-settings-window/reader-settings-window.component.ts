import { CommonModule } from '@angular/common';
import { Component, effect, EventEmitter, Input, Output } from '@angular/core';
import { Bookmark } from '../../../core/models/bookmark';
import { BookmarksRepository } from '../../../core/repositories/bookmark.repository';
import { UiStateService } from '../../../core/services/ui-state.service';
import { MolvModule } from '../../../shared/components/molv-module.component';
import { MolvTabsComponent } from '../../../shared/components/molv-tabs/molv-tabs.component';
import { WindowComponent } from '../../../shared/components/window/window.component';
import { FormsModule } from '@angular/forms';
import { ReaderService } from '../../../core/services/reader.service';
import { numericNameSort } from 'src/app/shared/utils/file-parsing';
import { UserTab } from 'src/app/core/models/usertab';

@Component({
  selector: 'reader-settings-window',
  imports: [CommonModule, WindowComponent, MolvModule, MolvTabsComponent, FormsModule],
  templateUrl: './reader-settings-window.component.html',
  styleUrl: './reader-settings-window.component.css',
  standalone: true
})
export class ReaderSettingsWindowComponent {
  @Input() isVisible = false;
  @Input() mode: 'scroll' | 'page' = 'scroll';
  @Input() downloadMod: 'mhtml' | 'zip' = 'mhtml';
  @Input() zoomLevel = 0;
  @Input() gapLevel = 0;
  @Input() selectedPageNumber: number | null = null;

  @Output() hideWindow = new EventEmitter<void>();
  @Output() gapChange = new EventEmitter<number>();
  @Output() modeChange = new EventEmitter<'scroll' | 'page'>();
  @Output() zoomLevelChange = new EventEmitter<number>();
  @Output() gapLevelChange = new EventEmitter<number>();
  @Output() selectedBookmarkIdChange = new EventEmitter<number | null>();
  @Output() downloadModChange = new EventEmitter<'mhtml' | 'zip'>();

  @Output() exportButtonClicked = new EventEmitter<'mhtml' | 'zip'>();
  @Output() goToBookmarkClicked = new EventEmitter<number>();
  @Output() goToPageClicked = new EventEmitter<number>();

  activeTab: 'home' | 'bookmarks' = 'home';
  bookmarks: Bookmark[] = [];
  selectedBookmarkId: number | null = null;
  
  constructor(
    private uiState: UiStateService,
    private bookmarksRepo: BookmarksRepository,
    private reader: ReaderService) {

    effect(() => {
      const chapterId = this.reader.chapterId();

      if (!chapterId) return;

      Promise.resolve().then(() => this.loadBookmarks());
    });
  }

  onWindowHide() {
    this.hideWindow.emit();
  }

  // MOD
  get modeIsPage(): boolean {
    return this.mode === 'page';
  }

  set modeIsPage(value: boolean) {
    this.mode = value ? 'page' : 'scroll';

    this.uiState.saveState({ readerMode: this.mode });
    this.uiState.saveState({ downloadMod: this.downloadMod });

    this.reader.setSettings({ mode: this.mode });

    this.modeChange.emit(this.mode);
  }

  // ZOOM
  get zoom(): number {
    return this.zoomLevel;
  }

  set zoom(value: number) {
    this.zoomLevel = value;

    this.uiState.saveState({ readerZoom: this.zoomLevel });

    this.reader.setSettings({ zoom: this.zoomLevel });

    this.zoomLevelChange.emit(value);
  }

  // RANGE
  get gap(): number {
    return this.gapLevel;
  }

  set gap(value: number) {
    this.gapLevel = value;

    this.uiState.saveState({ readerGap: this.gapLevel });

    this.reader.setSettings({ gap: this.gapLevel });

    this.gapLevelChange.emit(value);
  }

  // DOWNLOAD MOD
  get dwnldMod(): 'mhtml' | 'zip' {
    return this.downloadMod;
  }

  set dwnldMod(value: 'mhtml' | 'zip') {
    this.downloadMod = value;
    this.uiState.saveState({ downloadMod: this.downloadMod });
    this.downloadModChange.emit(value);
  }

  // EXPORT
  export(format: 'mhtml' | 'zip') {
    this.exportButtonClicked.emit(format);
  }

  get settingsTabs(): UserTab [] {
    if (this.bookmarks.length > 0) {
      return  [{ id: 1, name: 'Bookmarks', tabId: 0 }];
    }
    return [];
  }

  get pageOptions() {
    const options = [{ value: 0, label: 'Select' }];
    var pages = (this.reader.pages()).map(n => ({
      value: n.pageNumber!,
      label: `${n.pageNumber}`
    }));

    return options.concat(pages);
  }

  // PAGE
  goToPage() {
    // var bookmark = this.bookmarks.find(b => b.pageId === this.selectedPageNumber);
    // if (bookmark)
    //   this.selectedBookmarkId = bookmark.id!;

    this.goToPageClicked.emit(+this.selectedPageNumber!)
  }

  // BOOKMARKS
  get bookmarkOptions() {
    const options = [{ value: 0, label: 'Select' }];
    var bookmarks = this.bookmarks.map(b => ({
      value: b.id!,
      label: b.title || `Page ${b.pageId}`
    }));

    return options.concat(bookmarks);
  }

  goToBookmark() {
    var bookmark = this.bookmarks.find(b => b.id === this.selectedBookmarkId);
    var page = this.reader.pages().find(p => p.id === bookmark?.pageId);
    this.selectedPageNumber = page ? page?.pageNumber! : null;
    this.goToBookmarkClicked.emit(this.selectedBookmarkId!)
  }

  onHomeTab() { this.activeTab = 'home'; }

  onTabSelected(tab: UserTab) {
    this.activeTab = tab.name === 'Bookmarks' ? 'bookmarks' : 'home';
  }

  // BOOKMARK EDIT / DELETE 
  async editBookmarkTitle(bookmark: Bookmark, newTitle?: string) {
    if (!bookmark.id) return;

    try {
      bookmark.title = newTitle;
      await this.bookmarksRepo.put(bookmark);
      console.log(`Bookmark ${bookmark.id} updated in DB`);
    } catch (err) {
      console.error('Failed to update bookmark', err);
    }
  }

    // SETTINGS WINDOW: BOOKMARKS
  async saveBookmark() {
    // Get current page from reader state
    const reader = this.reader.getSnapshot();
    if (!reader || !reader.currentPageBookmark) return;

    // Load all bookmarks for current manga
    try {
      const page = this.reader.pages().find(p => p.id === reader.currentPageBookmark);
      if (!page || page.pageNumber === undefined) return;

      // check if bookmark for this page already exists
      var existingBookmark = await this.bookmarksRepo.exists(reader.mangaId!, page.id!);

      if (existingBookmark) {
        console.log(`Bookmark for page ${page.pageNumber} already exists`);
        return;
      }

      await this.bookmarksRepo.put({
        tabId: reader.mangaId!,
        pageId: page.id!,
        chapterId: reader.chapterId ?? null,
        createdAt: Date.now(),
        title: `Page ${page.pageNumber}`
      });

      this.loadBookmarks();
    } catch (err) {
      console.log('Error while saving bookmark', err);
    }
  }


  async deleteBookmark(bookmark: Bookmark) {
    if (!bookmark.id) return;

    try {
      await this.bookmarksRepo.delete(bookmark.id);

      this.bookmarks = this.bookmarks.filter(b => b.id !== bookmark.id);

      if (this.selectedBookmarkId === bookmark.id) {
        this.selectedBookmarkId = null;
      }

    } catch (err) {
      console.error('Failed to delete bookmark', err);
    }
  }

  async loadBookmarks() {
    const reader = this.reader.getSnapshot();
    if (!reader.mangaId) return;

    try {
      const bookmarks = await this.bookmarksRepo.getAll(reader.mangaId, reader?.chapterId || undefined);

      this.bookmarks = bookmarks.sort((a, b) =>
        numericNameSort(`${a}`, `${b}`)
      );

      if (reader.currentPageBookmark) {
        this.selectedBookmarkId = bookmarks.find(b => b.tabId === reader.mangaId && b.pageId === reader.currentPageBookmark)?.id || null;
      }

    } catch (err) {
      console.log(`Error loading bookmarks for manga ${reader.mangaId}`, err);
    }
  }
}
