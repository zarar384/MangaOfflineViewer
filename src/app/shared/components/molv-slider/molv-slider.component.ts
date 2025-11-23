import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'molv-slider',
  template: `
    <div class="slider-container">
      <input 
        type="range" 
        [min]="min" 
        [max]="max" 
        [step]="step" 
        [value]="value"
        (input)="onInput($event)"
        class="molv-slider"
      >
      <div class="slider-track">
        <div class="slider-fill" [style.width.%]="fillPercentage"></div>
        <div class="slider-thumb" [style.left.%]="fillPercentage">
          <div class="cat-face"></div>
        </div>
      </div>
    </div>
  `,
  styleUrls: ['./molv-slider.component.css'],
  standalone: false
})
export class MolvSliderComponent {
  @Input() value = 1;
  @Input() min = 0.5;
  @Input() max = 3;
  @Input() step = 0.1;
  @Output() valueChange = new EventEmitter<number>();

  get fillPercentage(): number {
    return ((this.value - this.min) / (this.max - this.min)) * 100;
  }

  onInput(event: Event) {
    const newValue = +(event.target as HTMLInputElement).value;
    this.value = newValue;
    this.valueChange.emit(newValue);
  }
}