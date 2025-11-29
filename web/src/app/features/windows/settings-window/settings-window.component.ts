import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { WindowComponent } from 'src/app/shared/components/window/window.component';

@Component({
  selector: 'settings-window',
  imports: [CommonModule, WindowComponent],
  templateUrl: './settings-window.component.html',
  styleUrl: './settings-window.component.css',
  standalone: true
})
export class SettingsWindowComponent {
  @Input() isVisible = false;
  @Output() hideWindow = new EventEmitter<void>();

  onWindowHide() {
    this.hideWindow.emit();
  }
}
