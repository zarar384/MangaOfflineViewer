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

  refreshTabs(page: number, perPage: number) {
    return this.repo.getPaged(page, perPage).pipe(
      switchMap(tabs => {
        if (tabs.length === 0) return of([]);
        return forkJoin(
          tabs.map(tab =>
            from(this.buildPreview(tab)).pipe(
              map(previewUrl => ({ tab, previewUrl }))
            )
          )
        );
      }),
      tap(data => this.tabsSubject.next(data)),
      switchMap(() => this.repo.getTotalCount()),
      tap(total => this.totalTabsSubject.next(total)),
      catchError(() => {
        this.tabsSubject.next([]);
        this.totalTabsSubject.next(0);
        return EMPTY;
      })
    );
  }

  removeTab(id: number, page: number, perPage: number) {
    return this.repo.delete(id).pipe(
      switchMap(() => this.refreshTabs(page, perPage))
    );
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
