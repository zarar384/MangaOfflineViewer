import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'molv-dropdown',
  templateUrl: './molv-dropdown.component.html',
  styleUrls: ['./molv-dropdown.component.css'],
  standalone: false
})
export class MolvDropdownComponent {
  @Input() options: { value: any; label: string }[] = [];
  @Input() value: any;
  @Output() valueChange = new EventEmitter<any>();

  onChange(e: Event) {
  const select = e.target as HTMLSelectElement;
  const index = select.selectedIndex;

  const val = this.options[index]?.value; // original value

  this.value = val;
  this.valueChange.emit(val);
}

}
