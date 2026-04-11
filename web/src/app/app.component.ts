import { Component, inject } from '@angular/core';
import { LayoutComponent } from './features/layout/layout.component';
import { MolvLoaderComponent } from './shared/components/molv-loader/molv-loader.component';
import { SwUpdate } from '@angular/service-worker';
import { SeedService } from './core/services/seed.service';
import { LoadingService } from './core/services/loading.service';

@Component({
  selector: 'app-root',
  template: `
      <app-manga-layout></app-manga-layout>
      <molv-loader></molv-loader>
  `,
  standalone: true,
  imports: [LayoutComponent, MolvLoaderComponent]
})
export class AppComponent {

  private updates = inject(SwUpdate, { optional: true });

  constructor(
    private seedService: SeedService,
    private loading: LoadingService
  ) {
    if (this.updates?.isEnabled) {
      this.updates.versionUpdates.subscribe(event => {
        console.log('[SW]', event.type);

        if (event.type === 'VERSION_READY') {
          this.updates?.activateUpdate().then(() => {
            document.location.reload();
          });
        }
      });
    }
  }

  async ngOnInit() {
    try {
      this.loading.show();
      await this.seedService.seedIfNeeded();
    } finally {
      this.loading.hide();
    }
  }
}