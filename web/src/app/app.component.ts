import { Component, inject, NgZone } from '@angular/core';
import { LayoutComponent } from './features/layout/layout.component';
import { MolvLoaderComponent } from './shared/components/molv-loader/molv-loader.component';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';
import { SeedService } from './core/services/seed.service';
import { LoadingService } from './core/services/loading.service';
import { UiStateService } from './core/services/ui-state.service';

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

  showUpdate = false;

  constructor(
    private seedService: SeedService,
    private loading: LoadingService,
    private uiState: UiStateService,
    private zone: NgZone
  ) {
    // in development mode => skip SW update checks
    if (!this.updates?.isEnabled) return;

    // check for sw updates every minute
    setInterval(() => {
      this?.updates?.checkForUpdate();
    }, 60_000);

    this.updates.versionUpdates.subscribe(event => {
      if (event.type === 'VERSION_READY') {
        console.log('[SW] New version available');

        // show update button in settings
        // zone run is needed to trigger change detection from SW event
        this.zone.run(() => {
          this.uiState.setUpdateAvailable(true);
        });
      }
    });

    this.updates.unrecoverable.subscribe(() => {
      document.location.reload();
    });
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