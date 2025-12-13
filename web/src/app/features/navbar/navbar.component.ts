import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal, computed, inject } from '@angular/core';
import { Tab } from 'src/app/core/models/tab.model';
import { TabsService } from 'src/app/core/services/tabs.service';
import { UiStateService } from 'src/app/core/services/ui-state.service';
import { MolvTabsComponent } from 'src/app/shared/components/molv-tabs/molv-tabs.component';

@Component({
  selector: 'app-manga-navbar',
  standalone: true,
  imports: [CommonModule, MolvTabsComponent],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css'],
})
export class NavbarComponent {

  private tabsService = inject(TabsService);
  private uiState = inject(UiStateService);

  @Input() activeManga: number | null = null;
  @Output() mangaSelected = new EventEmitter<number | null>();
  @Output() openUploadWindowClicked = new EventEmitter<void>();

  selectedChapter = signal<Tab | null>(null);

  // page & perPage as signals (read-only)
  page = computed(() => this.uiState.getValue<number>('page') ?? 1);
  perPage = computed(() => this.uiState.getValue<number>('perPage') ?? 10);

  // tabs from service
  private tabsState = this.tabsService.tabsState;

  // derived visible tabs
  visibleTabs = computed(() =>
    this.tabsState().map(x => x.tab)
  );

  onTabSelected(tab: Tab) {
    this.selectedChapter.set(tab);
    this.mangaSelected.emit(tab.id);
  }

  async onTabClosed(tab: Tab) {
    await this.tabsService.removeTab(
      tab.id!
    );

    if (this.selectedChapter()?.id === tab.id) {
      this.selectedChapter.set(null);
    }
  }

  goHome() {
    this.selectedChapter.set(null);
    this.mangaSelected.emit(null);
  }

  openUploadWindow() {
    this.openUploadWindowClicked.emit();
  }
}
