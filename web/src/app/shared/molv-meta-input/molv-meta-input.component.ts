import { CommonModule } from '@angular/common';
import {  Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ItemMeta } from '../models/item-meta.model';

@Component({
  selector: 'molv-meta-input',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './molv-meta-input.component.html',
  styleUrls: ['./molv-meta-input.component.css']
})
export class MolvMetaInputComponent implements OnChanges {

  @ViewChild('textareaRef', { static: false })
  textareaRef?: ElementRef<HTMLTextAreaElement>;

  @Input() label: string = '';
  @Input() placeholder: string = '';
  @Input() hint: string = '';

  @Input() items: ItemMeta[] = [];
  @Input() suggestions: ItemMeta[] = [];

  @Input() isEditMode: boolean = false;

  @Output() valueChange = new EventEmitter<string>();
  @Output() suggestionSelected = new EventEmitter<string>();

  @Input() value: string = '';

  // ghost autocomplete text
  suggestion = signal('');

  // hide suggestions after ;
  isSeparatorMode = signal(false);

  ngOnChanges(changes: SimpleChanges) {

  this.suggestion.set(
    this.getSuggestion(this.value)
  );

  // textarea recreated after edit mode switch
  if (
    changes['isEditMode'] ||
    changes['value']
  ) {

    setTimeout(() => {
      this.resizeTextarea();
    });
  }
}

  onInput(value: string) {

    this.value = value;

    // separator mode
    const separatorMode = value.trimEnd().endsWith(';');

    this.isSeparatorMode.set(separatorMode);

    this.valueChange.emit(value);

    this.resizeTextarea();

    // recalculate after parent updates suggestions
    queueMicrotask(() => {

      this.suggestion.set(
        this.getSuggestion(this.value)
      );
    });
  }

  // desktop TAB support
  onKeyDown(event: KeyboardEvent) {
    const suggestion = this.suggestion();

    if (event.key === 'Tab' && suggestion) {
      event.preventDefault();

      this.applySuggestionInternal();
    }
  }

  // mobile click fallback
  onClick() {
    if (this.suggestion()) {
      this.applySuggestionInternal();
    }
  }

  selectSuggestion(value: string) {

    const current = this.value;

    const parts = current
      .split(';')
      .map(v => v.trim());

    parts[parts.length - 1] = value;

    // auto add ;
    const newValue =
      parts.filter(Boolean).join('; ') + '; ';

    this.value = newValue;

    // hide suggestions after selection
    this.isSeparatorMode.set(true);

    this.suggestion.set('');

    this.valueChange.emit(newValue);

    this.suggestionSelected.emit(value);
  }

  shouldShowSuggestions(): boolean {
    return !this.isSeparatorMode() && this.suggestions.length > 0;
  }

  // ghost text autocomplete
  getSuggestion(value: string): string {

    if (this.isSeparatorMode()) {
      return '';
    }

    const parts = value.split(';');

    const last =
      parts[parts.length - 1]
        ?.trim()
        .toLowerCase() ?? '';

    if (!last) return '';

    const match = [...this.suggestions]
      .sort((a, b) => a.normalized.length - b.normalized.length)
      .find(s => s.normalized.startsWith(last));

    if (!match) return '';

    if (match.normalized === last) return '';

    // only remaining text
    return match.name.slice(last.length);
  }

  private applySuggestionInternal(): void {

    const suggestion = this.suggestion();

    if (!suggestion) return;

    const parts = this.value.split(';');

    const lastIndex = parts.length - 1;

    parts[lastIndex] =
      (parts[lastIndex] ?? '') + suggestion;

    // auto close with ;
    const newValue =
      parts.join(';').trim() + '; ';

    this.value = newValue;

    this.suggestion.set('');

    this.isSeparatorMode.set(true);

    this.valueChange.emit(newValue);
  }

  private resizeTextarea() {

    if (!this.textareaRef) {
      return;
    }

    const textarea =
      this.textareaRef.nativeElement;

    textarea.style.height = 'auto';

    textarea.style.height =
      textarea.scrollHeight + 'px';

    textarea.style.overflowY = 'hidden';
  }
}