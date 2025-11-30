import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, OnChanges, Output, ViewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Page } from "src/app/core/models/page.model";
import { Tab } from "src/app/core/models/tab.model";
import { PagesRepository } from "src/app/core/repositories/pages.repository";
import { DropUploaderComponents } from "src/app/shared/components/drop-uploader/drop-uploader.components";
import { WindowComponent } from "src/app/shared/components/window/window.component";

@Component({
  selector: 'edit-tab-window',
  imports: [WindowComponent, CommonModule, DropUploaderComponents, FormsModule],
  templateUrl: './edit-tab-window.component.html',
  styleUrls: ['./edit-tab-window.component.css'],
  standalone: true
})
export class EditTabWindowComponent implements OnChanges {
  @Input() isVisible = false;
  @Input() tab: Tab | null = null;
  @Output() closeWindow = new EventEmitter<void>(); 

  @ViewChild(DropUploaderComponents) dropUploader!: DropUploaderComponents;

  finalName: string | null = null;
  pages: Page[] = [];

  constructor(private pagesRepo: PagesRepository) { }
  async ngOnChanges(): Promise<void> {
    await this.loadPages();
  }

  private async loadPages() {
    if (!this.tab?.id) return;
    this.finalName = this.tab.name;
    this.pages = await this.pagesRepo.getByTab(this.tab.id);
  }

  onUploadFinished() {
    console.log('UploadFileWindowComponent - onUploadFinished');
  }

  onWindowClose() {
    this.finalName = null;
    this.dropUploader?.clearAll();
    this.closeWindow.emit();
  }

  async saveAndClose() {
    this.tab!.name = this.finalName ?? `Tab ${this.tab!.id}`;
    this.tab!.updatedAt = Date.now();
    await this.dropUploader?.saveAll(this.tab!);
    this.onWindowClose();
  }
}
