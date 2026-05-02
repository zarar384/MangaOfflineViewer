import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
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
  @Input() activeTabId: number | null = null;

  @Output() homeClicked = new EventEmitter<void>();
  @Output() tabSelected = new EventEmitter<UserTab>();
  @Output() tabClosed = new EventEmitter<UserTab>();
}