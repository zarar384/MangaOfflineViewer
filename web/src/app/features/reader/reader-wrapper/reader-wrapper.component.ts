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
import { firstValueFrom } from 'rxjs';
import { Tab } from 'src/app/core/models/tab.model';
import { LoadingService } from 'src/app/core/services/loading.service';

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
  zoom = 1;
  showSettingsWindow = true;

  constructor(private pagesRepo: PagesRepository, private tabsRepo: TabsRepository,
    private uiState: UiStateService, private exportService: ExportService, private loading: LoadingService) { }

  ngOnInit(): void {
    this.gap = this.uiState.getValue<number>('readerGap') || 0.5;
    this.mode = this.uiState.getValue<'scroll' | 'page'>('readerMode') || 'scroll';
    this.zoom = this.uiState.getValue<number>('readerZoom') || 1;
    this.loadPages();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['activeManga'] && !changes['activeManga'].firstChange) {
      this.loadPages();
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
}
