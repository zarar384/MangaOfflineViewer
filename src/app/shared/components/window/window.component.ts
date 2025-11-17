import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-window',
  imports: [CommonModule],
  templateUrl: './window.component.html',
  styleUrls: ['./window.component.css'],
  standalone: true
})
export class WindowComponent {
  @Input() visible = true;
  @Input() title = 'Window';
  @Input() width = '400px';
  @Input() height = '300px';
  @Input() position: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' = 'center';
  @Input() showClose = true;
  @Input() showHide = false;

  @Output() close = new EventEmitter<void>();
  @Output() hide = new EventEmitter<void>();

  onClose() { this.close.emit(); }
  onHide() { this.hide.emit(); }

  get styles() {
    return {
      width: this.width,
      height: this.height,
      ...this.getPositionStyle()
    };
  }

  private getPositionStyle() {
    switch (this.position) {
      case 'center': return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
      case 'top-left': return { top: '0', left: '0' };
      case 'top-right': return { top: '0', right: '0' };
      case 'bottom-left': return { bottom: '0', left: '0' };
      case 'bottom-right': return { bottom: '0', right: '0' };
      default: return {};
    }
  }
}
