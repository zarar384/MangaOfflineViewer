import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
    selector: 'molv-dropdown',
    templateUrl: './molv-dropdown.component.html',
    styleUrls: ['./molv-dropdown.component.css'],
    standalone: false
})
export class MolvDropdownComponent {
    @Input() options: { value: string; label: string }[] = [];
    @Input() value: string = "";

    @Output() valueChange = new EventEmitter<string>();

    onChange(e: Event) {
        const el = e.target as HTMLSelectElement;
        const val = el.value;
        this.value = val;
        this.valueChange.emit(val);

        el.blur();
    }
}
