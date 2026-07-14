import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal, computed, inject } from '@angular/core';
import { TabsService } from '../../core/services/tabs.service';
import { UiStateService } from '../../core/services/ui-state.service';
import { MolvTabsComponent } from '../../shared/components/molv-tabs/molv-tabs.component';
import { TranslocoPipe } from '@jsverse/transloco';
import { MangaDraftService } from '../../core/services/manga-draft.service';
import { UserTab } from 'src/app/core/models/usertab';
import { ViewMod } from 'src/app/shared/enums/viewmod.enum';

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
  @Output() openSettingsWindowClicked = new EventEmitter<void>();

  selectedMangaId = this.uiState.selectedMangaId;

  // page & perPage as signals (read-only)
  page = computed(() => this.uiState.getValue<number>('page') ?? 1);
  perPage = computed(() => this.uiState.getValue<number>('perPage') ?? 10);

  // just for easier template access
  readonly ViewMod = ViewMod;

  // tabs from service
  private userTabsState = this.tabsService.userTabsState;

  // derived visible tabs
  visibleTabs = computed(() =>
    this.userTabsState()
  );

  async onTabSelected(userTab: UserTab) {    
    // clear any existing draft when selecting a different manga
    this.draftService.clear(); 
    
    this.mangaSelected.emit(userTab.tabId);
  }

  async onTabClosed(userTab: UserTab) {
    await this.tabsService.deleteUserTab(
      userTab.tabId
    );

    if (this.selectedMangaId() === userTab.tabId) {
      this.tabsService.open({ mangaId: null });
    }
  }

  goHome() {
    this.tabsService.open({ mangaId: null });
    this.mangaSelected.emit(null);
  }

  openUploadWindow() {
    this.openUploadWindowClicked.emit();
  }
  
  openSettingsWindow() {
    this.openSettingsWindowClicked.emit();
  }

  changeSidebarVisible() {
    const currentValue = this.uiState.sidebarVisible();
    this.uiState.setSidebarVisible(!currentValue);
  }

  // Getters for template
  get viewMode() {
    return this.uiState.currentView();
  }
}
