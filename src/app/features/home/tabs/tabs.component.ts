import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { IndexedDbService, MangaChapter } from 'src/app/core/database/indexeddb.service';

@Component({
  selector: 'tabs',
  templateUrl: './tabs.component.html',
  styleUrl: './tabs.component.css',
  standalone: true,
  imports: [CommonModule]
})
export class TabsComponent implements OnInit {
  @Output() mangaSelected = new EventEmitter<string>();
  chapters: MangaChapter[] = [];

  constructor(private db: IndexedDbService) { }
  async ngOnInit() {
    this.chapters = await this.db.getAllChapters();
  }
    openChapterInTab(ch: MangaChapter) {
    this.mangaSelected.emit(ch.id);
  }
}
