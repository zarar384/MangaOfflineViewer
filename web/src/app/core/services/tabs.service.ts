import { Injectable, signal, effect } from '@angular/core';
import { TabsRepository } from '../repositories/tabs.repository';
import { ObjectUrlService } from './object-url.service';
import { UiStateService } from './ui-state.service';
import { ViewMod } from '../../shared/enums/viewmod.enum';
import { DEFAULT_PREVIEW } from '../../../assets/assets.config';
import { ReaderService } from './reader.service';
import { PagesRepository } from '../repositories/pages.repository';
import { MangaDraftService } from './manga-draft.service';
import { UserTabsRepository } from '../repositories/usertab.repository';
import { UserTab } from '../models/usertab';
import { Tab } from '../models/tab.model';
import { PageMeta } from 'src/app/shared/models/page-meta.model';

@Injectable({ providedIn: 'root' })
export class TabsService {

  private page = signal(1);
  private perPage = signal(10);
  private hydrated = signal(false);

  private userTabs = signal<UserTab[]>([]);
  readonly userTabsState = this.userTabs.asReadonly();

  private tabs = signal<{ tab: Tab; previewUrl: string }[]>([]);
  readonly tabsState = this.tabs.asReadonly();

  private totalTabs = signal(0);
  readonly totalTabsState = this.totalTabs.asReadonly();

  private activeTabId = signal<number | null>(null);
  readonly activeTabIdState = this.activeTabId.asReadonly();

  constructor(
    private repo: TabsRepository,
    private url: ObjectUrlService,
    private uiState: UiStateService,
    private pagesRepo: PagesRepository,
    private reader: ReaderService,
    private draftService: MangaDraftService,
    private userTabsRepo: UserTabsRepository
  ) {
    const savedActive = this.uiState.getValue<number>('activeTabId');
    if (savedActive !== null) {
      this.activeTabId.set(savedActive);
    }

    effect(() => {
      const active = this.activeTabId();
      this.uiState.saveState({ activeTabId: active });
    });

    effect(() => {
      if (!this.hydrated()) return;
      this.load(this.page(), this.perPage());
    });
  }

  async getTabById(id: number): Promise<Tab | null> {
    const tab = await this.repo.get(id);
    if (!tab) return null;

    return tab;
  }

  async createTab(tab: Tab) {
    const created = await this.repo.add(tab);
    await this.refresh();
    return created;
  }

  async updateTab(tab: Tab) {
    await this.repo.update(tab);
    await this.userTabsRepo.updateByTabId(tab.id!);
    await this.refresh();
  }

  async deleteTab(id: number) {
    await this.repo.delete(id);
    await this.userTabsRepo.delete(id);
    await this.refresh();
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

  setActiveTab(id: number | null) {
    this.activeTabId.set(id);
  }

  getActiveTabId() {
    return this.activeTabId();
  }

  async createUserTab(tabId: number) {
    const existing = await this.userTabsRepo.get(tabId);
    if (existing) return;

    const tab = await this.getTabById(tabId);
    if (!tab) throw new Error(`Tab with id ${tabId} not found`);

    const newTab: UserTab = {
      name: tab.name || `Tab ${tabId}`,
      tabId,
      createdAt: Date.now()
    };

    await this.userTabsRepo.put(newTab);

    this.userTabs.update(tabs => [...tabs, newTab]);
  }

  async deleteUserTab(tabId: number) {
    await this.userTabsRepo.delete(tabId);

    this.userTabs.update(tabs =>
      tabs.filter(t => t.tabId !== tabId)
    );
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
    this.userTabs.set(await this.userTabsRepo.getAll());
  }

  async removeTab(id: number) {
    await this.repo.delete(id);
    await this.userTabsRepo.delete(id);
    this.load(this.page(), this.perPage());
  }

  async refresh() {
    await this.load(this.page(), this.perPage());
  }

  public async buildPreview(tab: Tab): Promise<string> {
    // already a URL string
    if (typeof tab.preview === 'string') {
      return tab.preview;
    }

    // create a new
    if (tab.preview instanceof Blob) {
      return this.url.createUrl(String(tab.id ?? tab.name), tab.preview);
    }

    return tab.preview ?? DEFAULT_PREVIEW;
  }

  async open({
    mangaId,
    pageId = null,
    chapterId = null
  }: {
    mangaId: number;
    pageId?: number | null;
    chapterId?: number | null;
  }) {

    // clear states
    this.draftService.clear();
    this.reader.close();

    const tab = await this.getTabById(mangaId);
    if (!tab) {
      await this.setSelectedManga(null);
      return;
    }

    // open chapter view
    if (tab.mode === ViewMod.Chapters && chapterId === null) {
      await this.setSelectedManga(mangaId, ViewMod.Chapters);
      return;
    }

    // load pages 
    let pages: PageMeta[] = [];

    if (chapterId) {
      pages = await this.pagesRepo.getMetaByChapter(chapterId);
    } else {
      pages = await this.pagesRepo.getMeta(mangaId);
    }

    if (!pages.length) return;

    // determine current page id
    const currentPageId = pageId ?? pages[0].id!;

    // open reader 
    this.reader.open({
      mangaId,
      chapterId,
      pages,
      currentPageId
    });

    // set mode in UI
    await this.setSelectedManga(mangaId, ViewMod.Single);
  }

  // UI STATE INTERACTIONS
  async setSelectedManga(mangaId: number | null, mod: ViewMod | null = null) {
    {
      // if no mangaId is provided, navigate to home and clear selection
      if (!mangaId) {
        this.uiState.navigate(ViewMod.Home);
        this.uiState.setSelectedManga(null);
        return;
      }

      // try to find the tab by mangaId. If not found, navigate home and clear selection
      const tab = await this.getTabById(mangaId);
      if (!tab) {
        this.uiState.navigate(ViewMod.Home);
        this.uiState.setSelectedManga(null);
        return;
      }

      // set the selected manga in UI state and navigate based on tab mode
      this.uiState.setSelectedManga(mangaId);

      const mode = mod ?? tab.mode ?? ViewMod.Single;

      if (mode === ViewMod.Chapters)
        this.uiState.navigate(ViewMod.Chapters);
      else {
        this.uiState.navigate(ViewMod.Single);
      }

      this.setActiveTab(mangaId);
    }
  }

  // Invalidate object URL for a tab's preview when it's updated or deleted
  invalidatePreview(id: number) {
    this.url.revokeUrl(String(id));
  }
}
