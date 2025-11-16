import { Component, OnInit } from '@angular/core';
import { IndexedDbService, MangaChapter } from '../../core/database/indexeddb.service';
import { ImageUploadService } from '../../core/files/image-upload.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-manga-home',
  templateUrl: './manga-home.component.html',
  styleUrls: ['./manga-home.component.css'],
  standalone: true, 
  imports: [CommonModule]
})
export class MangaHomeComponent implements OnInit {
  chapters: MangaChapter[] = [];
  visibleTabs: MangaChapter[] = [];
  selectedChapter: MangaChapter | null = null;
arr: number[] = [1, 2, 3, 4, 5];
  pageSize = 10;
  constructor(private db: IndexedDbService, private uploader: ImageUploadService) {}
  async ngOnInit() {
    this.chapters = await this.db.getAllChapters();
    this.updateVisibleTabs();
     console.log('arr =', this.arr);

  }
  updateVisibleTabs() {
    this.visibleTabs = this.chapters.slice(0, this.pageSize);
  }
  async onFiles(event: any) {
    const files: FileList = event.target.files;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const chapter = await this.uploader.importFileAsChapter(f);
      this.chapters.unshift(chapter);
    }
    this.updateVisibleTabs();
  }
  openChapterInTab(ch: MangaChapter) {
    const url = '/reader?chapterId=' + encodeURIComponent(ch.id);
    window.open(url, '_blank');
    this.selectedChapter = ch;
  }
  selectTab(ch: MangaChapter) { this.selectedChapter = ch; }
  closeTab(ch: MangaChapter) {
    this.visibleTabs = this.visibleTabs.filter(c => c.id !== ch.id);
    if (this.selectedChapter?.id === ch.id) this.selectedChapter = null;
  }
  changePageSize(n: number) {
    this.pageSize = Number(n);
    this.updateVisibleTabs();
  }
}
