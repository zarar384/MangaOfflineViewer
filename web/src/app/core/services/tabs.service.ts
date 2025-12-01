import { Injectable } from '@angular/core';
import { TabsRepository } from '../repositories/tabs.repository';
import { ObjectUrlService } from './object-url.service';
import { Tab } from '../models/tab.model';
import { DEFAULT_PREVIEW } from 'src/assets/assets.config';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class TabsService {
    private tabsSubject = new BehaviorSubject<{ tab: Tab; previewUrl: string }[]>([]);
    tabs$ = this.tabsSubject.asObservable();

    private totalTabsSubject = new BehaviorSubject<number>(0);
    totalTabs$ = this.totalTabsSubject.asObservable();

    constructor(private tabRepo: TabsRepository, private urlService: ObjectUrlService) { }

    async refreshTabs(page: number, perPage: number) {
        try {
            const tabs = await this.tabRepo.getPaged(page, perPage);
            const processedTabs = await Promise.all(
                tabs.map(async tab => {
                    const previewUrl = await this.getPreviewUrl(tab.name, tab.preview, true);
                    return { tab: { ...tab }, previewUrl };
                })
            );

            const total = await this.tabRepo.getTotalCount();
            this.totalTabsSubject.next(total);
            this.tabsSubject.next(processedTabs);
        } catch {
            this.tabsSubject.next([]);
            this.totalTabsSubject.next(0);
        }
    }

    async removeTab(tabId: number, page: number, perPage: number) {
        await this.tabRepo.deleteTabWithPages(tabId);
        await this.refreshTabs(page, perPage);
    }

    private async getPreviewUrl(name: string, preview: Blob | string | undefined, revoke: boolean = false): Promise<string> {
        if (preview instanceof Blob) {
            if (revoke) this.urlService.revokeUrl(name);
            return this.urlService.createUrl(name, preview);
        } else if (typeof preview === 'string') {
            return preview;
        } else {
            return DEFAULT_PREVIEW;
        }
    }
}
