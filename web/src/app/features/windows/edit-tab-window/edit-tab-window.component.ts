import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Tab } from "../../../core/models/tab.model";
import { MolvDropUploaderComponents } from '../../../shared/components/molv-drop-uploader/molv-drop-uploader.components';
import { WindowComponent } from "../../../shared/components/window/window.component";
import { Subject } from 'rxjs';
import { TabsService } from "../../../core/services/tabs.service";
import { ViewMod } from "../../../shared/enums/viewmod.enum";
import { Chapter } from "../../../core/models/chapter.model";
import { TranslocoPipe } from "@jsverse/transloco";
import { LanguageService } from "src/app/core/services/language.service";

@Component({
  selector: 'edit-tab-window',
  imports: [WindowComponent, CommonModule, MolvDropUploaderComponents, FormsModule, TranslocoPipe],
  templateUrl: './edit-tab-window.component.html',
  styleUrls: ['./edit-tab-window.component.css'],
  standalone: true
})
export class EditTabWindowComponent implements OnChanges {
  @Input() isVisible = false;
  @Input() tabId: number | undefined = undefined;
  @Input() fileName: string | undefined = undefined;
  @Input() viewMode: ViewMod | undefined = undefined;
  @Output() closeWindow = new EventEmitter<void>();

  saveAll$ = new Subject<[Tab, Chapter | undefined]>();
  clearAll$ = new Subject<void>();
  filesProcessing = false;
  localFileName: string | undefined;

  constructor(
    private tabService: TabsService,
    private langService: LanguageService,
  ) { }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['fileName']
      || (changes['isVisible'] && this.isVisible)
    ) {
      this.localFileName = this.fileName;

    }
  }

  onFileSelected(name: string) {
    if (!this.localFileName) {
      this.localFileName = name;
    }
  }

  onUploadFinished() {
    console.log('EditTabWindowComponent - onUploadFinished');
  }

  onWindowClose() {
    this.localFileName = undefined;
    this.viewMode = undefined;
    this.clearAll$.next();
    this.closeWindow.emit();
  }

  async saveAndClose() {
    try {
      var tab = await this.tabService.getTabById(this.tabId!);

      if (!tab) {
        console.error('Tab not found');
        return;
      }

      tab.name = this.localFileName ?? `${this.langService.translate('tab')} ${tab.id}`;
      this.saveAll$.next([tab, undefined]);
    }
    catch (err) {
      console.error('Error saving tab', err);
    }
  }
}
