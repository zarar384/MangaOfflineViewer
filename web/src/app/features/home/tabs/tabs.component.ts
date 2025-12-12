import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, WritableSignal } from '@angular/core';
import { Subject, switchMap, takeUntil } from 'rxjs';
import { Tab } from 'src/app/core/models/tab.model';
import { LoadingService } from 'src/app/core/services/loading.service';
import { TabsService } from 'src/app/core/services/tabs.service';
import { UiStateService } from 'src/app/core/services/ui-state.service';


@Component({
  selector: 'tabs',
  templateUrl: './tabs.component.html',
  styleUrl: './tabs.component.css',
  standalone: true,
  imports: [CommonModule]
})
export class TabsComponent implements OnInit, OnDestroy {
  @Input() page!: WritableSignal<number>;
  @Input() perPage!: WritableSignal<number>;
  @Output() mangaSelected = new EventEmitter<number>();
  @Output() mangaToEditSelected = new EventEmitter<Tab>();
  @Output() totalTabsChanged = new EventEmitter<number>();

  tabs: { tab: Tab; previewUrl: string }[] = [];

  // destroy$ + takeUntil is better for multiple streams, sub = Subscription, fine for 1–2 subscriptions; 
  private destroy$ = new Subject<void>();

  constructor(
    private tabsService: TabsService,
    private uiState: UiStateService,
    private loading: LoadingService) { }

  ngOnInit() {
    this.uiState.refreshTabs$
      .pipe(
        switchMap(() => this.doRefresh()),
        takeUntil(this.destroy$)
      )
      .subscribe();

    this.tabsService.tabs$
      .pipe(takeUntil(this.destroy$))
      .subscribe(t => this.tabs = t);

    this.tabsService.totalTabs$
      .pipe(takeUntil(this.destroy$))
      .subscribe(t => this.totalTabsChanged.emit(t));
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async doRefresh() {
    try {
      this.loading.show();
      await this.tabsService.refreshTabs(this.page(), this.perPage());
    } finally {
      this.loading.hide();
    }
  }

  async remove(id: number) {
    try {
      this.loading.show();
      try{
      await this.tabsService.removeTab(id, this.page(), this.perPage());
      }
      catch(err){
        console.log('Error while deleting tab', err)
      }
    } finally {
      this.loading.hide();
    }
  }

  openChapterInTab(tabData: { tab: Tab; previewUrl: string }) {
    if (tabData.tab.id) this.mangaSelected.emit(tabData.tab.id);
  }

  openEditWindow(tab: Tab) {
    if (tab) this.mangaToEditSelected.emit(tab);
  }
}
