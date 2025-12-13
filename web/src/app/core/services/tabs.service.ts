import { Injectable, signal, effect } from '@angular/core';
import { TabsRepository } from '../repositories/tabs.repository';
import { ObjectUrlService } from './object-url.service';
import { Tab } from '../models/tab.model';
import { DEFAULT_PREVIEW } from 'src/assets/assets.config';

@Injectable({ providedIn: 'root' })
export class TabsService {

  private page = signal(1);
  private perPage = signal(10);
  private hydrated = signal(false);

  private tabs = signal<{ tab: Tab; previewUrl: string }[]>([]);
  readonly tabsState = this.tabs.asReadonly();

  private totalTabs = signal(0);
  readonly totalTabsState = this.totalTabs.asReadonly();

  constructor(
    private repo: TabsRepository,
    private url: ObjectUrlService
  ) {
    effect(() => {
      if (!this.hydrated()) return;
      this.load(this.page(), this.perPage());
    });
  }

  hydrate(page: number, perPage: number) {
    this.page.set(page);
    this.perPage.set(perPage);
    this.hydrated.set(true);
  }

  setPaging(page: number, perPage: number) {
    this.page.set(page);
    this.perPage.set(perPage);
  }

  private async load(page: number, perPage: number) {
    const tabs = await this.repo.getPaged(page, perPage);

    const previewData = await Promise.all(
      tabs.map(async tab => ({
        tab,
        previewUrl: await this.buildPreview(tab)
      }))
    );

    this.tabs.set(previewData);
    this.totalTabs.set(await this.repo.getTotalCount());
  }

  async removeTab(id: number) {
    await this.repo.delete(id);
    this.load(this.page(), this.perPage());
  }

  async refresh() {
    await this.load(this.page(), this.perPage());
  }


  private async buildPreview(tab: Tab): Promise<string> {
    if (tab.preview instanceof Blob) {
      this.url.revokeUrl(tab.name);
      return this.url.createUrl(tab.name, tab.preview);
    }
    return tab.preview ?? DEFAULT_PREVIEW;
  }
}
