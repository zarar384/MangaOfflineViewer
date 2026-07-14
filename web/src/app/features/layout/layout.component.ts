import { Component, computed, effect, OnInit, signal, ViewChild } from '@angular/core';
import { NavbarComponent } from '../navbar/navbar.component';
import { MangaHomeComponent } from '../home/manga-home.component';
import { CommonModule } from '@angular/common';
import { ReaderWrapperComoponent } from '../reader/reader-wrapper/reader-wrapper.component';
import { UiStateService } from '../../core/services/ui-state.service';
import { TabsService } from '../../core/services/tabs.service';
import { MangaPageComponent } from "../manga-page/manga-page.component";
import { UploadFileWindowComponent } from '../windows/upload-file-window/upload-file-window.component';
import { ViewMod } from '../../shared/enums/viewmod.enum';
import { SettingsWindowComponent } from '../windows/settings-window/settings-window.component';

@Component({
  selector: 'app-manga-layout',
  standalone: true,
  imports: [
    NavbarComponent,
    MangaHomeComponent,
    ReaderWrapperComoponent,
    CommonModule,
    MangaPageComponent,
    UploadFileWindowComponent,
    SettingsWindowComponent
  ],
  templateUrl: './layout.component.html',
  styleUrls: ['./layout.component.css'],
})
export class LayoutComponent implements OnInit {
  @ViewChild(MangaHomeComponent) homeComp!: MangaHomeComponent;

  get selectedMangaId() {
    return this.uiState.selectedMangaId();
  }

  // just for easier template access
  readonly ViewMod = ViewMod;

  // Sidebar visibility
  protected readonly sidebarVisible = computed(() => this.uiState.sidebarVisible()); 

  // Upload window 
  showUploadWindow = signal(false);

  // Settings window
  showSettingsWindow = signal(false);
  
  constructor(
    private uiState: UiStateService,
    private tabsService: TabsService,
  ) {
    effect(() => {
      const value = this.uiState.uploadWindow();
      this.showUploadWindow.set(value);
    });

    effect(() => {
      const value = this.uiState.settingsWindow();
      this.showSettingsWindow.set(value);
    });
  }

  ngOnInit(): void {
    const savedId = this.selectedMangaId;
    this.tabsService.open({ mangaId: savedId });

    const page = this.uiState.getValue<number>('page') ?? 1;
    const perPage = this.uiState.getValue<number>('perPage') ?? 10;

    this.tabsService.hydrate(page, perPage);
  }

  async onMangaSelected(mangaId: number | null) {
    if (mangaId === null) return;
    await this.tabsService.createUserTab(mangaId);
    await this.tabsService.open({ mangaId });
  }

  // Upload window
  onOpenUploadWindowClicked() {
    this.uiState.setUploadWindow(true);
  }

  onUploadWindowClose() {
    this.uiState.setUploadWindow(false);
  }

  // Settings window
  onOpenSettingsWindowClicked() {
    if (this.viewMode === ViewMod.Single) {
      this.uiState.setReaderSettingsWindow(true);
    } else {
      this.uiState.setSettingsWindow(true);
    }
  }

  onSettingsWindowClose() {
    this.uiState.setSettingsWindow(false);
  }

  // View mode
  get viewMode() {
    return this.uiState.currentView();
  }
}
