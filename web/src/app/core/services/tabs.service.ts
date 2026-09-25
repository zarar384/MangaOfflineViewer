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
import { SearchTagKey, SearchToken, SearchTokenType } from 'src/app/shared/models/search-token.model';
import { ArtistsRepository } from '../repositories/artist.repository';
import { TagsRepository } from '../repositories/tags.repository';
import { ChaptersRepository } from '../repositories/chapters.repository';

@Injectable({ providedIn: 'root' })
export class TabsService {

  private page = signal(1);
  readonly pageState = this.page.asReadonly();

  private perPage = signal(10);
  readonly perPageState = this.perPage.asReadonly();

  // ignore results from older list requests
  private loadToken = 0;
  private openToken = 0;

  private hydrated = signal(false);

  private userTabs = signal<UserTab[]>([]);
  readonly userTabsState = this.userTabs.asReadonly();

  private tabs = signal<{ tab: Tab; previewUrl: string }[]>([]);
  readonly tabsState = this.tabs.asReadonly();

  private totalTabs = signal(0);
  readonly totalTabsState = this.totalTabs.asReadonly();

  private activeTabId = signal<number | null>(null);
  readonly activeTabIdState = this.activeTabId.asReadonly();

  private searchTokens = signal<SearchToken[]>([]);
  private searchQuery = signal('');
  readonly searchQueryState = this.searchQuery.asReadonly();

  constructor(
    private repo: TabsRepository,
    private url: ObjectUrlService,
    private uiState: UiStateService,
    private pagesRepo: PagesRepository,
    private chaptersRepo: ChaptersRepository,
    private reader: ReaderService,
    private draftService: MangaDraftService,
    private userTabsRepo: UserTabsRepository,
    private artistsRepo: ArtistsRepository,
    private tagsRepo: TagsRepository
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

  async deleteChapter(chapterId: number) {
    await this.chaptersRepo.delete(chapterId);
  }

  filterByTokens(
    tokens: SearchToken[],
    query: string
  ) {
    this.searchTokens.set(tokens);
    this.searchQuery.set(query);

    this.page.set(1); // reset to first page in pagination
  }

  setSearchQuery(query: string) {
    this.searchQuery.set(query);
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

  async setBlurred(id: number, isBlurred: boolean): Promise<void> {
    await this.repo.setBlurred(id, isBlurred);

    // blure does not change preview content
    await this.load(this.page(), this.perPage());
  }

  /* FLOW
    Load manga
    Filter out hidden manga
    Load artists and tags
    Sort
    Apply search
    Validate page number
    Apply pagination
    Prepare previews
    Publish results
  */
  private async load(page: number, perPage: number) {
    const requestId = ++this.loadToken;

    // normalize search query (trim + lowercase)
    const tokens = this.searchTokens();
    const hideBlurredManga = this.uiState.hideBlurredContent();

    // reject results when request parameters have changed
    const isCurrentRequest = () =>
      requestId === this.loadToken &&
      page === this.page() &&
      perPage === this.perPage() &&
      tokens === this.searchTokens() &&
      hideBlurredManga === this.uiState.hideBlurredContent();

    // load all tabs from repository
    let allTabs = await this.repo.getAll();

    if (!isCurrentRequest()) return;

    // exclude marked manga before metadata loading and pagination
    if (hideBlurredManga) {
      allTabs = allTabs.filter(tab => !tab.isBlurred);
    }

    // preload artists/tags for filtering
    const artistMap = new Map<number, string[]>();
    const tagMap = new Map<number, string[]>();

    for (const tab of allTabs) {

      // artists
      const artists = await Promise.all(
        (tab.artistIds ?? []).map(id =>
          this.artistsRepo.get(id)
        )
      );

      artistMap.set(
        tab.id!,
        artists
          .filter(Boolean)
          .map(a =>
            (
              a!.normalized ??
              a!.name
            ).toLowerCase()
          )
      );

      // tags
      const tags = await Promise.all(
        (tab.tagIds ?? []).map(id =>
          this.tagsRepo.get(id)
        )
      );

      tagMap.set(
        tab.id!,
        tags
          .filter(Boolean)
          .map(t =>
            (
              t!.normalized ??
              t!.name
            ).toLowerCase()
          )
      );
    }

    // sort by last activity (updatedAt -> createdAt -> id), newest first
    allTabs = [...allTabs].sort((a, b) => {

      const aTime =
        a.updatedAt ??
        a.createdAt ??
        a.id ??
        0;

      const bTime =
        b.updatedAt ??
        b.createdAt ??
        b.id ??
        0;

      return bTime - aTime;
    });

    // filter by search tokens
    if (tokens.length) {

      allTabs = allTabs.filter(tab => {

        const name =
          (tab.name ?? '').toLowerCase();

        const artists =
          artistMap.get(tab.id!) ?? [];

        const tags =
          tagMap.get(tab.id!) ?? [];

        return tokens.every(token => {

          // normal text search
          if (token.type === SearchTokenType.Text) {

            return name.includes(
              token.value.toLowerCase()
            );
          }

          // artist:xxx
          if (
            token.type === SearchTokenType.Tag &&
            token.key === SearchTagKey.Artist
          ) {

            return artists.some(a =>
              a.includes(
                token.value.toLowerCase()
              )
            );
          }

          // tags:xxx
          if (
            token.type === SearchTokenType.Tag &&
            token.key === SearchTagKey.Tags
          ) {

            return tags.some(t =>
              t.includes(
                token.value.toLowerCase()
              )
            );
          }

          return true;
        });
      });
    }

    if (!isCurrentRequest()) return;

    const total = allTabs.length;

    // keep the current page within the filtered list
    const lastPage = Math.max(
      1,
      Math.ceil(total / perPage)
    );

    const currentPage = Math.min(
      Math.max(1, page),
      lastPage
    );

    if (currentPage !== page) {
      this.page.set(currentPage);

      this.uiState.saveState({
        page: currentPage
      });

      // the existing paging effect will load the corrected page
      return;

    }

    // pagination
    const start = (currentPage - 1) * perPage;

    const pagedTabs = allTabs.slice(
      start,
      start + perPage
    );

    // previews
    const previewData = await Promise.all(
      pagedTabs.map(async tab => ({
        tab,
        previewUrl: await this.buildPreview(tab)
      }))
    );

    const userTabs = await this.userTabsRepo.getAll();

    if (!isCurrentRequest()) return;

    // total after filtering
    this.totalTabs.set(total);

    // update state
    this.tabs.set(previewData);

    // load user tabs
    this.userTabs.set(userTabs);
  }

  async removeTab(id: number) {
    await this.repo.delete(id);
    await this.userTabsRepo.delete(id);
    await this.refresh();
  }

  async refresh() {
    this.url.revokeAll();
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
    mangaId = null,
    pageId = null,
    chapterId = null
  }: {
    mangaId: number | null;
    pageId?: number | null;
    chapterId?: number | null;
  }) {
    const token = ++this.openToken;

    // clear states
    this.draftService.clear();
    this.reader.close();

    if (!mangaId) {
      await this.setSelectedManga(null);
      return;
    }

    const tab = await this.getTabById(mangaId);
    if (token !== this.openToken) return;
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

    if (token !== this.openToken || !pages.length) return;

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
  private async setSelectedManga(mangaId: number | null, mod: ViewMod | null = null) {
    const token = this.openToken;
    {
      // if no mangaId is provided, navigate to home and clear selection
      if (!mangaId) {
        this.uiState.navigate(ViewMod.Home);
        this.uiState.setSelectedManga(null);
        return;
      }

      // try to find the tab by mangaId. If not found, navigate home and clear selection
      const tab = await this.getTabById(mangaId);
      if (token !== this.openToken) return;
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
