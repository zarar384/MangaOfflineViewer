import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { Chapter } from 'src/app/core/models/chapter.model';
import { ChaptersRepository } from 'src/app/core/repositories/chapters.repository';
import { ChapterItemComponent } from '../movl-chapter-item/movl-chapter-item.component';

@Component({
  selector: 'movl-chapter-list',
  templateUrl: './movl-chapter-list.component.html',
  styleUrls: ['./movl-chapter-list.component.css'],
  imports: [CommonModule, ChapterItemComponent],
  standalone: true
})
export class ChapterListComponent implements OnChanges {

  @Input() tabId!: number;

  chapters: Chapter[] = [];

  constructor(private chaptersRepo: ChaptersRepository) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['tabId']?.currentValue != null) {
      this.loadChapters();
    }
  }

  async addChapter() {
    const order = await this.chaptersRepo.getNextOrder(this.tabId);
    await this.chaptersRepo.add({
      tabId: this.tabId,
      title: `Chapter ${order}`,
      order,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    await this.loadChapters();
  }

  private async loadChapters() {
    this.chapters = await this.chaptersRepo.getAll(this.tabId);
  }
}