import { CommonModule } from '@angular/common';
import { Component, HostListener, Input, OnChanges, OnInit, signal } from '@angular/core';
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

  tab?: Tab;
  editModel?: Tab;

  isEditMode = signal(false);

  constructor(
    private tabsService: TabsService,
    private draftService: MangaDraftService
  ) {
  }

  // Warn user about unsaved changes when trying to close the tab or refresh the page
  @HostListener('window:beforeunload', ['$event'])
  unloadNotification($event: any) {
    if (this.isEditMode() && this.draftService.getDraft()) {
      $event.returnValue = true;
    }
  }

  async ngOnChanges() {
    this.isEditMode.set(false);
    
    const draftTab = this.draftService.getDraft();

    // Use the draft and enter edit mode 
    if (draftTab) {
      this.tab = draftTab;
      this.editModel = { ...draftTab };
      this.isEditMode.set(true);

      console.log('Loaded draft for manga', draftTab);
      return;
    }

    if (!this.activeManga) return;
    const data = await this.tabsService.getTabById(this.activeManga);
    if (!data) return;

    this.tab = data.tab;
  }

  cancel() {
    this.isEditMode.set(false);
  }

  edit() {
    if (!this.tab) return;

    this.editModel = { ...this.tab };
    this.isEditMode.set(true);
  }

  async save() {
    if (!this.editModel) return;

    if (!this.editModel.id) {
      // Create new tab
      const id = await this.tabsService.createTab(this.editModel);
      this.tab = { ...this.editModel, id: id };
    } else {
      // Update existing tab
      await this.tabsService.updateTab(this.editModel);
    }
    this.tab = { ...this.editModel! };
    this.isEditMode.set(false);

    this.draftService.clear();
  }

  async delete() {
    if (!this.activeManga) return;
    await this.tabsService.deleteTab(this.activeManga);
  }

  // UPDATE DRAFT 
  onNameChange(value: string) {
    this.editModel!.name = value;
    this.draftService.updateDraft({ name: value });
  }

  onDescriptionChange(value: string) {
    this.editModel!.description = value;
    this.draftService.updateDraft({ description: value });
  }
}