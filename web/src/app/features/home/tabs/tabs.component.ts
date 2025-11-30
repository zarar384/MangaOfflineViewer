import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, Signal, SimpleChanges } from '@angular/core';
import { Tab } from 'src/app/core/models/tab.model';
import { TabsRepository } from 'src/app/core/repositories/tabs.repository';
import { ObjectUrlService } from 'src/app/core/services/object-url.service';
import { UiStateService } from 'src/app/core/services/ui-state.service';
import { DEFAULT_PREVIEW } from 'src/assets/assets.config';


@Component({
  selector: 'tabs',
  templateUrl: './tabs.component.html',
  styleUrl: './tabs.component.css',
  standalone: true,
  imports: [CommonModule]
})
export class TabsComponent implements OnInit {
  @Input() page!: Signal<number>;
  @Input() perPage!: Signal<number>;

  @Output() mangaSelected = new EventEmitter<number>();
  @Output() mangaToEditSelected = new EventEmitter<Tab>();
  @Output() totalTabsChanged = new EventEmitter<number>();

  tabs: { tab: Tab; previewUrl: string }[] = [];

  constructor(private tabRepo: TabsRepository, private urlService: ObjectUrlService,
    private uiState: UiStateService) { }

  async ngOnInit() {
    this.uiState.refreshTabs$.subscribe(() => this.refreshTabs());
    this.refreshTabs()
  }

  refreshTabs = async () => {
    try {
      var p = this.page();
      var pp = this.perPage();
      const tabs = await this.tabRepo.getPaged(p, pp);
      this.tabs = await Promise.all(
        tabs.map(async (tab) => {
          const previewUrl = await this.getPreviewUrl(tab.name, tab.preview, true);
          return { tab: { ...tab }, previewUrl };
        })
      );

      const total = await this.tabRepo.getTotalCount();
      this.totalTabsChanged.emit(total);
    } catch (err) {
      this.tabs = [];
      this.totalTabsChanged.emit(0);
    }
  }

  private async getPreviewUrl(name: string, preview: Blob | string | undefined, revoke: boolean = false): Promise<string> {
    if (preview instanceof Blob) {
      if (revoke) this.urlService.revokeUrl(name);
      return this.urlService.createUrl(name, preview);
    } else if (typeof preview === 'string') {
      return preview;
    } else {
      return this.getDefaultPreview();
    }
  }

  private getDefaultPreview(): string {
    return DEFAULT_PREVIEW;
  }



  openChapterInTab(tabData: { tab: Tab; previewUrl: string }) {
    if (tabData.tab.id) {
      this.mangaSelected.emit(tabData.tab.id);
    }
  }

  openEditWindow(tab: Tab) {
    if (tab) {
      this.mangaToEditSelected.emit(tab);
    }
  }

  remove(tabId: number) {
    this.tabRepo.deleteTabWithPages(tabId).then(() => {
      this.tabs = this.tabs.filter(t => t.tab.id !== tabId);
    });
  }
}