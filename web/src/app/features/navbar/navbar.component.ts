import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, ViewChild } from '@angular/core';
import { UploadFileWindowComponent } from '../windows/upload-file-window/upload-file-window.component';
import { Tab } from 'src/app/core/models/tab.model';
import { TabsRepository } from 'src/app/core/repositories/tabs.repository';
import { TabsComponent } from '../home/tabs/tabs.component';

@Component({
  selector: 'app-manga-navbar',
  imports: [CommonModule],
  standalone: true,
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css'],
})
export class NavbarComponent implements OnInit {
  @Input() activeManga: number | null = null;
  @Output() mangaSelected = new EventEmitter<number | null>();
  @Output() openUploadWindowClicked = new EventEmitter<void>();

  selectedChapter: Tab | null = null;
  visibleTabs: Tab[] = [];
  chapters: Tab[] = [];
  pageSize = 10;

  constructor(private tabRepo: TabsRepository) { }

  async ngOnInit() {
    this.chapters = await this.tabRepo.getAll();
    this.updateVisibleTabs();
  }

  updateVisibleTabs() {
    this.visibleTabs = this.chapters.slice(0, this.pageSize);
  }

  selectTab(tab: Tab) {
    this.selectedChapter = tab;
    this.mangaSelected.emit(tab.id);
  }
  closeTab(tab: Tab) {
    this.visibleTabs = this.visibleTabs.filter(c => c.id !== tab.id);
    if (this.selectedChapter?.id === tab.id) this.selectedChapter = null;
  }

  goHome() {
    this.mangaSelected.emit(null);
  }

  openUploadWindow() {
    this.openUploadWindowClicked.emit();
  }
}
