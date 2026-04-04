import { Component, EventEmitter, Output, Input } from '@angular/core';
import { WindowComponent } from '../../../shared/components/window/window.component';
import { CommonModule } from '@angular/common';
import { Tab } from '../../../core/models/tab.model';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { MolvDropUploaderComponents } from '../../../shared/components/molv-drop-uploader/molv-drop-uploader.components';
import { MangaDraftService } from '../../../core/services/manga-draft.service';
import { UiStateService } from '../../../core/services/ui-state.service';
import { ViewMod } from '../../../shared/enums/viewmod.enum';
import { TabsService } from '../../../core/services/tabs.service';
import { Chapter } from '../../../core/models/chapter.model';

@Component({
  selector: 'upload-file-window',
  imports: [WindowComponent, CommonModule, MolvDropUploaderComponents, FormsModule],
  templateUrl: './upload-file-window.component.html',
  styleUrls: ['./upload-file-window.component.css'],
  standalone: true
})
export class UploadFileWindowComponent {
  @Input() isVisible = false;
  @Input() tabId: number | null = null;
  @Input() viewMode: ViewMod | null = null;

  @Output() closeWindow = new EventEmitter<void>();

  tab: Tab = { mode: this.viewMode === ViewMod.Chapters ? ViewMod.Chapters : ViewMod.Single, name: '' };
  fileName: string | null = null;

  saveAll$ = new Subject<[Tab, Chapter | undefined]>();
  clearAll$ = new Subject<void>();
  filesProcessing = false;

  constructor(
    private uiState: UiStateService,
    private draftService: MangaDraftService,
    private tabService: TabsService) { }

  onUploadFinished() {
    console.log('UploadFileWindowComponent - onUploadFinished');
  }

  openChaptersMode() {
    const tab: Tab = {
      name: this.fileName ?? 'Untitled',
      mode: ViewMod.Chapters
    };

    this.draftService.setDraft(tab);
    this.closeWindow.emit();

    // Set the view mode to 'chapters' when opening chapters mode
    this.uiState.navigate(ViewMod.Chapters);
  }

  onWindowClose() {
    this.fileName = null;
    this.clearAll$.next();
    this.closeWindow.emit();
  }

  async saveAndClose() {
    try {
      // find the tab and upload chapter with pages
      if (this.viewMode === ViewMod.Chapters) {
        const tab = await this.tabService.getTabById(this.tabId!);

        if (!tab) {
          console.error('Tab not found');
          return;
        }

        this.tab = tab;
      }
      else {
        // for single mode, just set the tab name and save pages
      }

      this.tab.name = this.fileName ?? this.tab.name ?? 'Untitled';
      this.saveAll$.next([this.tab, undefined]);
    }
    catch (err) {
      console.error('Error saving tab', err);
    }
    finally {
      this.onWindowClose();
    }
  }
}
