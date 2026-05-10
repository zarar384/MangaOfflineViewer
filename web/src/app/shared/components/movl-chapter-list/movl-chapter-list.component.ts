import { CommonModule } from '@angular/common';
import { Component, effect, input } from '@angular/core';
import { ChapterItemComponent } from '../movl-chapter-item/movl-chapter-item.component';
import { TranslocoPipe } from '@jsverse/transloco';
import { ChaptersListService } from '../../../core/services/chapters-list.service';

@Component({
  selector: 'movl-chapter-list',
  templateUrl: './movl-chapter-list.component.html',
  styleUrls: ['./movl-chapter-list.component.css'],
  imports: [CommonModule, ChapterItemComponent, TranslocoPipe],
  standalone: true
})
export class ChapterListComponent {

  activeManga = input<number | null>(null);
  isEditMode = input(false);

  constructor(public listService: ChaptersListService) {
    effect(() => {
      this.listService.setMangaId(this.activeManga());
    });
  }

  get chapters() { return this.listService.displayChapters; }

  addChapter() {
    this.listService.addChapter();
  }
}