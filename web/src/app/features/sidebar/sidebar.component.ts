import { Component, computed, signal } from '@angular/core';
import { StorageWidgetComponent } from './components/storage-widget/storage-widget.component';

@Component({
  selector: 'app-sidebar',
  imports: [StorageWidgetComponent],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.css'],
})
export class SidebarComponent {

}
