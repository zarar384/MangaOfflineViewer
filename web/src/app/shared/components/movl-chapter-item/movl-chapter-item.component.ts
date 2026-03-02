import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Chapter } from 'src/app/core/models/chapter.model';
import { Page } from 'src/app/core/models/page.model';
import { PagesRepository } from 'src/app/core/repositories/pages.repository';

@Component({
  selector: 'movl-chapter-item',
  templateUrl: './movl-chapter-item.component.html',
  styleUrls: ['./movl-chapter-item.component.css'],
  imports: [CommonModule, FormsModule],
  standalone: true
})
export class ChapterItemComponent implements OnChanges {

  @Input({ required: true }) chapter!: Chapter;

  pages: Page[] = [];
  isOpen = false;

  constructor(
    private pagesRepo: PagesRepository
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['chapter']?.currentValue) {
      this.loadPages();
    }
  }

  toggle() {
    this.isOpen = !this.isOpen;
  }

  upload() {
  }

  openChapter() {
    this.openPage(1);
  }

  openPage(pageNumber: number) {
    void pageNumber;
  }

  private async loadPages() {
    if (!this.chapter.id) {
      this.pages = [];
      return;
    }

    const allTabPages = await this.pagesRepo.getAll(this.chapter.tabId);
    this.pages = allTabPages.filter(page => page.chapterId === this.chapter.id);
  }
}