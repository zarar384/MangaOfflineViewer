import { Component } from '@angular/core';
import { MangaHomeComponent } from './features/manga-home/manga-home.component';

@Component({
  selector: 'app-root',
  template: `
    <div class="app-shell">
      <app-manga-home></app-manga-home>
    </div>
  `,
  styles: [`.app-shell { min-height: 100vh; }`],
  standalone: true,
  imports: [MangaHomeComponent] // импортируем standalone компонент
})
export class AppComponent {}
