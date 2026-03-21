import { Injectable, signal, effect } from '@angular/core';
import { TabsRepository } from '../repositories/tabs.repository';
import { ObjectUrlService } from './object-url.service';
import { Tab } from '../models/tab.model';
import { DEFAULT_PREVIEW } from 'src/assets/assets.config';
import { UiStateService } from './ui-state.service';
import { ViewMod } from 'src/app/shared/enums/viewmod.enum';

@Injectable({ providedIn: 'root' })
export class TabsService {

  private page = signal(1);
  private perPage = signal(10);
  private hydrated = signal(false);

  private tabs = signal<{ tab: Tab; previewUrl: string }[]>([]);
  readonly tabsState = this.tabs.asReadonly();

  private totalTabs = signal(0);
  readonly totalTabsState = this.totalTabs.asReadonly();

  private activeTabId = signal<number | null>(null);
  readonly activeTabIdState = this.activeTabId.asReadonly();

  constructor(
    private repo: TabsRepository,
    private url: ObjectUrlService,
    private uiState: UiStateService
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

  async getTabById(id: number): Promise<{ tab: Tab; previewUrl: string } | null> {
    const tab = await this.repo.get(id);
    if (!tab) return null;

    return {
      tab,
      previewUrl: await this.buildPreview(tab)
    };
  }

  async createTab(tab: Tab) {
    const created = await this.repo.add(tab);
    await this.refresh();
    return created;
  }

  async updateTab(tab: Tab) {
    await this.repo.update(tab);
    await this.refresh();
  }

  async deleteTab(id: number) {
    await this.repo.delete(id);
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

  // UI STATE INTERACTIONS
  async setSelectedManga(mangaId: number | null) {
    {
      // if no mangaId is provided, navigate to home and clear selection
      if (!mangaId) {
        this.uiState.navigate(ViewMod.Home);
        this.uiState.setSelectedManga(null);
        return;
      }

      // try to find the tab by mangaId. If not found, navigate home and clear selection
      const data = await this.getTabById(mangaId);
      if (!data) {
        this.uiState.navigate(ViewMod.Home);
        this.uiState.setSelectedManga(null);
        return;
      }

      // set the selected manga in UI state and navigate based on tab mode
      this.uiState.setSelectedManga(mangaId);

      const mode = data.tab.mode ?? ViewMod.Single;

      if (mode === ViewMod.Chapters)
        this.uiState.navigate(ViewMod.Chapters);
      else
        this.uiState.navigate(ViewMod.Single);
    }
  }
}
