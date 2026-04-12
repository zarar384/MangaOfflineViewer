import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { TabsService } from '../../../core/services/tabs.service';
import { UserTab } from 'src/app/core/models/usertab';

@Component({
  selector: 'molv-tabs',
  standalone: true,
  imports: [CommonModule, TranslocoPipe],
  templateUrl: './molv-tabs.component.html',
  styleUrls: ['./molv-tabs.component.css'],
})
export class MolvTabsComponent {
  @Input() userTabs: UserTab[] = [];
  @Input() selectedUserTab: number | null = null;

  @Output() homeClicked = new EventEmitter<void>();
  @Output() tabSelected = new EventEmitter<UserTab>();
  @Output() tabClosed = new EventEmitter<UserTab>();

  constructor(public tabsService: TabsService) { }

  select(userTab: UserTab) {
    this.tabsService.setActiveTab(userTab.tabId);
    this.tabSelected.emit(userTab);
  }

  close(userTab: UserTab) {
    const isActive = this.tabsService.activeTabIdState() === userTab.tabId;

    if (isActive) {
      this.tabsService.setActiveTab(null);
    }

    this.tabClosed.emit(userTab);

    if (isActive) {
      this.homeClicked.emit();
    }
  }

  goHome() {
    this.tabsService.setActiveTab(null);
    this.homeClicked.emit();
  }
}
