import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Bookmark } from 'src/app/core/models/bookmark';
import { Tab } from 'src/app/core/models/tab.model';
import { BookmarksRepository } from 'src/app/core/repositories/bookmark.repository';
import { UiStateService } from 'src/app/core/services/ui-state.service';
import { MolvModule } from 'src/app/shared/components/molv-module.component';
import { MolvTabsComponent } from 'src/app/shared/components/molv-tabs/molv-tabs.component';
import { WindowComponent } from 'src/app/shared/components/window/window.component';
import { FormsModule } from '@angular/forms';

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
  @Input() bookmarks: Bookmark[] = [];
  @Input() selectedBookmarkId: number | null = null;

  @Output() hideWindow = new EventEmitter<void>();
  @Output() gapChange = new EventEmitter<number>();
  @Output() modeChange = new EventEmitter<'scroll' | 'page'>();
  @Output() zoomLevelChange = new EventEmitter<number>();
  @Output() gapLevelChange = new EventEmitter<number>();
  @Output() selectedBookmarkIdChange = new EventEmitter<number | null>();
  @Output() downloadModChange = new EventEmitter<'mhtml' | 'zip'>();

  @Output() exportButtonClicked = new EventEmitter<'mhtml' | 'zip'>();
  @Output() saveBookmarkClicked = new EventEmitter<void>();
  @Output() goToBookmarkClicked = new EventEmitter<number>();

  activeTab: 'home' | 'bookmarks' = 'home';

  constructor(private uiState: UiStateService, private bookmarksRepo: BookmarksRepository) { }

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
    this.modeChange.emit(this.mode);
    this.uiState.saveState({ downloadMod: this.downloadMod });
  }

  // ZOOM
  get zoom(): number {
    return this.zoomLevel;
  }

  set zoom(value: number) {
    this.zoomLevel = value;
    this.uiState.saveState({ readerZoom: this.zoomLevel });
    this.zoomLevelChange.emit(value);
  }

  // RANGE
  get gap(): number {
    return this.gapLevel;
  }

  set gap(value: number) {
    this.gapLevel = value;
    this.uiState.saveState({ readerGap: this.gapLevel });
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

  get settingsTabs(): Tab[] {
    if (this.bookmarks.length > 0) {
      return [{ id: 1, name: 'Bookmarks' } as Tab];
    }
    return [];
  }

  // BOOKMARKS
  get bookmarkOptions() {
    const options = [{ value: 0, label: 'Select' }];
    var bookmarks = this.bookmarks.map(b => ({
      value: b.id!,
      label: b.title || `Page ${b.page}`
    }));

    return options.concat(bookmarks);
  }

  onHomeTab() { this.activeTab = 'home'; }

  onTabSelected(tab: Tab) {
    this.activeTab = tab.name === 'Bookmarks' ? 'bookmarks' : 'home';
  }

  // BOOKMARK EDIT / DELETE 
  editBookmarkTitle(bookmark: Bookmark, newTitle: string | undefined) {
    if (!bookmark.id) return;

    bookmark.title = newTitle;
    this.bookmarksRepo.add(bookmark).subscribe({ // is put
      next: () => {
        console.log(`Bookmark ${bookmark.id} updated in DB`);
      },
      error: (err) => {
        console.error('Failed to update bookmark', err);
      }
    });
  }

  deleteBookmark(bookmark: Bookmark) {
    if (bookmark.id) {
      this.bookmarksRepo.delete(bookmark.id).subscribe(() => {
        this.bookmarks = this.bookmarks.filter(b => b.id !== bookmark.id);
        if (this.selectedBookmarkId === bookmark.id) {
          this.selectedBookmarkId = null;
        }
      });
    }
  }
}
