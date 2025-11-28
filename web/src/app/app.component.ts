import { Component } from '@angular/core';
import { LayoutComponent } from './features/layout/layout.component';

@Component({
  selector: 'app-root',
  template: `
      <app-manga-layout></app-manga-layout>
  `,
  standalone: true,
  imports: [LayoutComponent]
})
export class AppComponent {}
