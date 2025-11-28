import { Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { ReaderSettingsWindowComponent } from '../../windows/reader-settings-window/reader-settings-window.component';
import { CommonModule } from '@angular/common';
import { ReaderComponent } from '../reader-component/reader.component';
import { PagesRepository } from 'src/app/core/repositories/pages.repository';
import { Page } from 'src/app/core/models/page.model';
import { numericNameSort } from 'src/app/shared/utils/file-parsing';

@Component({
  selector: 'app-manga-reader',
  imports: [ReaderComponent, ReaderSettingsWindowComponent, CommonModule],
  templateUrl: './reader-wrapper.comoponent.html',
  styleUrl: './reader-wrapper.comoponent.css',
  standalone: true
})
export class ReaderWrapperComoponent implements OnInit, OnChanges {
  @Input() activeManga: number | null = null;;

  pages: Page[] = [];
  gap = 0.5;
  mode: 'scroll' | 'page' = 'scroll';
  zoom = 1;

  constructor(private pagesRepo: PagesRepository) { }

  ngOnInit(): void {
    this.loadPages();
  }

    ngOnChanges(changes: SimpleChanges): void {
    if (changes['activeManga'] && !changes['activeManga'].firstChange) {
      this.loadPages();
    }
  }

  loadPages() {
    if (!this.activeManga) return;

    this.pagesRepo.getByTab(this.activeManga)
      .then(pages => {
        this.pages = pages.sort((a, b) => numericNameSort(`${a}`, `${b}`));
        console.log('Loaded pages:', this.pages);
      })
      .catch(err => console.error('Error loading pages', err));
  }

  // windows
  showSettingsWindow = true;

  onSettingsWindowHide() {
    this.showSettingsWindow = false;
  }
}
