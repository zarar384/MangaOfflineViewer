import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'molv-dropdown',
  templateUrl: './molv-dropdown.component.html',
  styleUrls: ['./molv-dropdown.component.css'],
  standalone: false,
})
export class MolvDropdownComponent {
  @Input() options: { value: any; label: string }[] = [];
  @Input() value: any;
  @Input() placeholder: string = '';

  @Output() valueChange = new EventEmitter<any>();
}
