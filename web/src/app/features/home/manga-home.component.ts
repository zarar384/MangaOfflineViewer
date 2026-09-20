import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MolvPaginationComponent } from '../../shared/components/molv-pagination/molv-pagination.component';
import { TabsService } from '../../core/services/tabs.service';
import { UiStateService } from '../../core/services/ui-state.service';
import { Tab } from '../../core/models/tab.model';
import { TabsComponent } from './tabs/tabs.component';
import { EditTabWindowComponent } from '../windows/edit-tab-window/edit-tab-window.component';
import { MolvSearchComponent } from 'src/app/shared/components/molv-search/molv-search/molv-search.component';
import { SearchToken } from 'src/app/shared/models/search-token.model';

@Component({
  selector: 'app-manga-home',
  templateUrl: './manga-home.component.html',
  styleUrls: ['./manga-home.component.css'],
  standalone: true,
  imports: [
    TabsComponent,
    CommonModule,
    MolvPaginationComponent,
    EditTabWindowComponent,
    MolvSearchComponent
  ]
})
export class MangaHomeComponent {

  @Input() activeManga: number | null = null;
  @Output() mangaSelected = new EventEmitter<number | null>();

  readonly page;
  readonly perPage;

  showSettingsWindow = true;
  showEditWindow = false;
  tab: Tab | null = null;

  constructor(
    private uiState: UiStateService,
    public tabsService: TabsService
  ) { 
    this.page = this.tabsService.pageState;
    this.perPage = this.tabsService.perPageState;
  }

  onPageChange(event: { page: number; perPage: number }) {
    this.uiState.saveState(event);

    this.tabsService.setPaging(
      event.page, 
      event.perPage);
  }

  onTabSelected(id: number) {
    this.activeManga = id;
    this.mangaSelected.emit(id);
  }

  onMangaToEditSelected(tab: Tab) {
    this.tab = tab;
    this.openEditWindow();
  }

  // windows 
  onSettingsWindowHide() {
    this.showSettingsWindow = false;
  }

  openEditWindow() {
    this.showEditWindow = true;
  }

  onEditWindowClose() {
    this.showEditWindow = false;
  }

  onSearch(event: {
    tokens: SearchToken[];
    query: string;
  }) {

    this.tabsService.filterByTokens(
      event.tokens,
      event.query
    );
  }
}
