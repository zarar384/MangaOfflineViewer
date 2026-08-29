import { Component, EventEmitter, Output, Input, signal } from '@angular/core';
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
import { LanguageService } from 'src/app/core/services/language.service';
import { TranslocoPipe } from '@jsverse/transloco';

@Component({
  selector: 'upload-file-window',
  imports: [WindowComponent, CommonModule, MolvDropUploaderComponents, FormsModule, TranslocoPipe],
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
  isMultiUploadFinished = false;

  // multi-mode related signals
  isMultiMode = signal(false);
  uploaderDisabled = signal(false);
  
  constructor(
    private uiState: UiStateService,
    private draftService: MangaDraftService,
    private tabService: TabsService,
    private langService: LanguageService
  ) { }

  onUploadFinished() {
    console.log('UploadFileWindowComponent - onUploadFinished');

    if (this.isMultiMode()) {
      this.uploaderDisabled.set(true);
      this.isMultiUploadFinished = true;
    }
  }

  onWindowClose() {
    this.fileName = null;
    this.isMultiMode.set(false);
    this.resetBaseState();
    this.closeWindow.emit();
  }

  selectSingleMode() {
    this.isMultiMode.set(false);
    this.resetBaseState();
  }

  selectMultiMode() {
    this.isMultiMode.set(true);
    this.resetBaseState();
  }

  private resetBaseState() {
    this.isMultiUploadFinished = false;
    this.uploaderDisabled.set(false);
    this.clearAll$.next();
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
      else if (this.isMultiMode() && !this.isMultiUploadFinished) {
        this.draftService.setDraft({
          name: this.fileName ?? this.langService.translate('untitled'),
          mode: ViewMod.Chapters
        });

        this.uiState.navigate(ViewMod.Chapters);
        return;
      }
      else {
        this.tab.mode = this.isMultiMode() ? ViewMod.Chapters : ViewMod.Single;
      }

      this.tab.name = this.fileName ?? this.tab.name ?? this.langService.translate('untitled');
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
