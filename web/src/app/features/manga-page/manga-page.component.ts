import { CommonModule } from '@angular/common';
import { Component, Input, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Tab } from 'src/app/core/models/tab.model';
import { TabsService } from 'src/app/core/services/tabs.service';
import { UiStateService } from 'src/app/core/services/ui-state.service';
import { ChapterListComponent } from 'src/app/shared/components/movl-chapter-list/movl-chapter-list.component';

@Component({
  selector: 'manga-page',
  templateUrl: './manga-page.component.html',
  styleUrls: ['./manga-page.component.css'],
  imports: [ChapterListComponent, FormsModule, CommonModule],
  standalone: true
})
export class MangaPageComponent {

  @Input() tabId!: number;

  tab?: Tab;
  previewUrl?: string;

  constructor(
    private tabsService: TabsService,
    private uiState: UiStateService
  ) {}

  async ngOnInit() {
    const data = await this.tabsService.getTabById(this.tabId);
    if (!data) return;

    this.tab = data.tab;
    this.previewUrl = data.previewUrl;
  }

  edit() {
    this.uiState.setEditMode(true);
  }

  async save() {
    if (!this.tab) return;
    await this.tabsService.updateTab(this.tab);
  }

  async delete() {
    await this.tabsService.deleteTab(this.tabId);
  }
}