import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'molv-textbox',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './molv-textbox.html',
  styleUrls: ['./molv-textbox.css']
})
export class MolvTextboxComponent {
  @Input() value: string = '';
  @Input() placeholder: string = '';
  @Input() isEditMode: boolean = true;
  @Input() className: string = '';

  @Output() valueChange = new EventEmitter<string>();

  onInputChange(val: string) {
    this.value = val;
    this.valueChange.emit(this.value);
  }

  stopClick(event: Event) {
    event.stopPropagation();
  }
}