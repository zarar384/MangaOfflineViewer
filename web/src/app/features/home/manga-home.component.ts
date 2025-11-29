import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TabsComponent } from './tabs/tabs.component';
import { SettingsWindowComponent } from '../windows/settings-window/settings-window.component';

@Component({
  selector: 'app-manga-home',
  templateUrl: './manga-home.component.html',
  styleUrls: ['./manga-home.component.css'],
  standalone: true,
  imports: [TabsComponent, CommonModule, SettingsWindowComponent]
})
export class MangaHomeComponent {
  @Input() activeManga: number | null = null;
  @Output() mangaSelected = new EventEmitter<number | null>();

  pageSize = 10;
  showSettingsWindow = true;

  onTabSelected(id: number) {
    this.activeManga = id;
    this.mangaSelected.emit(id);
  }

  changePageSize(n: number) {
    this.pageSize = Number(n);
    // this.updateVisibleTabs();
  }

  onSettingsWindowHide() {
    this.showSettingsWindow = false;
  }
}
