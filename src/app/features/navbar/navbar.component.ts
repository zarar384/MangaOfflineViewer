import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { IndexedDbService, MangaChapter } from 'src/app/core/database/indexeddb.service';
import { UploadFileWindowComponent } from '../windows/upload-file-window/upload-file-window.component';

@Component({
  selector: 'app-manga-navbar',
  imports: [CommonModule, UploadFileWindowComponent],
  standalone: true,
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css'],
})
export class NavbarComponent implements OnInit {
  @Input() activeManga: string = '';
  @Output() mangaSelected = new EventEmitter<string>();
  selectedChapter: MangaChapter | null = null;
  visibleTabs: MangaChapter[] = [];
  chapters: MangaChapter[] = [];
  pageSize = 10;

  constructor(private db: IndexedDbService) { }

  async ngOnInit() {
    this.chapters = await this.db.getAllChapters();
    this.updateVisibleTabs();
  }

  updateVisibleTabs() {
    this.visibleTabs = this.chapters.slice(0, this.pageSize);
  }

  selectTab(ch: MangaChapter) {
    // this.selectedChapter = ch; 
    this.mangaSelected.emit(ch.id);
  }
  closeTab(ch: MangaChapter) {
    this.visibleTabs = this.visibleTabs.filter(c => c.id !== ch.id);
    if (this.selectedChapter?.id === ch.id) this.selectedChapter = null;
  }

  goHome() {
    this.mangaSelected.emit('');
  }

  // windows
  showUploadWindow = false;

  openUploadWindow() {
    this.showUploadWindow = true;
  }

  onUploadWindowClose() {
    this.showUploadWindow = false;
  }
}
