import { CommonModule } from '@angular/common';
import { Component, HostListener, Input, OnChanges, OnInit, SimpleChanges, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Tab } from '../../core/models/tab.model';
import { TabsService } from '../../core/services/tabs.service';
import { ChapterListComponent } from '../../shared/components/movl-chapter-list/movl-chapter-list.component';
import { TranslocoPipe } from '@jsverse/transloco';
import { MangaDraftService } from '../../core/services/manga-draft.service';
import { createPreview } from '../../shared/utils/preview';
import { PREVIEW_MAX_SIZE } from '../../core/db.config';

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
    const draft = this.draftService.getDraft();

    if (draft) {
      this.tab.set(draft.tab);
      this.isEditMode.set(true);
      return;
    }

    // TODO: handle case when id is null (e.g. show empty state or redirect to home)
    if (!id) return;

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

  // Clear draft on unload to prevent stale data
  @HostListener('window:unload')
  onUnload() {
    this.draftService.clear();
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

  // save draft changes to tab
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
        
        await this.tabsService.createUserTab(id);
        await this.tabsService.open({ mangaId: id });
      } else {
        await this.tabsService.updateTab(tab);
      }

      if(!this.activeManga){
        this.activeManga = tab.id!;
      }

      this.tab.set(tab);
      this.isEditMode.set(false);

      this.draftService.clear();
    }
    catch (error) {
      console.error('Save failed:', error);
    }
    finally {
      if (tab.id) {
        this.tabsService.invalidatePreview(tab.id);
        await this.tabsService.refresh();
      }

      await this.updatePreview();
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

    await this.updatePreview();
  }

  // preview handling
  private async updatePreview() {
      // from draft if in edit mode, otherwise from tab
      const draft = this.draftService.getTab();

      // edit mode
      if (this.isEditMode() && draft?.preview) {
        if (draft.preview instanceof Blob) {
          const url = URL.createObjectURL(draft.preview);
          this.previewUrl.set(url);
          return;
        }

        // if it's a string
        this.previewUrl.set(draft.preview);
        return;
      }

      // IT'S NOT EDIT MODE, GET PREVIEW URL
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
    return this.draftService.getTab();
  }
}