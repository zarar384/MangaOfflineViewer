import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { UiStateService } from 'src/app/core/services/ui-state.service';
import { isIOS } from '../../utils/constants';

@Component({
  selector: 'app-window',
  imports: [CommonModule],
  templateUrl: './window.component.html',
  styleUrls: ['./window.component.css'],
  standalone: true
})
export class WindowComponent implements OnInit {
  @Input() visible = true;
  @Input() title = 'Window';
  @Input() width = '400px';
  @Input() height = '300px';
  @Input() position: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' = 'center';
  @Input() showClose = true;
  @Input() closeDisabled = false;
  @Input() showHide = false;
  @Input() showTransparency = false;
  @Input() blockBackground = true;

  @Output() close = new EventEmitter<void>();
  @Output() hide = new EventEmitter<void>();

  constructor(private uiState: UiStateService) { }
  ngOnInit() {
    // only restore collapsed state if showHide is true
    this.isCollapsed = this.showHide ? this.uiState.getValue<boolean>('windowSettingCollapsed') ?? false : false;
    this.isTransparent = this.showTransparency ? this.uiState.getValue<boolean>('windowSettingTransparent') ?? false : false;

  }

  onClose() { this.close.emit(); }
  onHide() { this.hide.emit(); }

  isCollapsed = false;
  isTransparent = false;

  get styles() {
    if (isIOS) {
      return {
        width: '100vw',
        maxWidth: '100%',        
        height: `min(60vh, ${this.height})`, // vh - portable on iOS Safari 
        ...this.getPositionStyle()
      };
    }

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


  toggleCollapse() {
    this.isCollapsed = !this.isCollapsed;
    this.uiState.saveState({
      windowSettingCollapsed: this.isCollapsed
    });
  }

  toggleTransparency() {
    this.isTransparent = !this.isTransparent;
    this.uiState.saveState({
      windowSettingTransparent: this.isTransparent
    });
  }
}
