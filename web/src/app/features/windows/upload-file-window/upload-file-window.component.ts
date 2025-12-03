import { Component, EventEmitter, Output, Input} from '@angular/core';
import { WindowComponent } from 'src/app/shared/components/window/window.component';
import { CommonModule } from '@angular/common';
import { DropUploaderComponents } from 'src/app/shared/components/drop-uploader/drop-uploader.components';
import { Tab } from 'src/app/core/models/tab.model';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';

@Component({
  selector: 'upload-file-window',
  imports: [WindowComponent, CommonModule, DropUploaderComponents, FormsModule],
  templateUrl: './upload-file-window.component.html',
  styleUrls: ['./upload-file-window.component.css'],
  standalone: true
})
export class UploadFileWindowComponent {
  @Input() isVisible = false;
  @Output() closeWindow = new EventEmitter<void>();

  tab: Tab = { name: '' };
  finalName: string | null = null;

  saveAll$ = new Subject<Tab>();
  clearAll$ = new Subject<void>();

  onUploadFinished() {
    console.log('UploadFileWindowComponent - onUploadFinished');
  }

  onWindowClose() {
    this.finalName = null;
    this.clearAll$.next();
    this.closeWindow.emit();
  }

  saveAndClose() {
    this.tab.name = this.finalName ?? 'Untitled';
    this.saveAll$.next(this.tab);
    this.onWindowClose();
  }
}
