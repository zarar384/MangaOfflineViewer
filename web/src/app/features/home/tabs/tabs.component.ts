import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, HostListener, Output, QueryList, ViewChildren, computed, effect, inject, signal } from '@angular/core';
import { UiStateService } from '../../../core/services/ui-state.service';
import { TranslocoPipe } from '@jsverse/transloco';
import { Tab } from '../../../core/models/tab.model';
import { LoadingService } from '../../../core/services/loading.service';
import { TabsService } from '../../../core/services/tabs.service';
import { ViewMod } from 'src/app/shared/enums/viewmod.enum';
import { StorageInfoService } from 'src/app/core/services/storage-info.service';

@Component({
  selector: 'tabs',
  standalone: true,
  imports: [CommonModule, TranslocoPipe],
  templateUrl: './tabs.component.html',
  styleUrl: './tabs.component.css',
})
export class TabsComponent {

  private tabsService = inject(TabsService);
  private loading = inject(LoadingService);
  private storageInfo = inject(StorageInfoService);
  private uiState = inject(UiStateService);

  // temporary reveal; never persisted
  private revealedIds = signal<ReadonlySet<number>>(new Set<number>());

  // prevent repeated writes for the same card
  private savingBlurIds = signal<ReadonlySet<number>>(new Set<number>());

  readonly blurError = signal(false);

  @Output() mangaSelected = new EventEmitter<number>();
  @Output() mangaToEditSelected = new EventEmitter<Tab>();

  @ViewChildren('menu')
  menus!: QueryList<ElementRef<HTMLElement>>;

  readonly tabs = computed(() => {
    const showBlurredContent = this.uiState.showBlurredContent();
    const hideBlurredManga = this.uiState.hideBlurredContent();
    const revealedIds = this.revealedIds();
    const savingIds = this.savingBlurIds();

    return this.tabsService.tabsState()
      // immediately hide old results while the list reloads
      .filter(item =>
        !hideBlurredManga ||
        item.tab.isBlurred !== true
      )
      .map(item => {
        const id = item.tab.id;

        return {
          ...item,

          isConcealed:
            item.tab.isBlurred === true &&
            !showBlurredContent &&
            (id === undefined || !revealedIds.has(id)),

          isSavingBlur:
            id !== undefined &&
            savingIds.has(id)
        };
      });
  });

  // expose enum to template
  isSingle = ViewMod.Single;

  // track opened menu for each card
  openedMenuId = signal<number | null>(null);

  constructor() {
    effect(() => {
      // reset temporary reveals when the browsing context changes
      this.tabsService.pageState();
      this.tabsService.perPageState();
      this.uiState.currentView();
      this.uiState.showBlurredContent();
      this.uiState.hideBlurredContent();

      this.revealedIds.set(new Set<number>());
      this.openedMenuId.set(null);
    });
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {

    const target = event.target as Node;

    const clickedInsideMenu =
      this.menus?.some(menu =>
        menu.nativeElement.contains(target)
      );

    if (!clickedInsideMenu) {
      this.openedMenuId.set(null);
    }
  }

  async remove(id: number) {
    try {
      this.loading.show();
      await this.tabsService.removeTab(id);
      await this.storageInfo.refresh();
    } finally {
      this.loading.hide();
    }
  }

  openChapterInTab(tabData: { tab: Tab; previewUrl: string }) {
    if (tabData.tab.id) {
      this.tabsService.setActiveTab(tabData.tab.id);
      this.mangaSelected.emit(tabData.tab.id);
    }
  }

  openEditWindow(tab: Tab) {
    this.mangaToEditSelected.emit(tab);
  }

  // toggle menu for each card
  toggleMenu(id: number) {
    this.openedMenuId.update(current => current === id ? null : id);
  }

  // REVEALED IDS MANAGEMENT
  revealCard(id: number, event: Event): void {

    // revealing must not open the manga
    event.stopPropagation();

    this.revealedIds.update(current => {

      const next = new Set(current);
      next.add(id);

      return next;

    });

  }

  async toggleBlur(tab: Tab, event: Event): Promise<void> {
    event.stopPropagation();

    const id = tab.id;

    if (id === undefined || this.savingBlurIds().has(id)) {
      return;
    }

    this.openedMenuId.set(null);
    this.blurError.set(false);

    this.savingBlurIds.update(current => {
      const next = new Set(current);
      next.add(id);

      return next;
    });

    try {
      await this.tabsService.setBlurred(id, tab.isBlurred !== true);
      
      // a newly marked card must be concealed
      this.revealedIds.update(current => {
        const next = new Set(current);
        next.delete(id);

        return next;
      });
    }
    catch (error) {
      console.error('Error updating manga blur', error);

      this.blurError.set(true);
    }
    finally {

      this.savingBlurIds.update(current => {
        const next = new Set(current);
        next.delete(id);

        return next;
      });
    }
  }
}
