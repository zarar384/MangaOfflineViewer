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
    const target = event.target as HTMLInputElement;
    // Revert the checkbox state immediately to prevent UI lag
    // The actual state change will be handled by the parent component via the checkedChange event
    target.checked = this.checked;
    this.checkedChange.emit(!this.checked);
  }
}