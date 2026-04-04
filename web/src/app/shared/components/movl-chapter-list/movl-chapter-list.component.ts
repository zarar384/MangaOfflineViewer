import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { Chapter } from '../../../core/models/chapter.model';
import { ChaptersRepository } from '../../../core/repositories/chapters.repository';
import { ChapterItemComponent } from '../movl-chapter-item/movl-chapter-item.component';
import { TranslocoPipe } from '@jsverse/transloco';

@Component({
  selector: 'movl-chapter-list',
  templateUrl: './movl-chapter-list.component.html',
  styleUrls: ['./movl-chapter-list.component.css'],
  imports: [CommonModule, ChapterItemComponent, TranslocoPipe],
  standalone: true
})
export class ChapterListComponent implements OnChanges {

  @Input() activeManga: number | null = null;

  chapters: Chapter[] = [];

  constructor(private chaptersRepo: ChaptersRepository) {
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['activeManga']?.currentValue != null) {
      this.loadChapters();
    }
  }

  async addChapter() {
    if (!this.activeManga) return;
    const order = await this.chaptersRepo.getNextOrder(this.activeManga);
    await this.chaptersRepo.add({
      tabId: this.activeManga,
      title: `Chapter ${order}`,
      order,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    await this.loadChapters();
  }

  private async loadChapters() {
    if (!this.activeManga) return;
    this.chapters = await this.chaptersRepo.getAll(this.activeManga);
  }
}