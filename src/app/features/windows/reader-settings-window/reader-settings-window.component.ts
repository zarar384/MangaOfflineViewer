import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MolvModule } from 'src/app/shared/components/molv-module.component';
import { WindowComponent } from 'src/app/shared/components/window/window.component';

@Component({
  selector: 'reader-settings-window',
  imports: [CommonModule, WindowComponent, MolvModule],
  templateUrl: './reader-settings-window.component.html',
  styleUrl: './reader-settings-window.component.css',
  standalone: true
})
export class ReaderSettingsWindowComponent {
  @Input() isVisible = false;
  @Input() mode: 'scroll' | 'page' = 'scroll';
  @Input() zoomLevel = 0;
  @Input() gapLevel = 0;

  @Output() hideWindow = new EventEmitter<void>();
  @Output() gapChange = new EventEmitter<number>();
  @Output() modeChange = new EventEmitter<'scroll' | 'page'>();
  @Output() zoomLevelChange = new EventEmitter<number>(); 
  @Output() gapLevelChange = new EventEmitter<number>(); 

  onWindowHide() {
    this.hideWindow.emit();
  }

  // MOD
  get modeIsPage(): boolean{
    return this.mode === 'page';
  }

  set modeIsPage(value: boolean){
    this.mode = value? 'page' : 'scroll';
    this.modeChange.emit(this.mode);
  }

  // ZOOM
  get zoom(): number {
    return this.zoomLevel;
  }

  set zoom(value: number) {
    this.zoomLevel = value;
    this.zoomLevelChange.emit(value);
  }

  // RANGE
   get gap(): number {
    return this.gapLevel;
  }

  set gap(value: number) {
    this.gapLevel = value;
    this.gapLevelChange.emit(value);
  }
}
