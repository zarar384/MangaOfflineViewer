import { CommonModule } from '@angular/common';
import { Component, HostListener, Input, OnChanges, SimpleChanges, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Tab } from 'src/app/core/models/tab.model';
import { TabsService } from 'src/app/core/services/tabs.service';
import { ChapterListComponent } from 'src/app/shared/components/movl-chapter-list/movl-chapter-list.component';
import { TranslocoPipe } from '@jsverse/transloco';
import { MangaDraftService } from 'src/app/core/services/manga-draft.service';
import { createPreview } from 'src/app/shared/utils/preview';
import { PREVIEW_MAX_SIZE } from 'src/app/core/db.config';

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
  previewUrl = signal<string | null>(null);

  constructor(
    private tabsService: TabsService,
    public draftService: MangaDraftService
  ) {
    effect(() => {
      this.updatePreview();
    });
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

    const tab = await this.tabsService.getTabById(id);
    if (!tab) return;

    this.tab.set(tab);
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

    try {
      // create preview if new file is selected
      if (tab.preview) {
        tab =
        {
          ...tab,
          preview: await createPreview(tab.preview, PREVIEW_MAX_SIZE)
        }
      }

      // save or update tab 
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
    catch (error) {
      console.error('Save failed:', error);
    }
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

  // Handle file selection and update draft
  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];

    if (!file.type.startsWith('image/')) return;

    // Update draft with new file
    this.draftService.updateTab({ preview: file });
  }

  // preview handling
  private async updatePreview() {
    // from draft if in edit mode, otherwise from tab
    const draft = this.draftService.getTab();

    if (this.isEditMode() && draft?.preview) {
      const url = await this.tabsService.buildPreview(draft);
      this.previewUrl.set(url);
      return;
    }

    // from tab
    const tab = this.tab();
    if (!tab) {
      this.previewUrl.set(null);
      return;
    }

    const url = await this.tabsService.buildPreview(tab);
    this.previewUrl.set(url);
  }

  // Draft model for edit form
  get draft() {
    const draft = this.draftService.getTab();
    if (!draft) return null;
    return { ...draft };
  }
}