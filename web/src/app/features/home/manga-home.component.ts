import { Component, EventEmitter, Input, Output, } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TabsComponent } from './tabs/tabs.component';
import { SettingsWindowComponent } from '../windows/settings-window/settings-window.component';
import { EditTabWindowComponent } from '../windows/edit-tab-window/edit-tab-window.component';
import { Tab } from 'src/app/core/models/tab.model';
import { UploadFileWindowComponent } from '../windows/upload-file-window/upload-file-window.component';
import { UiStateService } from 'src/app/core/services/ui-state.service';

@Component({
  selector: 'app-manga-home',
  templateUrl: './manga-home.component.html',
  styleUrls: ['./manga-home.component.css'],
  standalone: true,
  imports: [TabsComponent, CommonModule, SettingsWindowComponent, EditTabWindowComponent, UploadFileWindowComponent]
})
export class MangaHomeComponent {
  @Input() activeManga: number | null = null;
  @Output() mangaSelected = new EventEmitter<number | null>();

  pageSize = 10;
  showSettingsWindow = true;
  showUploadWindow = false;
  showEditWindow = false;
  tab: Tab | null = null;

  constructor(private uiState: UiStateService){}

  onTabSelected(id: number) {
    this.activeManga = id;
    this.mangaSelected.emit(id);
  }

  onMangaToEditSelected(tab: Tab) {
    this.tab = tab;
    this.openEditWindow();
  }

  changePageSize(n: number) {
    this.pageSize = Number(n);
    // this.updateVisibleTabs();
  }

  // windows 
  // EDIT
  onSettingsWindowHide() {
    this.showSettingsWindow = false;
  }

  openEditWindow() {
    this.showEditWindow = true;
  }

  onEditWindowClose(refreshTabs: boolean) {
  if (refreshTabs) {
    this.uiState.refreshTabs$.next();
  }
    this.showEditWindow = false;
  }

  // UPLOAD
  onUploadWindowClose(refreshTabs: boolean) {
  if (refreshTabs) {
    this.uiState.refreshTabs$.next();
  }
    this.showUploadWindow = false;
  }
}
