import { CommonModule } from "@angular/common";
import { Component, EventEmitter, input, Input, OnChanges, Output, SimpleChanges } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Page } from "src/app/core/models/page.model";
import { Tab } from "src/app/core/models/tab.model";
import { PagesRepository } from "src/app/core/repositories/pages.repository";
import { MolvDropUploaderComponents } from 'src/app/shared/components/molv-drop-uploader/molv-drop-uploader.components';
import { WindowComponent } from "src/app/shared/components/window/window.component";
import { numericNameSort } from "src/app/shared/utils/file-parsing";
import { Subject } from 'rxjs';
import { TabsService } from "src/app/core/services/tabs.service";
import { ViewMod } from "src/app/shared/enums/viewmod.enum";
import { LoadingService } from "src/app/core/services/loading.service";

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

  saveAll$ = new Subject<[Tab, string]>();
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
      var tab = await this.tabService.getTabById(this.tabId!).then(t => {
        if (!t) {
          console.error('Tab not found for id', this.tabId);
          return null;
        }
        return t.tab;
      });

      if (!tab) {
        return;
      }


      var name = this.fileName ?? `Tab ${tab!.id}`;
      this.saveAll$.next([tab, name]);
    }
    catch (err) {
      console.error('Error saving tab', err);
    }
    finally {
      this.onWindowClose();
    }
  }
}
