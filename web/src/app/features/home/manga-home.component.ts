import { Component, EventEmitter, Input, Output, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MolvPaginationComponent } from '../../shared/components/molv-pagination/molv-pagination.component';
import { TabsService } from '../../core/services/tabs.service';
import { UiStateService } from '../../core/services/ui-state.service';
import { Tab } from '../../core/models/tab.model';
import { TabsComponent } from './tabs/tabs.component';
import { SettingsWindowComponent } from '../windows/settings-window/settings-window.component';
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
export class MangaHomeComponent implements OnInit {

  @Input() activeManga: number | null = null;
  @Output() mangaSelected = new EventEmitter<number | null>();

  page = signal(1);
  perPage = signal(10);

  showSettingsWindow = true;
  showEditWindow = false;
  tab: Tab | null = null;

  constructor(
    private uiState: UiStateService,
    public tabsService: TabsService
  ) { }

  ngOnInit(): void {
    const page = this.uiState.getValue<number>('page') ?? 1;
    const perPage = this.uiState.getValue<number>('perPage') ?? 10;

    this.page.set(page);
    this.perPage.set(perPage);
  }

  onPageChange(event: { page: number; perPage: number }) {
    this.page.set(event.page);
    this.perPage.set(event.perPage);

    this.uiState.saveState(event);

    this.tabsService.setPaging(event.page, event.perPage);
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
