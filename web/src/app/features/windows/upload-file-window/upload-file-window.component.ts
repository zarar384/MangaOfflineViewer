import { Component, EventEmitter, Output, Input } from '@angular/core';
import { WindowComponent } from 'src/app/shared/components/window/window.component';
import { CommonModule } from '@angular/common';
import { Tab } from 'src/app/core/models/tab.model';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { MolvDropUploaderComponents } from 'src/app/shared/components/molv-drop-uploader/molv-drop-uploader.components';
import { TabsService } from 'src/app/core/services/tabs.service';
import { MangaDraftService } from 'src/app/core/services/manga-draft.service';
import { UiStateService } from 'src/app/core/services/ui-state.service';

@Component({
  selector: 'upload-file-window',
  imports: [WindowComponent, CommonModule, MolvDropUploaderComponents, FormsModule],
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

  constructor(
    private uiState: UiStateService,
    private draftService: MangaDraftService) { }

  onUploadFinished() {
    console.log('UploadFileWindowComponent - onUploadFinished');
  }

  openMultiMode() {
    const tab: Tab = {
      name: this.finalName ?? 'Untitled',
      mode: 'chapters'
    };

    this.draftService.setDraft(tab);
    this.closeWindow.emit();

    // Set the view mode to 'chapters' when opening multi-mode
    this.uiState.navigate('chapters');
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
