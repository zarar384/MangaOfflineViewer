import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { Tab } from 'src/app/core/models/tab.model';
import { TabsRepository } from 'src/app/core/repositories/tabs.repository';
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

  constructor(private tabRepo: TabsRepository) { }

  async ngOnInit() {
    const tabs = await this.tabRepo.getAll();

    this.tabs = await Promise.all(
      tabs.map(async (tab) => ({
        tab,
        previewUrl: await this.getPreviewUrl(tab.preview)
      }))
    );
  }

  private async getPreviewUrl(preview: Blob | string | undefined): Promise<string> {
    if (preview instanceof Blob) {
      return await this.blobToDataUrl(preview);
    } else if (typeof preview === 'string') {
      return preview;
    } else {
      return this.getDefaultPreview();
    }
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
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