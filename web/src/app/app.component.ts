import { Component } from '@angular/core';
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
  private readonly VERSION_KEY = 'app_version';

  constructor(private updates: SwUpdate, private seedService: SeedService, private loading: LoadingService) {
    if (this.updates.isEnabled) {
      this.updates.versionUpdates.subscribe(event => {
        console.log('[SW]', event.type);

        if (event.type === 'VERSION_READY') {
          this.updates.activateUpdate().then(() => {
            document.location.reload();
          });
        }
      });

      // internet connection restored, check for updates
      window.addEventListener('online', () => {
        this.checkAppVersion();
      });

      // periodic check every 30 seconds when online
      setInterval(() => {
        if (navigator.onLine) {
          this.checkAppVersion();
        }
      }, 30000);
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

  private async checkAppVersion() {
    try {
      const res = await fetch(`/assets/version.json?ts=${Date.now()}`);
      const data = await res.json();

      const serverVersion = data.version;
      const storedVersion = localStorage.getItem(this.VERSION_KEY);

      console.log('Stored:', storedVersion, '| Server:', serverVersion);

      // first run
      if (!storedVersion) {
        localStorage.setItem(this.VERSION_KEY, serverVersion);
        return;
      }

      // new version available
      if (storedVersion !== serverVersion) {
        console.log('New version detected');

        localStorage.setItem(this.VERSION_KEY, serverVersion);

        if (this.updates.isEnabled) {
          await this.updates.checkForUpdate();
        }
      }

    } catch (err) {
      console.warn('Version check failed', err);
    }
  }
}
