import { CommonModule } from '@angular/common';
import { Component, HostListener, Input, OnChanges, SimpleChanges, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Tab } from '../../core/models/tab.model';
import { TabsService } from '../../core/services/tabs.service';
import { ChapterListComponent } from '../../shared/components/movl-chapter-list/movl-chapter-list.component';
import { TranslocoPipe } from '@jsverse/transloco';
import { MangaDraftService } from '../../core/services/manga-draft.service';
import { createPreview } from '../../shared/utils/preview';
import { PREVIEW_MAX_SIZE } from '../../core/db.config';
import { Tag } from 'src/app/core/models/tag.model';
import { Artist } from 'src/app/core/models/artist.model';
import { TagsRepository } from 'src/app/core/repositories/tags.repository';
import { ArtistsRepository } from 'src/app/core/repositories/artist.repository';
import { MolvTextboxComponent } from 'src/app/shared/components/molv-textbox/molv-textbox';
import { MolvMetaInputComponent } from 'src/app/shared/components/molv-meta-input/molv-meta-input.component';
import { ChaptersListService } from '../../core/services/chapters-list.service';
import { BookmarksService } from 'src/app/core/services/bookmarks.service';

@Component({
  selector: 'manga-page',
  templateUrl: './manga-page.component.html',
  styleUrls: ['./manga-page.component.css'],
  imports: [ChapterListComponent, FormsModule, CommonModule, TranslocoPipe, MolvMetaInputComponent, MolvTextboxComponent],
  providers: [ChaptersListService, BookmarksService],
  standalone: true
})
export class MangaPageComponent implements OnChanges {

  @Input() activeManga: number | null = null;

  tab = signal<Tab | null>(null);
  artists = signal<Artist[]>([]);
  tags = signal<Tag[]>([]);

  isEditMode = signal(false);
  previewUrl = signal<string | null>(null);

  // suggestions for meta inputs
  artistSuggestions = signal<Artist[]>([]);
  tagSuggestions = signal<Tag[]>([]);

  constructor(
    private tabsService: TabsService,
    public draftService: MangaDraftService,
    private artistsRepo: ArtistsRepository,
    private tagsRepo: TagsRepository,
    private chaptersListService: ChaptersListService,
    private bookmarksService: BookmarksService
  ) {
    effect(() => {
      this.updatePreview();
    });
  }

    async ngOnChanges(changes: SimpleChanges) {
    if (changes['activeManga']) {
      const id = changes['activeManga'].currentValue;
     await this.loadManga(id);
    }
  }

  private async loadManga(id: number | null) {

    const draft = this.draftService.getDraft();

    if (draft) {

      this.tab.set(draft.tab);

      // load artists
      const artists = await Promise.all(
        (draft.tab.artistIds ?? []).map(id =>
          this.artistsRepo.get(id)
        )
      );

      // load tags
      const tags = await Promise.all(
        (draft.tab.tagIds ?? []).map(id =>
          this.tagsRepo.get(id)
        )
      );

      this.artists.set(
        artists.filter(Boolean) as Artist[]
      );

      this.tags.set(
        tags.filter(Boolean) as Tag[]
      );

      this.isEditMode.set(true);

      return;
    }

    // TODO: handle case when id is null (e.g. show empty state or redirect to home)
    if (!id) return;

    const tab = await this.tabsService.getTabById(id);

    if (!tab) return;

    // load artists
    const artists = await Promise.all(
      (tab.artistIds ?? []).map(id =>
        this.artistsRepo.get(id)
      )
    );

    // load tags
    const tags = await Promise.all(
      (tab.tagIds ?? []).map(id =>
        this.tagsRepo.get(id)
      )
    );

    this.artists.set(
      artists.filter(Boolean) as Artist[]
    );

    this.tags.set(
      tags.filter(Boolean) as Tag[]
    );

    this.tab.set(tab);
    await this.bookmarksService.loadBookmarksForManga(tab.id!);
    this.isEditMode.set(false);
  }


  // Warn user about unsaved changes
  @HostListener('window:beforeunload', ['$event'])
  unloadNotification($event: any) {
    if (this.isEditMode() && this.draftService.getDraft()) {
      $event.returnValue = true;
    }
  }

  // Clear draft on unload to prevent stale data
  @HostListener('document:visibilitychange')
  onVisibilityChange() {
    if (document.hidden) {
      this.draftService.clear();
    }
  }

  // Actions
  edit() {
    const current = this.tab();
    if (!current) return;

    this.draftService.setDraft(current);
    this.isEditMode.set(true);
  }

  async cancel() {

    this.draftService.clear();
    this.chaptersListService.discardPendingOrder();

    const current = this.tab();

    if (current) {

      // reload artists
      const artists = await Promise.all(
        (current.artistIds ?? []).map(id =>
          this.artistsRepo.get(id)
        )
      );

      // reload tags
      const tags = await Promise.all(
        (current.tagIds ?? []).map(id =>
          this.tagsRepo.get(id)
        )
      );

      this.artists.set(
        artists.filter(Boolean) as Artist[]
      );

      this.tags.set(
        tags.filter(Boolean) as Tag[]
      );
    }

    this.isEditMode.set(false);
  }

  // save draft changes to tab
  async save() {
    const draft = this.draftService.getDraft();
    if (!draft) return;

    let tab = draft.tab;

    try {

      // create or reuse existing artists
      const artistIds = await this.artistsRepo.getOrCreateBatch(
        this.artists().map(a => a.name)
      );

      // create or reuse existing tags
      const tagIds = await this.tagsRepo.getOrCreateBatch(
        this.tags().map(t => t.name)
      );

      // attach relations to tab
      tab.artistIds = artistIds;
      tab.tagIds = tagIds;

      // create preview if new file is selected
      if (tab.preview) {
        tab = {
          ...tab,
          preview: await createPreview(tab.preview, PREVIEW_MAX_SIZE)
        }
      }

      // save or update tab
      if (!tab.id) {
        const id = await this.tabsService.createTab(tab);

        tab = { ...tab, id };

        await this.tabsService.createUserTab(id);
        await this.tabsService.open({ mangaId: id });

      } else {
        await this.tabsService.updateTab(tab);
      }

      // commit pending chapter order in one bulk operation
      await this.chaptersListService.commitPendingOrder();

      if (!this.activeManga) {
        this.activeManga = tab.id!;
      }

      this.tab.set(tab);
      this.isEditMode.set(false);

      this.draftService.clear();
    }
    catch (error) {
      console.error('Save failed:', error);
    }
    finally {
      if (tab.id) {
        this.tabsService.invalidatePreview(tab.id);
        await this.tabsService.refresh();
      }

      await this.updatePreview();
    }
  }

  async delete() {
    const current = this.tab();
    if (!current?.id) return;

    await this.tabsService.deleteTab(current.id);
    this.tab.set(null);
  }

  // Draft updates
  onNameChange(value: string) {
    this.draftService.updateTab({ name: value });
  }

  onDescriptionChange(value: string) {
    this.draftService.updateTab({ description: value });
  }

  // Handle file selection and update draft
  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];

    if (!file.type.startsWith('image/')) return;

    // Update draft with new file
    this.draftService.updateTab({ preview: file });

    await this.updatePreview();
  }

  // preview handling
  private async updatePreview() {
    // from draft if in edit mode, otherwise from tab
    const draft = this.draftService.getTab();

    // edit mode
    if (this.isEditMode() && draft?.preview) {
      if (draft.preview instanceof Blob) {
        const url = URL.createObjectURL(draft.preview);
        this.previewUrl.set(url);
        return;
      }

      // if it's a string
      this.previewUrl.set(draft.preview);
      return;
    }

    // IT'S NOT EDIT MODE, GET PREVIEW URL
    // from tab
    const tab = this.tab();
    if (!tab) {
      this.previewUrl.set(null);
      return;
    }

    const url = await this.tabsService.buildPreview(tab);
    this.previewUrl.set(url);
  }

  // Draft model for edit form
  get draft() {
    return this.draftService.getTab();
  }

  // Meta input handlers
  async onArtistChange(value: string) {
    const artists = value
      .split(';')
      .map(v => v.trim())
      .filter(Boolean);

    const suggestions = await this.artistsRepo.search(
      artists[artists.length - 1] ?? ''
    );

    this.artistSuggestions.set(suggestions);

    this.artists.set(
      artists.map(v => ({
        name: v,
        normalized: v.toLowerCase(),
        createdAt: Date.now()
      }))
    );
  }

  async onTagChange(value: string) {
    const tags = value
      .split(';')
      .map(v => v.trim())
      .filter(Boolean);

    const suggestions = await this.tagsRepo.search(
      tags[tags.length - 1] ?? ''
    );

    this.tagSuggestions.set(suggestions);

    this.tags.set(
      tags.map(v => ({
        name: v,
        normalized: v.toLowerCase(),
        createdAt: Date.now()
      }))
    );
  }

  get artistsValue(): string {
    return this.artists()
      .map(artist => artist.name)
      .join('; ');
  }

  get tagsValue(): string {
    return this.tags()
      .map(tag => tag.name)
      .join('; ');
  }
}