import { Component, Input } from '@angular/core';
import { ReaderSettingsWindowComponent } from '../../windows/reader-settings-window/reader-settings-window.component';
import { CommonModule } from '@angular/common';
import { ReaderComponent } from '../reader-component/reader.component';

@Component({
  selector: 'app-manga-reader',
  imports: [ReaderComponent, ReaderSettingsWindowComponent, CommonModule],
  templateUrl: './reader-wrapper.comoponent.html',
  styleUrl: './reader-wrapper.comoponent.css',
  standalone: true
})
export class ReaderWrapperComoponent {
  @Input() activeManga: string = '';

  pages: string[] = []
  gap = 16;
  mode: 'scroll'|'page' = 'scroll';
  zoom = 1;

    // windows
  showSettingsWindow = true;

  onSettingsWindowHide() {
    this.showSettingsWindow = false;
  }
}
