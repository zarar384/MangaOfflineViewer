import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { StorageInfoService } from 'src/app/core/services/storage-info.service';

@Component({
  selector: 'app-storage-widget',
  standalone: true,
  templateUrl: './storage-widget.component.html',
  styleUrls: ['./storage-widget.component.css'],
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StorageWidgetComponent {

  protected readonly storage = inject(StorageInfoService);

}