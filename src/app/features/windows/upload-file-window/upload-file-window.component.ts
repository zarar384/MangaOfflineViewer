import { Component, EventEmitter, Output, Input, ViewChild } from '@angular/core';
import { WindowComponent } from 'src/app/shared/components/window/window.component';
import { CommonModule } from '@angular/common';
import { DropUploaderComponents } from 'src/app/shared/components/drop-uploader/drop-uploader.components';
import { Tab } from 'src/app/core/models/tab.model';

@Component({
  selector: 'upload-file-window',
  imports: [WindowComponent, CommonModule, DropUploaderComponents],
  templateUrl: './upload-file-window.component.html',
  styleUrls: ['./upload-file-window.component.css'],
  standalone: true
})
export class UploadFileWindowComponent {
  @Input() isVisible = false;
  @Output() closeWindow = new EventEmitter<void>();

  @ViewChild(DropUploaderComponents) dropUploader!: DropUploaderComponents;

  tab: Tab = { name: '' };
  finalName: string | null = null;

  onUploadFinished() {
    console.log('UploadFileWindowComponent - onUploadFinished');
  }

  onWindowClose() {
    this.dropUploader?.clearAll();
    this.closeWindow.emit();
  }

  saveAndClose() {
    this.tab.name = this.finalName ?? 'Untitled';
    this.dropUploader?.saveAll(this.tab);

    this.closeWindow.emit();
  }
}
