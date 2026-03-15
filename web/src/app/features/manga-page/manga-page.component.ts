import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Tab } from 'src/app/core/models/tab.model';
import { TabsService } from 'src/app/core/services/tabs.service';
import { ChapterListComponent } from 'src/app/shared/components/movl-chapter-list/movl-chapter-list.component';
import { TranslocoPipe } from '@jsverse/transloco';

@Component({
  selector: 'manga-page',
  templateUrl: './manga-page.component.html',
  styleUrls: ['./manga-page.component.css'],
  imports: [ChapterListComponent, FormsModule, CommonModule, TranslocoPipe],
  standalone: true
})
export class MangaPageComponent {

  @Input() tabId!: number;

  tab?: Tab;
  editModel?: Tab;
  
  isEditMode = signal(false);

  constructor(
    private tabsService: TabsService,
  ) {
    this.tabId = 1;
  }

  async ngOnInit() {
    const data = await this.tabsService.getTabById(this.tabId);
    if (!data) return;

    this.tab = data.tab;
  }

  cancel(){
    this.isEditMode.set(false);
  }

  edit() {
    if(!this.tab) return;
    
    this.editModel = { ...this.tab };
    this.isEditMode.set(true);
  }

  async save() {
    if (!this.editModel) return;
    await this.tabsService.updateTab(this.editModel);

    this.tab = { ...this.editModel! };
    this.isEditMode.set(false);
  }

  async delete() {
    await this.tabsService.deleteTab(this.tabId);
  }
}