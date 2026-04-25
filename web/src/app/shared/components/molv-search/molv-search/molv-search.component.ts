import { Component, EventEmitter, Output, signal, } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { debounceTime, Subject } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';

@Component({
  selector: 'molv-search',
  standalone: true,
imports: [ CommonModule, FormsModule, MatFormFieldModule, MatInputModule, TranslocoPipe  ],
  templateUrl: './molv-search.component.html',
  styleUrls: ['./molv-search.component.css']
})
export class MolvSearchComponent {

  @Output() searchChange = new EventEmitter<string>();

  search = signal('');

  private searchSubject = new Subject<string>();

  constructor() {
    // debounce (so as not to emit on every keystroke) and subscribe to search changes
    this.searchSubject
      .pipe(debounceTime(300))
      .subscribe(value => {
        this.searchChange.emit(value);
      });
  }

  onInput(value: string) {
    this.search.set(value);
    this.searchSubject.next(value);
  }

  clear() {
    this.search.set('');
    this.searchSubject.next('');
  }
}