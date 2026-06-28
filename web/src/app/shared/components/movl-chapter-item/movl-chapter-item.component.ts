import { CommonModule } from '@angular/common';
import { Component, inject, Input, OnChanges, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { Chapter } from '../../../core/models/chapter.model';
import { PagesRepository } from '../../../core/repositories/pages.repository';
import { Subject } from 'rxjs';
import { MolvDropUploaderComponents } from '../molv-drop-uploader/molv-drop-uploader.components';
import { Tab } from '../../../core/models/tab.model';
import { TabsService } from '../../../core/services/tabs.service';
import { MolvModule } from '../molv-module.component';
import { PageMeta } from '../../models/page-meta.model';
import { ChaptersListService } from '../../../core/services/chapters-list.service';
import { BookmarksService } from 'src/app/core/services/bookmarks.service';

@Component({
  selector: 'movl-chapter-item',
  templateUrl: './movl-chapter-item.component.html',
  styleUrls: ['./movl-chapter-item.component.css'],
  imports: [CommonModule, FormsModule, TranslocoPipe, MolvDropUploaderComponents, MolvModule],
  standalone: true
})
export class ChapterItemComponent implements OnChanges {

  @Input({ required: true }) chapter!: Chapter;
  @Input() isGlobalEditMode = false; // if true, all items are in edit mode

  private listService = inject(ChaptersListService);

  pages: PageMeta[] = [];
  pagesCount = 0;
  isOpen = false;

  // Uploader
  isEditMode = false;
  saveAll$ = new Subject<[Tab, Chapter | undefined]>();
  clearAll$ = new Subject<void>();

  editTitle: string = '';
  filesProcessing = false;

  constructor(
    private pagesRepo: PagesRepository,
    private tabService: TabsService,
    private bookmarksService: BookmarksService
  ) { }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['chapter']?.currentValue) {
      this.loadCount();
    }
  }

  toggle() {
    this.isOpen = !this.isOpen;

    if (this.isOpen) {
      this.loadPages();
    } else {
      this.pages = []; // free up memory
    }
  }

  upload(event: Event) {
    event.stopPropagation();

    this.isOpen = true;
    this.isEditMode = true;
    this.editTitle = this.chapter.title;
    this.loadPages();
  }

  // Uploader 
  onUploadFinished() {
    // this.showUploader = false;
    // this.loadPages();
  }

  async openChapter() {
    if (!this.chapter.id) return;

    this.tabService.open({
      mangaId: this.chapter.tabId!,
      pageId: null, // first
      chapterId: this.chapter.id!
    });
  }

  openPage(pageId: number) {
    this.tabService.open({
      mangaId: this.chapter.tabId!,
      pageId: pageId,
      chapterId: this.chapter.id!
    });
  }

  private async loadPages() {
    if (!this.chapter.id) {
      this.pages = [];
      return;
    }

    const meta = await this.pagesRepo.getMetaByChapter(this.chapter.id);

    this.pages = meta; // load metadata first for quick display
  }

  private async loadCount() {
    if (!this.chapter.id) {
      this.pagesCount = 0;
      return;
    }

    this.pagesCount = await this.pagesRepo.countByChapter(this.chapter.id);
  }

  // EDIT MODE ACTIONS
  cancel() {
    this.clearAll$.next();
    this.isEditMode = false;
    this.isOpen = false;
  }

  async saveAndClose() {
    try {
      this.chapter.title = this.editTitle?.trim() || `Chapter ${this.chapter.id}`;

      const tab = await this.tabService.getTabById(this.chapter.tabId!);

      if (!tab) {
        console.error('Tab not found');
        return;
      }

      this.saveAll$.next([tab, this.chapter]);
      this.clearAll$.next();

      // wait for save to complete before closing edit mode
      queueMicrotask(async () => {
        await this.listService.reload();
        this.isEditMode = false;
        this.isOpen = false;
        this.loadCount();
      });
    }
    catch (err) {
      console.error('Error saving tab', err);
    }
    finally {
    }
  }

  async delete() {
    if (!this.chapter.id) return;
    
    try{
     await this.tabService.deleteChapter(this.chapter.id);
      this.clearAll$.next();

      // wait for delete to complete before closing edit mode
      await this.listService.reload();

      queueMicrotask(() => {
        this.isEditMode = false;
        this.isOpen = false;
      });

    }
    catch (err) {
      console.error('Error deleting chapter', err);
    }
  }

  onOrderChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const newOrder = parseInt(input.value, 10);

    if (isNaN(newOrder) || newOrder < 1)
      return;

    this.listService.moveChapter(this.chapter.id!, newOrder);
  }

  // Bookmarks
  get bookmarksCount(): number {
    if (!this.chapter.id) return 0;
    return this.bookmarksService.getBookmarksCount(this.chapter.id);
  }

  hasBookmark(pageId: number): boolean {
    if (!this.chapter.id) return false;
    return this.bookmarksService.hasBookmark(this.chapter.id, pageId);
  }
}