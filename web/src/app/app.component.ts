import { Component } from '@angular/core';
import { LayoutComponent } from './features/layout/layout.component';
import { MolvLoaderComponent } from './shared/components/molv-loader/molv-loader.component';
import { LanguageService } from './core/services/language.service';

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
  constructor(langService: LanguageService){
    langService.init();
  }
}
