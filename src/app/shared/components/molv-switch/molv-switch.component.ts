import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'molv-switch',
  template: `
    <label class="switch">
        <input type="checkbox" [checked]="checked" (change)="onChange($event)">
        <span class="slider"></span>
    </label>`,
  styleUrls: ['./molv-switch.component.css'],
  standalone: false
})
export class MolvSwitchComponent {
  @Input() checked = false;
  @Output() checkedChange = new EventEmitter<boolean>();

  onChange(event: Event) {
    const value = (event.target as HTMLInputElement).checked;
    this.checkedChange.emit(value);
  }
}