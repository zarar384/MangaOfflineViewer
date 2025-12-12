import { Injectable } from '@angular/core';
import { TabsRepository } from '../repositories/tabs.repository';
import { ObjectUrlService } from './object-url.service';
import { Tab } from '../models/tab.model';
import { DEFAULT_PREVIEW } from 'src/assets/assets.config';
import { BehaviorSubject, catchError, EMPTY, forkJoin, from, map, of, switchMap, tap } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class TabsService {
  private tabsSubject = new BehaviorSubject<{ tab: Tab; previewUrl: string }[]>([]);
  tabs$ = this.tabsSubject.asObservable();

  private totalTabsSubject = new BehaviorSubject<number>(0);
  totalTabs$ = this.totalTabsSubject.asObservable();

  constructor(private repo: TabsRepository, private url: ObjectUrlService) { }

  async refreshTabs(page: number, perPage: number) {
    try {
      const tabs = await this.repo.getPaged(page, perPage);

      if (tabs.length === 0) {
        this.tabsSubject.next([]);
        this.totalTabsSubject.next(await this.repo.getTotalCount());
        return;
      }

      // crate preview parallel
      const previewData = await Promise.all(
        tabs.map(async tab => {
          const previewUrl = await this.buildPreview(tab);
          return { tab, previewUrl };
        })
      );

      // refresh state
      this.tabsSubject.next(previewData);

      // refresh total count
      const total = await this.repo.getTotalCount();
      this.totalTabsSubject.next(total);

    } catch (err) {
      console.error('refreshTabs failed', err);
      this.tabsSubject.next([]);
      this.totalTabsSubject.next(0);
    }
  }

  async removeTab(id: number, page: number, perPage: number) {
    await this.repo.delete(id);
    return this.refreshTabs(page, perPage);
  }

  private async buildPreview(tab: Tab): Promise<string> {
    if (tab.preview instanceof Blob) {
      this.url.revokeUrl(tab.name);
      return this.url.createUrl(tab.name, tab.preview);
    }
    return typeof tab.preview === 'string'
      ? tab.preview
      : DEFAULT_PREVIEW;
  }
}
