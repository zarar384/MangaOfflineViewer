import { CommonModule } from '@angular/common';
import { Component, EventEmitter,  Output,  inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Tab } from '../../../core/models/tab.model';
import { LoadingService } from '../../../core/services/loading.service';
import { TabsService } from '../../../core/services/tabs.service';
import { ViewMod } from 'src/app/shared/enums/viewmod.enum';

@Component({
  selector: 'tabs',
  standalone: true,
  imports: [CommonModule, TranslocoPipe],
  templateUrl: './tabs.component.html',
  styleUrl: './tabs.component.css',
})
export class TabsComponent {

  private tabsService = inject(TabsService);
  private loading = inject(LoadingService);

  @Output() mangaSelected = new EventEmitter<number>();
  @Output() mangaToEditSelected = new EventEmitter<Tab>();

  tabs = this.tabsService.tabsState;

  // expose enum to template
  isSingle = ViewMod.Single;

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
      this.tabsService.setActiveTab(tabData.tab.id);
      this.mangaSelected.emit(tabData.tab.id);
    }
  }

  openEditWindow(tab: Tab) {
    this.mangaToEditSelected.emit(tab);
  }
}
