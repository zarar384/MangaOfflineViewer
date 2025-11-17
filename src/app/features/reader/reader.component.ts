import { CommonModule } from '@angular/common';
import { Component, Input, OnInit } from '@angular/core';
@Component({
  selector: 'app-manga-reader',
  templateUrl: '/reader.component.html',
  styleUrls: ['./reader.component.css'],
  standalone: true, 
    imports: [CommonModule]
})
export class ReaderComponent implements OnInit {
  @Input() activeManga: string = '';
  pages: string[] = []; // remove
  ngOnInit() {
    try {
      // fetch from IndexedDB by chapterId
    } catch(e) {}
  }
}
