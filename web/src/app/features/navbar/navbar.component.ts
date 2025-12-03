import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, ViewChild } from '@angular/core';
import { Tab } from 'src/app/core/models/tab.model';
import { TabsService } from 'src/app/core/services/tabs.service';
import { UiStateService } from 'src/app/core/services/ui-state.service';
import { take } from 'rxjs';

@Component({
  selector: 'app-manga-navbar',
  imports: [CommonModule],
  standalone: true,
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css'],
})
export class NavbarComponent implements OnInit {
  @Input() activeManga: number | null = null;
  @Output() mangaSelected = new EventEmitter<number | null>();
  @Output() openUploadWindowClicked = new EventEmitter<void>();

  selectedChapter: Tab | null = null;
  visibleTabs: Tab[] = [];

  constructor(private tabsService: TabsService, private uiState: UiStateService) { }

  ngOnInit() {
    this.tabsService.tabs$.subscribe(tabs => {
      this.visibleTabs = tabs.map(x => x.tab).slice(0, this.perPage);
    });
  }

  get page(): number {
    return this.uiState.getValue<number>('page') ?? 1;
  }

  get perPage(): number {
    return this.uiState.getValue<number>('perPage') ?? 10;
  }

  selectTab(tab: Tab) {
    this.selectedChapter = tab;
    this.mangaSelected.emit(tab.id);
  }

  closeTab(tab: Tab) {
    this.tabsService
      .removeTab(tab.id!, this.page, this.perPage)
      .pipe(take(1))
      .subscribe();

    if (this.selectedChapter?.id === tab.id) {
      this.selectedChapter = null;
    }
  }

  goHome() {
    this.mangaSelected.emit(null);
  }

  openUploadWindow() {
    this.openUploadWindowClicked.emit();
  }
}

