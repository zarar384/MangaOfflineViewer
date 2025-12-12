import { AfterViewInit, Component, EventEmitter, Input, OnInit, Output, signal, } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TabsComponent } from './tabs/tabs.component';
import { SettingsWindowComponent } from '../windows/settings-window/settings-window.component';
import { EditTabWindowComponent } from '../windows/edit-tab-window/edit-tab-window.component';
import { Tab } from 'src/app/core/models/tab.model';
import { UploadFileWindowComponent } from '../windows/upload-file-window/upload-file-window.component';
import { UiStateService } from 'src/app/core/services/ui-state.service';
import { MolvPaginationComponent } from 'src/app/shared/components/molv-pagination/molv-pagination.component';
import { TabsService } from 'src/app/core/services/tabs.service';

@Component({
  selector: 'app-manga-home',
  templateUrl: './manga-home.component.html',
  styleUrls: ['./manga-home.component.css'],
  standalone: true,
  imports: [TabsComponent, CommonModule, MolvPaginationComponent,
    SettingsWindowComponent, EditTabWindowComponent, UploadFileWindowComponent]
})
export class MangaHomeComponent implements OnInit, AfterViewInit {
  @Input() activeManga: number | null = null;
  @Output() mangaSelected = new EventEmitter<number | null>();

  totalCount = signal(0);
  page = signal(1);
  perPage = signal(10);

  showSettingsWindow = true;
  showUploadWindow = false;
  showEditWindow = false;
  tab: Tab | null = null;

  constructor(private uiState: UiStateService, private tabs: TabsService) { }

  ngOnInit(): void {
    this.totalCount.set(this.uiState.getValue<number>('totalCount') ?? 0);
    this.page.set(this.uiState.getValue<number>('page') ?? 1);
    this.perPage.set(this.uiState.getValue<number>('perPage') ?? 10);
  }

  ngAfterViewInit(): void {
    this.uiState.refreshTabs$.next();
  }

  onPageChange(newPage: number, newPerPage: number) {
    this.perPage.set(newPerPage);
    this.page.set(newPage);
    this.uiState.saveState({ page: newPage, perPage: newPerPage });
    this.uiState.refreshTabs$.next();
  }

  onTabSelected(id: number) {
    this.activeManga = id;
    this.mangaSelected.emit(id);
  }

  onMangaToEditSelected(tab: Tab) {
    this.tab = tab;
    this.openEditWindow();
  }

  onUpdateTotalCount(total: number) {
    this.totalCount.set(total);
    this.uiState.saveState({ totalCount: total });
  }

  // windows 
  // EDIT
  onSettingsWindowHide() {
    this.showSettingsWindow = false;
  }

  openEditWindow() {
    this.showEditWindow = true;
  }

  onEditWindowClose() {
    this.showEditWindow = false;
  }

  // UPLOAD
  onUploadWindowClose() {
    this.showUploadWindow = false;
  }
}
