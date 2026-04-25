import { Component, EventEmitter, Output, signal, } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { debounceTime, Subject } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { SearchTagKey, SearchToken } from 'src/app/shared/models/search-token.model';
import { parseQuery } from 'src/app/shared/utils/search';

@Component({
  selector: 'molv-search',
  standalone: true,
  imports: [CommonModule, FormsModule, MatFormFieldModule, MatInputModule, TranslocoPipe],
  templateUrl: './molv-search.component.html',
  styleUrls: ['./molv-search.component.css']
})
export class MolvSearchComponent {

  @Output() searchChange = new EventEmitter<SearchToken[]>();

  search = signal('');

  // ghost text for autocompletion suggestions
  suggestion = signal('');

  private searchSubject = new Subject<SearchToken[]>();

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

    // calculate suggestion based on last word
    const suggestion = this.getSuggestion(value);
    this.suggestion.set(suggestion);

    this.searchSubject.next(parseQuery(value));
  }

  // reset
  clear() {
    this.search.set('');
    this.searchSubject.next(parseQuery(''));
  }

  // mobile / fallback: apply suggestion on tap
  onClick() {
    if (this.suggestion()) {
      this.applySuggestion();
    }
  }

  // public wrapper
  applySuggestion() {
    this.applySuggestionInternal();
  }

  onKeyDown(event: KeyboardEvent) {
    const suggestion = this.suggestion();

    // desktop TAB to accept suggestion
    if (event.key === 'Tab' && suggestion) {
      event.preventDefault();
      this.applySuggestionInternal();
    }
  }

  getSuggestion(value: string): string {
    // get last typed token
    const parts = value.split(' ');
    const last = parts[parts.length - 1]?.toLowerCase() ?? '';

    // no suggestion if empty or already a tag
    if (!last || last.includes(':')) return '';

    // find matching tag key (artist, genre, ...)
    const match = Object.values(SearchTagKey).find(k => k.startsWith(last));

    // no suggestion if exact match or nothing found
    if (!match || match === last) return '';

    // return only the remaining part (avoid "ggenre")
    return match.slice(last.length) + ':';
  }

  private applySuggestionInternal(): void {
    const suggestion = this.suggestion();
    if (!suggestion) return;

    // replace last token with completed version
    const parts = this.search().split(' ');
    const lastIndex = parts.length - 1;

    parts[lastIndex] = (parts[lastIndex] ?? '') + suggestion;

    const newValue = parts.join(' ') + ' ';

    // update input and clear suggestion
    this.search.set(newValue);
    this.suggestion.set('');

    // emit updated query
    this.searchSubject.next(parseQuery(newValue));
  }
}