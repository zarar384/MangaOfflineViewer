import { CommonModule } from '@angular/common';
import { Component, inject, Input, OnChanges, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { Chapter } from '../../../core/models/chapter.model';
import { Page } from '../../../core/models/page.model';
import { PagesRepository } from '../../../core/repositories/pages.repository';
import { Subject } from 'rxjs';
import { MolvDropUploaderComponents } from '../molv-drop-uploader/molv-drop-uploader.components';
import { Tab } from '../../../core/models/tab.model';
import { TabsService } from '../../../core/services/tabs.service';
import { ViewMod } from '../../enums/viewmod.enum';
import { ReaderService } from '../../../core/services/reader.service';

@Component({
  selector: 'movl-chapter-item',
  templateUrl: './movl-chapter-item.component.html',
  styleUrls: ['./movl-chapter-item.component.css'],
  imports: [CommonModule, FormsModule, TranslocoPipe, MolvDropUploaderComponents],
  standalone: true
})
export class ChapterItemComponent implements OnChanges {

  @Input({ required: true }) chapter!: Chapter;

  pages: Page[] = [];
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
    private reader: ReaderService
  ) { }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['chapter']?.currentValue) {
      this.loadPages();
    }
  }

  toggle() {
    this.isOpen = !this.isOpen;
  }

   upload(event: Event) {
    event.stopPropagation();

    this.isOpen = true;
    this.isEditMode = true;
    this.editTitle = this.chapter.title;
  }

  // Uploader 
  onUploadFinished() {
    // this.showUploader = false;
    // this.loadPages();
  }

  openChapter() {
    this.reader.open({
      mangaId: this.chapter.tabId!,
      chapterId: this.chapter.id!,
      pages: this.pages,
      currentPageId: this.pages[0]?.id
    });

    this.tabService.setSelectedManga(this.chapter.tabId, ViewMod.Single);
  }

  openPage(pageId: number) {
    this.reader.open({
      mangaId: this.chapter.tabId!,
      chapterId: this.chapter.id!,
      pages: this.pages,
      currentPageId: pageId
    });

    this.tabService.setSelectedManga(this.chapter.tabId, ViewMod.Single);
  }
  private async loadPages() {
    if (!this.chapter.id) {
      this.pages = [];
      return;
    }

    const allTabPages = await this.pagesRepo.getAll(this.chapter.tabId);
    this.pages = allTabPages.filter(page => page.chapterId === this.chapter.id);
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
        this.isEditMode = false;
    await this.loadPages();
        });
    }
    catch (err) {
      console.error('Error saving tab', err);
    }
    finally {
    }
  }
}