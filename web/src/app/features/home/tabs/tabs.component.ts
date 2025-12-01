import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, Signal, SimpleChanges, WritableSignal } from '@angular/core';
import { Tab } from 'src/app/core/models/tab.model';
import { TabsRepository } from 'src/app/core/repositories/tabs.repository';
import { LoadingService } from 'src/app/core/services/loading.service';
import { ObjectUrlService } from 'src/app/core/services/object-url.service';
import { TabsService } from 'src/app/core/services/tabs.service';
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
  @Input() page!: WritableSignal<number>;
  @Input() perPage!: WritableSignal<number>;
  @Output() mangaSelected = new EventEmitter<number>();
  @Output() mangaToEditSelected = new EventEmitter<Tab>();
  @Output() totalTabsChanged = new EventEmitter<number>();

  tabs: { tab: Tab; previewUrl: string }[] = [];

  constructor(private tabsService: TabsService, private uiState: UiStateService, private loading: LoadingService) { }

  ngOnInit() {
    this.uiState.refreshTabs$.subscribe(() => this.refreshTabs());
    this.tabsService.tabs$.subscribe(t => this.tabs = t);
    this.tabsService.totalTabs$.subscribe(total => this.totalTabsChanged.emit(total));
    this.refreshTabs();
  }

  refreshTabs = async () => {
    this.loading.show();
    await this.tabsService.refreshTabs(this.page(), this.perPage());
    this.loading.hide();
  }

  remove(tabId: number) {
    this.loading.show();
    this.tabsService.removeTab(tabId, this.page(), this.perPage())
      .finally(() => this.loading.hide());
  }

  openChapterInTab(tabData: { tab: Tab; previewUrl: string }) {
    if (tabData.tab.id) this.mangaSelected.emit(tabData.tab.id);
  }

  openEditWindow(tab: Tab) {
    if (tab) this.mangaToEditSelected.emit(tab);
  }
}
