import { Component, Input, OnInit } from '@angular/core';
import { ReaderSettingsWindowComponent } from '../../windows/reader-settings-window/reader-settings-window.component';
import { CommonModule } from '@angular/common';
import { ReaderComponent } from '../reader-component/reader.component';
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
  imports: [ReaderComponent, ReaderSettingsWindowComponent, CommonModule],
  templateUrl: './reader-wrapper.comoponent.html',
  styleUrl: './reader-wrapper.comoponent.css'
})
export class ReaderWrapperComoponent implements OnInit {

  @Input() activeManga: number | null = null;

  gap = 0.5;
  mode: ReadingMode = 'scroll';
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
    // Restore reader UI settings from last session.
    this.gap = this.uiState.getValue<number>('readerGap') || 0.5;
    this.mode = this.uiState.getValue<ReadingMode>('readerMode') || 'scroll';
    this.downloadMod = this.uiState.getValue<'mhtml' | 'zip'>('downloadMod') || 'mhtml';

    // Apply restored settings right away so reader opens in the same state.
    this.reader.setSettings({ gap: this.gap, mode: this.mode });
  }

  goToBookmark = async (bookmarkId: number | string) => {
    const id = Number(bookmarkId);

    const bm = await this.bookmarksRepo.get(id);
    if (!bm) return;

    this.reader.goToPage(bm.pageId);
  }

  onSettingsWindowHide() {
    this.showSettingsWindow = false;
  }

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