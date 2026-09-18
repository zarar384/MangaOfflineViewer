import { Component, computed, signal } from '@angular/core';
import { StorageWidgetComponent } from './components/storage-widget/storage-widget.component';
import { APP_VERSION } from 'src/app/core/generated/app-version';
import { TranslocoPipe } from '@jsverse/transloco';
import { DatePipe } from '@angular/common';

@Component({
  selector: 'app-sidebar',
  imports: [StorageWidgetComponent, TranslocoPipe, DatePipe],
  
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.css'],
})
export class SidebarComponent {
  // App version information
  readonly appVersion = APP_VERSION;

}
