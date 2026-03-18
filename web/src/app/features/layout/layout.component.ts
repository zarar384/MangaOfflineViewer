import { Component, effect, OnInit, signal, ViewChild } from '@angular/core';
import { NavbarComponent } from '../navbar/navbar.component';
import { MangaHomeComponent } from '../home/manga-home.component';
import { CommonModule } from '@angular/common';
import { ReaderWrapperComoponent } from '../reader/reader-wrapper/reader-wrapper.component';
import { UiStateService } from 'src/app/core/services/ui-state.service';
import { TabsService } from 'src/app/core/services/tabs.service';
import { MangaPageComponent } from "../manga-page/manga-page.component";
import { MangaDraftService } from 'src/app/core/services/manga-draft.service';
import { UploadFileWindowComponent } from '../windows/upload-file-window/upload-file-window.component';

@Component({
  selector: 'app-manga-layout',
  standalone: true,
  imports: [
    NavbarComponent,
    MangaHomeComponent,
    ReaderWrapperComoponent,
    CommonModule,
    MangaPageComponent,
    UploadFileWindowComponent
  ],
  templateUrl: './layout.component.html',
  styleUrls: ['./layout.component.css'],
})
export class LayoutComponent implements OnInit {
  @ViewChild(MangaHomeComponent) homeComp!: MangaHomeComponent;

  selectedMangaId: number | null = null;

  // Upload window 
  showUploadWindow = signal(false);

  constructor(
    private uiState: UiStateService,
    private tabsService: TabsService,
    private draftService: MangaDraftService) {
    effect(() => {
      const value = this.uiState.uploadWindow();
      this.showUploadWindow.set(value);
    });
  }

  ngOnInit(): void {
    this.selectedMangaId = this.uiState.getValue<number>('selectedMangaId');

    const page = this.uiState.getValue<number>('page') ?? 1;
    const perPage = this.uiState.getValue<number>('perPage') ?? 10;

    this.tabsService.hydrate(page, perPage);
  }

  async onMangaSelected(mangaId: number | null) {
    // Clear any existing draft when selecting a manga
    this.draftService.clear();

    this.selectedMangaId = mangaId;
    this.uiState.saveState({ selectedMangaId: mangaId });

    if (!mangaId) {
      this.uiState.navigate('home');
      return;
    }

    const data = await this.tabsService.getTabById(mangaId);
    if (!data) {
      this.uiState.navigate('home');
      return;
    }

    const mode = data.tab.mode ?? 'single';

    if (mode === 'chapters')
      this.uiState.navigate('chapters');
    else
      this.uiState.navigate('single');
  }

  // Upload window
  onOpenUploadWindowClicked() {
    this.uiState.setUploadWindow(true);
  }

  onUploadWindowClose() {
    this.uiState.setUploadWindow(false);
  }

  // View mode
  get viewMode() {
    return this.uiState.currentView();
  }
}
