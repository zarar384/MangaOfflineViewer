import { Component, effect, OnInit, signal, ViewChild } from '@angular/core';
import { NavbarComponent } from '../navbar/navbar.component';
import { MangaHomeComponent } from '../home/manga-home.component';
import { CommonModule } from '@angular/common';
import { ReaderWrapperComoponent } from '../reader/reader-wrapper/reader-wrapper.component';
import { UiStateService } from '../../core/services/ui-state.service';
import { TabsService } from '../../core/services/tabs.service';
import { MangaPageComponent } from "../manga-page/manga-page.component";
import { MangaDraftService } from '../../core/services/manga-draft.service';
import { UploadFileWindowComponent } from '../windows/upload-file-window/upload-file-window.component';
import { ViewMod } from '../../shared/enums/viewmod.enum';
import { ReaderService } from '../../core/services/reader.service';

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

  get selectedMangaId() {
    return this.uiState.selectedMangaId();
  }

  // just for easier template access
  readonly ViewMod = ViewMod;

  // Upload window 
  showUploadWindow = signal(false);

  constructor(
    private uiState: UiStateService,
    private tabsService: TabsService,
    private draftService: MangaDraftService,
    private reader: ReaderService
  ) {
    effect(() => {
      const value = this.uiState.uploadWindow();
      this.showUploadWindow.set(value);
    });
  }

  ngOnInit(): void {
    const savedId = this.selectedMangaId;
    this.tabsService.setSelectedManga(savedId);

    const page = this.uiState.getValue<number>('page') ?? 1;
    const perPage = this.uiState.getValue<number>('perPage') ?? 10;

    this.tabsService.hydrate(page, perPage);
  }

  async onMangaSelected(mangaId: number | null) {
    // clear any existing draft when selecting a manga
    this.draftService.clear();
    
    // clear reader state
    this.reader.close();

    this.tabsService.setSelectedManga(mangaId);
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
