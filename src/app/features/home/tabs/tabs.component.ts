import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { Tab } from 'src/app/core/models/tab.model';
import { TabsRepository } from 'src/app/core/repositories/tabs.repository';
import { ObjectUrlService } from 'src/app/core/services/object-url.service';
import { DEFAULT_PREVIEW } from 'src/assets/assets.config';


@Component({
  selector: 'tabs',
  templateUrl: './tabs.component.html',
  styleUrl: './tabs.component.css',
  standalone: true,
  imports: [CommonModule]
})
export class TabsComponent implements OnInit {
  @Output() mangaSelected = new EventEmitter<number>();
  tabs: { tab: Tab; previewUrl: string }[] = [];

  constructor(private tabRepo: TabsRepository, private urlService: ObjectUrlService) { }

  async ngOnInit() {
    const tabs = await this.tabRepo.getAll();

    this.tabs = await Promise.all(
      tabs.map(async (tab) => ({
        tab,
        previewUrl: await this.getPreviewUrl(tab.name, tab.preview)
      }))
    );
  }

  private async getPreviewUrl(name: string, preview: Blob | string | undefined): Promise<string> {
    if (preview instanceof Blob) {
      return this.urlService.createUrl(name, preview);
    } else if (typeof preview === 'string') {
      return preview;
    } else {
      return this.getDefaultPreview();
    }
  }

  private getDefaultPreview(): string {
    return DEFAULT_PREVIEW;
  }

  openChapterInTab(tabData: { tab: Tab; previewUrl: string }) {
    if (tabData.tab.id) {
      this.mangaSelected.emit(tabData.tab.id);
    }
  }

  remove(tabId: number) {
    this.tabRepo.deleteTabWithPages(tabId).then(() => {
      this.tabs = this.tabs.filter(t => t.tab.id !== tabId);
    });
  }
}