import { Component, OnInit, ViewChild } from '@angular/core';
import { NavbarComponent } from '../navbar/navbar.component';
import { MangaHomeComponent } from '../home/manga-home.component';
import { CommonModule } from '@angular/common';
import { ReaderWrapperComoponent } from '../reader/reader-wrapper/reader-wrapper.component';
import { UiStateService } from 'src/app/core/services/ui-state.service';
import { TabsService } from 'src/app/core/services/tabs.service';
import { MangaPageComponent } from "../manga-page/manga-page.component";

@Component({
  selector: 'app-manga-layout',
  standalone: true,
  imports: [
    NavbarComponent,
    MangaHomeComponent,
    ReaderWrapperComoponent,
    CommonModule,
    MangaPageComponent
],
  templateUrl: './layout.component.html',
  styleUrls: ['./layout.component.css'],
})
export class LayoutComponent implements OnInit {
  @ViewChild(MangaHomeComponent) homeComp!: MangaHomeComponent;

  selectedMangaId: number | null = null;

  constructor(private uiState: UiStateService, private tabsService: TabsService) { }
  ngOnInit(): void {
    this.selectedMangaId = this.uiState.getValue<number>('selectedMangaId');

    const page = this.uiState.getValue<number>('page') ?? 1;
    const perPage = this.uiState.getValue<number>('perPage') ?? 10;

    this.tabsService.hydrate(page, perPage);
  }

  onMangaSelected(mangaId: number | null) {
    this.selectedMangaId = mangaId;
    this.uiState.saveState({ selectedMangaId: mangaId });
  }

  onOpenUploadWindowClicked() {
    this.homeComp.showUploadWindow = true;
  }
}
