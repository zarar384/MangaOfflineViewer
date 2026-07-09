import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LoadingService } from '../../../core/services/loading.service';

@Component({
  selector: 'molv-loader',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="overlay" [class.visible]="loading()">
      <div class="spinner"></div>
    </div>
  `,
  styleUrls: ['./molv-loader.component.css']
})
export class MolvLoaderComponent {

  private loadingService = inject(LoadingService);

  loading = this.loadingService.isLoading;
}
