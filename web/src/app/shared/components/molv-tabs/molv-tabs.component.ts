import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Tab } from 'src/app/core/models/tab.model';

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

  select(tab: Tab) {
    this.tabSelected.emit(tab);
  }

  close(tab: Tab) {
    this.tabClosed.emit(tab);
  }

  goHome() {
    this.homeClicked.emit();
  }
}
