import { CommonModule } from "@angular/common";
import { Component, EventEmitter, input, Input, OnChanges, Output, SimpleChanges } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Page } from "../../../core/models/page.model";
import { Tab } from "../../../core/models/tab.model";
import { PagesRepository } from "../../../core/repositories/pages.repository";
import { MolvDropUploaderComponents } from '../../../shared/components/molv-drop-uploader/molv-drop-uploader.components';
import { WindowComponent } from "../../../shared/components/window/window.component";
import { numericNameSort } from "../../../shared/utils/file-parsing";
import { Subject } from 'rxjs';
import { TabsService } from "../../../core/services/tabs.service";
import { ViewMod } from "../../../shared/enums/viewmod.enum";
import { LoadingService } from "../../../core/services/loading.service";
import { Chapter } from "../../../core/models/chapter.model";

@Component({
  selector: 'edit-tab-window',
  imports: [WindowComponent, CommonModule, MolvDropUploaderComponents, FormsModule],
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

  pages: Page[] = [];

  saveAll$ = new Subject<[Tab, Chapter | undefined]>();
  clearAll$ = new Subject<void>();
  filesProcessing = false;

  constructor(private pagesRepo: PagesRepository, private tabService: TabsService, private loading: LoadingService) { }
  async ngOnChanges(changes: SimpleChanges) {
    await this.loadPages();
  }

  private async loadPages() {
    if (!this.tabId) return;

    try {
      this.loading.show();

      var pages = await this.pagesRepo.getAll(this.tabId)
      this.pages = pages.sort((a, b) => numericNameSort(`${a}`, `${b}`));
    }
    catch (err) {
      console.error('Error loading pages', err)
    }
    finally {
      this.loading.hide();
    }
  }

  onUploadFinished() {
    console.log('EditTabWindowComponent - onUploadFinished');
  }

  onWindowClose() {
    this.fileName = undefined;
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

      tab.name = this.fileName ?? `Tab ${tab.id}`;
      this.saveAll$.next([tab, undefined]);
    }
    catch (err) {
      console.error('Error saving tab', err);
    }
    finally {
      this.onWindowClose();
    }
  }
}
