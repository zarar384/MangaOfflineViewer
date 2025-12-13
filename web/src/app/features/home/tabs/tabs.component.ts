import { CommonModule } from '@angular/common';
import { Component, EventEmitter,  Output,  inject } from '@angular/core';
import { Tab } from 'src/app/core/models/tab.model';
import { LoadingService } from 'src/app/core/services/loading.service';
import { TabsService } from 'src/app/core/services/tabs.service';

@Component({
  selector: 'tabs',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './tabs.component.html',
  styleUrl: './tabs.component.css',
})
export class TabsComponent {

  private tabsService = inject(TabsService);
  private loading = inject(LoadingService);

  @Output() mangaSelected = new EventEmitter<number>();
  @Output() mangaToEditSelected = new EventEmitter<Tab>();

  tabs = this.tabsService.tabsState;

  async remove(id: number) {
    try {
      this.loading.show();
      await this.tabsService.removeTab(id);
    } finally {
      this.loading.hide();
    }
  }

  openChapterInTab(tabData: { tab: Tab; previewUrl: string }) {
    if (tabData.tab.id) {
      this.mangaSelected.emit(tabData.tab.id);
    }
  }

  openEditWindow(tab: Tab) {
    this.mangaToEditSelected.emit(tab);
  }
}
