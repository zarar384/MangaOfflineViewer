import { Component, OnInit } from '@angular/core';
@Component({
  selector: 'app-reader',
  standalone: true, 
  template: `
    <div style="padding:24px; color:#fff;">
      <h2>Reader (placeholder)</h2>
      <p>This is a placeholder reader page. Query string: <strong>{{ query }}</strong></p>
      <div *ngIf="pages?.length">
        <h3>Pages preview</h3>
        <div *ngFor="let p of pages"><img [src]="p" style="max-width:300px; display:block; margin-bottom:8px;" /></div>
      </div>
    </div>
  `
})
export class ReaderComponent implements OnInit {
  query = '';
  pages: string[] = [];
  ngOnInit() {
    try {
      const params = new URLSearchParams(window.location.search);
      this.query = params.get('chapterId') || '';
      // fetch from IndexedDB by chapterId
    } catch(e) {}
  }
}
