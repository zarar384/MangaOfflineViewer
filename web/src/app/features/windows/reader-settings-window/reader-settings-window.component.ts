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
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageService } from 'src/app/core/services/language.service';
import { PagesRepository } from 'src/app/core/repositories/pages.repository';

export interface ReaderPage
{
  id: number;
  order?: number;
  title?: string;
}

@Component({
  selector: 'reader-settings-window',
  imports: [CommonModule, WindowComponent, MolvModule, MolvTabsComponent, FormsModule, TranslocoPipe],
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
  @Input() selectedPageId: number | null = null;

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

  activeTabId: number | null = null;
  bookmarks: Bookmark[] = [];
  pages: ReaderPage[] = [];
  selectedBookmarkId: number | null = null;
  editingBookmarkId: number | null = null;
  originalTitle: string = '';

  constructor(
    private uiState: UiStateService,
    private bookmarksRepo: BookmarksRepository,
    private pagesRepo: PagesRepository,
    private reader: ReaderService,
    private langService: LanguageService) {

    // load states 
    this.mode = this.uiState.getValue<'scroll' | 'page'>('readerMode') || 'scroll';
    this.downloadMod = this.uiState.getValue<'mhtml' | 'zip'>('downloadMod') || 'mhtml';
    this.zoomLevel = this.uiState.getValue<number>('readerZoom') || 0;
    this.gapLevel = this.uiState.getValue<number>('readerGap') || 0;

    effect(() => {
      const isOpen = this.reader.isOpen();

      // if (!chapterId) return;

      Promise.resolve().then(() => {
        this.loadBookmarks()
        this.loadPages()
      });
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

  get settingsTabs(): UserTab[] {
    if (this.bookmarks.length > 0) {
      return [{ id: 1, name: this.langService.translate('bookmarks'), tabId: 1 }];
    }
    return [];
  }

  get pageOptions() {
    return this.pages.map(n => ({
      value: n.id!,
      label: `${n.title}`
    }));
  }

  get activeTab(): 'home' | 'bookmarks' {
  return this.activeTabId === null ? 'home' : 'bookmarks';
}

  // PAGE
  goToPage() {
    this.goToPageClicked.emit(+this.selectedPageId!)
  }
  
  async loadPages() {
    const reader = this.reader.getSnapshot();
    if (!reader.mangaId) return;

    try {
      this.pages = (await this.pagesRepo.getMeta(reader.mangaId)).map(p => ({
        id: p.id!,
        order: p.order,
        title: p.chapterId ? `${p.chapterOrder} - ${p.order}` : `${p.order}`
      }));
    }
    catch (err) {
      console.log(`Error loading pages for manga ${reader.mangaId}`, err);
    }
  }

  // BOOKMARKS
  get bookmarkOptions() {
    return this.bookmarks.map(b => ({
      value: b.id!,
      label: b.title || `${this.langService.translate('page')} ${b.pageId}`
    }));
  }

  goToBookmark() {
    var bookmark = this.bookmarks.find(b => b.id === this.selectedBookmarkId);
    var page = this.pages.find(p => p.id === bookmark?.pageId);
    this.selectedPageId = page ? page?.id! : null;
    this.goToBookmarkClicked.emit(this.selectedBookmarkId!)
  }

  onHomeTab() { this.activeTabId = null;}

  onTabSelected(tab: UserTab) {
    this.activeTabId = tab.tabId; 
  }

  // BOOKMARK EDIT / DELETE / CREATE / CANCEL
  async saveBookmarkEdit(bm: Bookmark) {
    if (!bm.id) return;

    try {
      await this.bookmarksRepo.put(bm);
      this.editingBookmarkId = null;
    } catch (err) {
      console.error(err);
    }
  }

  cancelBookmarkEdit(bm: Bookmark) {
    bm.title = this.originalTitle;
    this.editingBookmarkId = null;
  }

  startEditBookmark(bm: Bookmark) {
    if (this.editingBookmarkId !== null) return; // block if another bookmark is being edited

    this.editingBookmarkId = bm.id!;
    this.originalTitle = bm.title || '';
  }

  isEditing(bm: Bookmark): boolean {
    return this.editingBookmarkId === bm.id;
  }

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
      const page = this.pages.find(p => p.id === reader.currentPageBookmark);
      if (!page || page.order === undefined) return;

      // check if bookmark for this page already exists
      var existingBookmark = await this.bookmarksRepo.exists(reader.mangaId!, page.id!);

      if (existingBookmark) {
        console.log(`Bookmark for page ${page.title} already exists`);
        return;
      }

      await this.bookmarksRepo.put({
        tabId: reader.mangaId!,
        pageId: page.id!,
        chapterId: reader.chapterId ?? null,
        createdAt: Date.now(),
        title: `${page.title}`
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

      if (this.bookmarks.length === 0) {
        this.activeTabId = null;
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
      const bookmarks = await this.bookmarksRepo.getAll(reader.mangaId);

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
