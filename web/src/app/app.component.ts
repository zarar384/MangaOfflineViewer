import { Component } from '@angular/core';
import { LayoutComponent } from './features/layout/layout.component';
import { MolvLoaderComponent } from './shared/components/molv-loader/molv-loader.component';
import { LanguageService } from './core/services/language.service';
import { SwUpdate } from '@angular/service-worker';

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
  constructor(langService: LanguageService, updates: SwUpdate) {
    updates.versionUpdates.subscribe(event => {
      if (event.type === 'VERSION_READY') {
        updates.activateUpdate().then(() => {
          document.location.reload();
        });
      }
    });

    langService.init();
  }
}
