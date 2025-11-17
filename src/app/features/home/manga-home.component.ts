import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { ImageUploadService } from '../../core/files/image-upload.service';
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
export class MangaHomeComponent implements OnInit {
  @Input() activeManga: string = '';
  @Output() mangaSelected = new EventEmitter<string>();

  pageSize = 10;
  constructor(private uploader: ImageUploadService) { }
  async ngOnInit() {
  }

  async onFiles(event: any) {
    const files: FileList = event.target.files;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const chapter = await this.uploader.importFileAsChapter(f);
      // this.chapters.unshift(chapter);
    }
    // this.updateVisibleTabs();
  }

  onTabSelected(id: string) {
    this.activeManga = id;
    this.mangaSelected.emit(id);
  }

  changePageSize(n: number) {
    this.pageSize = Number(n);
    // this.updateVisibleTabs();
  }


  // windows
  showSettingsWindow = true;

  onSettingsWindowHide() {
    this.showSettingsWindow = false;
  }
}
