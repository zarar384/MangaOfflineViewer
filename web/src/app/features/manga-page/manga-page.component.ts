import { CommonModule } from '@angular/common';
import { Component, HostListener, Input, OnChanges, SimpleChanges, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Tab } from 'src/app/core/models/tab.model';
import { TabsService } from 'src/app/core/services/tabs.service';
import { ChapterListComponent } from 'src/app/shared/components/movl-chapter-list/movl-chapter-list.component';
import { TranslocoPipe } from '@jsverse/transloco';
import { MangaDraftService } from 'src/app/core/services/manga-draft.service';

@Component({
  selector: 'manga-page',
  templateUrl: './manga-page.component.html',
  styleUrls: ['./manga-page.component.css'],
  imports: [ChapterListComponent, FormsModule, CommonModule, TranslocoPipe],
  standalone: true
})
export class MangaPageComponent implements OnChanges {

  @Input() activeManga: number | null = null;

  tab = signal<Tab | null>(null);
  isEditMode = signal(false);

  constructor(
    private tabsService: TabsService,
    public draftService: MangaDraftService
  ) {
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['activeManga']) {
      const id = changes['activeManga'].currentValue;
      this.loadManga(id);
    }
  }

  private async loadManga(id: number | null) {
    if (!id) return;

    const draft = this.draftService.getDraft();

    if (draft) {
      this.tab.set(draft.tab);
      this.isEditMode.set(true);
      return;
    }

    const data = await this.tabsService.getTabById(id);
    if (!data) return;

    this.tab.set(data.tab);
    this.isEditMode.set(false);
  }

  // Warn user about unsaved changes
  @HostListener('window:beforeunload', ['$event'])
  unloadNotification($event: any) {
    if (this.isEditMode() && this.draftService.getDraft()) {
      $event.returnValue = true;
    }
  }

  // Actions
  edit() {
    const current = this.tab();
    if (!current) return;

    this.draftService.setDraft(current);
    this.isEditMode.set(true);
  }

  cancel() {
    this.draftService.clear();
    this.isEditMode.set(false);
  }

  async save() {
    const draft = this.draftService.getDraft();
    if (!draft) return;

    let tab = draft.tab;

    if (!tab.id) {
      const id = await this.tabsService.createTab(tab);
      tab = { ...tab, id };
    } else {
      await this.tabsService.updateTab(tab);
    }

    this.tab.set(tab);
    this.isEditMode.set(false);

    this.draftService.clear();
  }

  async delete() {
    const current = this.tab();
    if (!current?.id) return;

    await this.tabsService.deleteTab(current.id);
    this.tab.set(null);
  }

  // Draft updates
  onNameChange(value: string) {
    this.draftService.updateTab({ name: value });
  }

  onDescriptionChange(value: string) {
    this.draftService.updateTab({ description: value });
  }

  // Draft model for edit form
  get draft() {
    const draft = this.draftService.getTab();
    if (!draft) return null;
    return { ...draft };
  }
}