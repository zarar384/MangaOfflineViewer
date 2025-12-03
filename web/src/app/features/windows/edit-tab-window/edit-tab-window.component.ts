import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, OnChanges, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Page } from "src/app/core/models/page.model";
import { Tab } from "src/app/core/models/tab.model";
import { PagesRepository } from "src/app/core/repositories/pages.repository";
import { DropUploaderComponents } from "src/app/shared/components/drop-uploader/drop-uploader.components";
import { WindowComponent } from "src/app/shared/components/window/window.component";
import { numericNameSort } from "src/app/shared/utils/file-parsing";
import { Subject } from 'rxjs';

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

  finalName: string | null = null;
  pages: Page[] = [];

  saveAll$ = new Subject<Tab>();
  clearAll$ = new Subject<void>();

  constructor(private pagesRepo: PagesRepository) { }
  async ngOnChanges(): Promise<void> {
    await this.loadPages();
  }

  private async loadPages() {
    if (!this.tab?.id) return;
    this.finalName = this.tab.name;
    this.pagesRepo.getByTab(this.tab.id!)
      .subscribe({
        next: pages => {
          this.pages = pages.sort((a, b) => numericNameSort(`${a}`, `${b}`));
        },
        error: err => console.error('Error loading pages', err)
      });
  }

  onUploadFinished() {
    console.log('UploadFileWindowComponent - onUploadFinished');
  }

  onWindowClose() {
    this.finalName = null;
    this.clearAll$.next();
    this.closeWindow.emit();
  }

  saveAndClose() {
    this.tab!.name = this.finalName ?? `Tab ${this.tab!.id}`;
    this.tab!.updatedAt = Date.now();
    this.saveAll$.next(this.tab!);
    this.onWindowClose();
  }
}
