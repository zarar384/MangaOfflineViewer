import { Component, OnInit } from '@angular/core';
import { NavbarComponent } from '../navbar/navbar.component';
import { MangaHomeComponent } from '../home/manga-home.component';
import { CommonModule } from '@angular/common';
import { ReaderWrapperComoponent } from '../reader/reader-wrapper/reader-wrapper.component';
import { UiStateService } from 'src/app/core/services/ui-state.service';

@Component({
  selector: 'app-manga-layout',
  standalone: true,
  imports: [
    NavbarComponent,
    MangaHomeComponent,
    ReaderWrapperComoponent,
    CommonModule
  ],
  templateUrl: './layout.component.html',
  styleUrls: ['./layout.component.css'],
})
export class LayoutComponent implements OnInit {
  selectedMangaId: number|null = null;

  constructor(private uiState: UiStateService) {}
  ngOnInit(): void {
    this.selectedMangaId = this.uiState.getValue<number>('selectedMangaId');
  }

  onMangaSelected(mangaId: number | null) {
    this.selectedMangaId = mangaId;
    this.uiState.saveState({ selectedMangaId: mangaId });
  }
}
