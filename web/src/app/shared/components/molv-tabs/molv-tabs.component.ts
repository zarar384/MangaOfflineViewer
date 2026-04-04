import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Tab } from '../../../core/models/tab.model';
import { TabsService } from '../../../core/services/tabs.service';

@Component({
  selector: 'molv-tabs',
  standalone: true,
  imports: [CommonModule, TranslocoPipe],
  templateUrl: './molv-tabs.component.html',
  styleUrls: ['./molv-tabs.component.css'],
})
export class MolvTabsComponent {
  @Input() tabs: Tab[] = [];
  @Input() selectedTab: Tab | null = null;

  @Output() homeClicked = new EventEmitter<void>();
  @Output() tabSelected = new EventEmitter<Tab>();
  @Output() tabClosed = new EventEmitter<Tab>();

  constructor(public tabsService: TabsService) { }

  select(tab: Tab) {
    this.tabsService.setActiveTab(tab.id!);
    this.tabSelected.emit(tab);
  }

  close(tab: Tab) {
    const isActive = this.tabsService.activeTabIdState() === tab.id;

    if (isActive) {
      this.tabsService.setActiveTab(null);
    }

    this.tabClosed.emit(tab);

    if (isActive) {
      this.homeClicked.emit();
    }
  }

  goHome() {
    this.tabsService.setActiveTab(null);
    this.homeClicked.emit();
  }
}
