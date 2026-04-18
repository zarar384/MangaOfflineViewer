import { Component, effect, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { ReaderSettingsWindowComponent } from '../../windows/reader-settings-window/reader-settings-window.component';
import { CommonModule } from '@angular/common';
import { ReaderComponent } from '../reader-component/reader.component';
import { UiStateService } from '../../../core/services/ui-state.service';
import { ExportService } from '../../../core/services/export.service';
import { LoadingService } from '../../../core/services/loading.service';
import { ReaderService } from '../../../core/services/reader.service';
import { BookmarksRepository } from 'src/app/core/repositories/bookmark.repository';
import { TabsService } from 'src/app/core/services/tabs.service';

@Component({
  selector: 'app-manga-reader',
  standalone: true,
  imports: [ReaderComponent, ReaderSettingsWindowComponent, CommonModule],
  templateUrl: './reader-wrapper.comoponent.html',
  styleUrl: './reader-wrapper.comoponent.css'
})
export class ReaderWrapperComoponent implements OnInit {

  @Input() activeManga: number | null = null;

  gap = 0.5;
  mode: 'scroll' | 'page' = 'scroll';
  zoom = 1;
  downloadMod: 'mhtml' | 'zip' = 'mhtml';

  showSettingsWindow = true;

  constructor(
    private tabsService: TabsService,
    private bookmarksRepo: BookmarksRepository,
    private uiState: UiStateService,
    private exportService: ExportService,
    private loading: LoadingService,
    private reader: ReaderService
  ) {
  }

  ngOnInit(): void {
    // Restore UI settings from previous session
    this.gap = this.uiState.getValue<number>('readerGap') || 0.5;
    this.mode = this.uiState.getValue<'scroll' | 'page'>('readerMode') || 'scroll';
    this.zoom = this.uiState.getValue<number>('readerZoom') || 1;
    this.downloadMod = this.uiState.getValue<'mhtml' | 'zip'>('downloadMod') || 'mhtml';
  }

  // SETTINGS WINDOW: MAIN
  goToPage(pageNumber: number) {
    const pageId = this.reader.pages().find(p => p.pageNumber === pageNumber)?.id;
    if (!pageId) return;

    this.reader.goToPage(pageId);
  }

goToBookmark = async (bookmarkId: number | string) => {
  const id = Number(bookmarkId); 

  const bm = await this.bookmarksRepo.get(id);
  if (!bm) return;

  this.reader.goToPage(bm.pageId);
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

      const tab = await this.tabsService.getTabById(this.activeManga);
      if (!tab) return;

      await this.exportService.exportManga(tab, this.reader.pages(), format);

      console.log(`Manga exported as ${format}`);

    } catch (err) {
      console.error(`Error exporting manga as ${format}`, err);
    } finally {
      this.loading.hide();
    }
  }
}