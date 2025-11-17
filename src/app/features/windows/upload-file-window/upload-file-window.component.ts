import { Component, EventEmitter, Output, Input } from '@angular/core';
import { WindowComponent } from 'src/app/shared/components/window/window.component';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'upload-file-window',
  imports: [WindowComponent, CommonModule],
  templateUrl: './upload-file-window.component.html',
  styleUrls: ['./upload-file-window.component.css'],
  standalone: true
})
export class UploadFileWindowComponent {
  @Input() isVisible = true;
  @Output() closeWindow = new EventEmitter<void>();

  onWindowClose() {
    this.closeWindow.emit();
  }
}
