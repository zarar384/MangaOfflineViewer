import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal, computed, inject } from '@angular/core';
import { Tab } from '../../core/models/tab.model';
import { TabsService } from '../../core/services/tabs.service';
import { UiStateService } from '../../core/services/ui-state.service';
import { MolvTabsComponent } from '../../shared/components/molv-tabs/molv-tabs.component';
import { TranslocoPipe } from '@jsverse/transloco';
import { MangaDraftService } from '../../core/services/manga-draft.service';

@Component({
  selector: 'app-manga-navbar',
  standalone: true,
  imports: [CommonModule, MolvTabsComponent, TranslocoPipe],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css'],
})
export class NavbarComponent {

  private tabsService = inject(TabsService);
  private uiState = inject(UiStateService);
  private draftService = inject(MangaDraftService);

  @Input() activeManga: number | null = null;
  @Output() mangaSelected = new EventEmitter<number | null>();
  @Output() openUploadWindowClicked = new EventEmitter<void>();

  selectedMangaId = this.uiState.selectedMangaId;

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
    if (tab.id == this.selectedMangaId()) return;

    // clear any existing draft when selecting a different manga
    this.draftService.clear(); 

    this.tabsService.setSelectedManga(tab.id!);
    this.mangaSelected.emit(tab.id);
  }

  async onTabClosed(tab: Tab) {
    await this.tabsService.removeTab(
      tab.id!
    );

    if (this.selectedMangaId() === tab.id) {
      this.tabsService.setSelectedManga(null);
    }
  }

  goHome() {
    this.tabsService.setSelectedManga(null);
    this.mangaSelected.emit(null);
  }

  openUploadWindow() {
    this.openUploadWindowClicked.emit();
  }
}
