import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { WindowComponent } from 'src/app/shared/components/window/window.component';

@Component({
  selector: 'reader-settings-window',
  imports: [CommonModule, WindowComponent],
  templateUrl: './reader-settings-window.component.html',
  styleUrl: './reader-settings-window.component.css',
  standalone: true
})
export class ReaderSettingsWindowComponent {
  @Input() isVisible = true;
  @Input() mode: 'scroll' | 'page' = 'scroll';

  @Output() hideWindow = new EventEmitter<void>();
  @Output() gapChange = new EventEmitter<number>();
  @Output() modeChange = new EventEmitter<'scroll' | 'page'>();
  @Output() zoomChange = new EventEmitter<number>();

  onWindowHide() {
    this.hideWindow.emit();
  }

    toggleMode(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    const newMode: 'scroll' | 'page' = checked ? 'page' : 'scroll';
    this.mode = newMode; 
    this.modeChange.emit(newMode);
  }
}
