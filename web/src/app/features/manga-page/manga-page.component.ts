import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, OnChanges, OnDestroy, Output, SimpleChanges, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Tab } from '../../core/models/tab.model';
import { TabsService } from '../../core/services/tabs.service';
import { ChapterListComponent } from '../../shared/components/movl-chapter-list/movl-chapter-list.component';
import { TranslocoPipe } from '@jsverse/transloco';
import { MangaDraftService } from '../../core/services/manga-draft.service';
import { createPreview } from '../../shared/utils/preview';
import { CHAPTER_COVER_MAX_SIZE } from '../../core/db.config';
import { Tag } from 'src/app/core/models/tag.model';
import { Artist } from 'src/app/core/models/artist.model';
import { TagsRepository } from 'src/app/core/repositories/tags.repository';
import { ArtistsRepository } from 'src/app/core/repositories/artist.repository';
import { MolvTextboxComponent } from 'src/app/shared/components/molv-textbox/molv-textbox';
import { MolvMetaInputComponent } from 'src/app/shared/components/molv-meta-input/molv-meta-input.component';
import { ChaptersListService } from '../../core/services/chapters-list.service';
import { BookmarksService } from 'src/app/core/services/bookmarks.service';
import { MolvModule } from 'src/app/shared/components/molv-module.component';
import { FileFormat } from 'src/app/shared/enums/file-format';
import { UiStateService } from 'src/app/core/services/ui-state.service';
import { LoadingService } from 'src/app/core/services/loading.service';
import { ExportService } from 'src/app/core/services/export.service';

@Component({
  selector: 'manga-page',
  templateUrl: './manga-page.component.html',
  styleUrls: ['./manga-page.component.css'],
  imports: [ChapterListComponent, FormsModule, CommonModule, TranslocoPipe, MolvMetaInputComponent, MolvTextboxComponent, MolvModule],
  providers: [ChaptersListService, BookmarksService],
  standalone: true
})
export class MangaPageComponent implements OnChanges, OnDestroy {

  @Input() activeManga: number | null = null;
  @Input() downloadMod: FileFormat = FileFormat.MHTML;

  @Output() downloadModChange = new EventEmitter<FileFormat>();

  tab = signal<Tab | null>(null);
  artists = signal<Artist[]>([]);
  tags = signal<Tag[]>([]);

  isEditMode = signal(false);
  previewUrl = signal<string | null>(null);

  // guards against double-submit and surfaces save progress/failures to the template
  isSaving = signal(false);
  saveError = signal<string | null>(null);

  // guards against repeat/overlapping delete and surfaces delete progress/failures
  isDeleting = signal(false);
  deleteError = signal<string | null>(null);

  // whichever mutating action most recently failed; cleared when a new attempt starts
  displayError = computed(() => this.saveError() ?? this.deleteError());

  // true once this component instance has been torn down; used to ignore results
  // from in-flight operations (e.g. delete) that resolve after the user has
  // already navigated away
  private destroyed = false;

  // suggestions for meta inputs
  artistSuggestions = signal<Artist[]>([]);
  tagSuggestions = signal<Tag[]>([]);


  constructor(
    private tabsService: TabsService,
    public draftService: MangaDraftService,
    private artistsRepo: ArtistsRepository,
    private tagsRepo: TagsRepository,
    private chaptersListService: ChaptersListService,
    private bookmarksService: BookmarksService,
    private uiState: UiStateService,
    private loading: LoadingService,
    private exportService: ExportService,
  ) {
    this.downloadMod = this.uiState.getValue<FileFormat>('downloadMod') || FileFormat.MHTML;

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

  ngOnDestroy() {
    this.destroyed = true;
  }

  private async loadManga(id: number | null) {

    const draft = this.draftService.getDraft();

    // only restore a draft that belongs to the manga being opened; a draft left
    // over for a different manga (or no longer matching one) is stale and must
    // not leak into this manga's editor
    if (draft && !this.isDraftForManga(draft.tab, id)) {
      this.draftService.clear();
    }

    if (draft && this.isDraftForManga(draft.tab, id)) {

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

  // A draft belongs to this editor only if it targets the same manga that's
  // currently open (an unsaved tab and no active manga both count as "new").
  private isDraftForManga(draftTab: Tab, id: number | null): boolean {
    return (draftTab.id ?? null) === (id ?? null);
  }

  // Warn user about unsaved changes
  @HostListener('window:beforeunload', ['$event'])
  unloadNotification($event: any) {
    if (this.isEditMode() && this.draftService.getDraft()) {
      $event.returnValue = true;
    }
  }

  // Keep the draft alive while the tab/app is hidden; only flush it to storage
  // immediately so backgrounding doesn't lose unsaved edits to a debounce race.
  // The draft is only ever terminated by Save, Cancel, or explicitly leaving
  // the editor (selecting another manga, going home, etc.).
  @HostListener('document:visibilitychange')
  onVisibilityChange() {
    if (document.hidden && this.isEditMode()) {
      this.draftService.flush();
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
    // don't tear down the draft/edit mode while a save or delete is in flight
    if (this.isSaving() || this.isDeleting()) return;

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
    this.saveError.set(null);
    this.deleteError.set(null);
  }

  // save draft changes to tab
  async save() {
    // reentry guard: a second Save (e.g. a fast double-click) must no-op while one is in flight;
    // also don't start a write on a manga that's being deleted
    if (this.isSaving() || this.isDeleting()) return;

    const draft = this.draftService.getDraft();
    if (!draft) return;

    // set before the first await so a synchronous re-entrant call is blocked immediately
    this.isSaving.set(true);
    this.saveError.set(null);
    this.deleteError.set(null);
    this.loading.show();

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

      // create preview only if the user picked a new file (File, not a stored Blob/string)
      if (tab.preview instanceof File) {
        tab = {
          ...tab,
          preview: await createPreview(tab.preview, CHAPTER_COVER_MAX_SIZE)
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

      // keep the draft intact so the user can retry without losing their edits
      this.saveError.set('errors.saveFailed');
    }
    finally {
      if (tab.id) {
        this.tabsService.invalidatePreview(tab.id);
        await this.tabsService.refresh();
      }

      await this.updatePreview();

      this.isSaving.set(false);
      this.loading.hide();
    }
  }

  async delete() {
    // don't delete the tab while a save is writing it out, and don't allow a repeat delete
    if (this.isSaving() || this.isDeleting()) return;

    const current = this.tab();
    if (!current?.id) return;

    const deletedId = current.id;

    // set before the first await so a synchronous re-entrant call is blocked immediately
    this.isDeleting.set(true);
    this.saveError.set(null);
    this.deleteError.set(null);
    this.loading.show();

    try {
      await this.tabsService.deleteTab(deletedId);

      // a slow delete may resolve after the user has already left this manga's
      // screen (navigated to another manga, or this instance was destroyed);
      // only act on the result if it's still what's on screen
      if (this.destroyed || this.activeManga !== deletedId) return;

      this.draftService.clear();
      this.tab.set(null);
      this.isEditMode.set(false);

      // existing navigation: send the user Home (also clears draft/reader state)
      await this.tabsService.open({ mangaId: null });
    }
    catch (error) {
      console.error('Delete failed:', error);

      if (this.destroyed || this.activeManga !== deletedId) return;

      // keep the editor open so the user can see what happened and retry
      this.deleteError.set('errors.deleteFailed');
    }
    finally {
      if (!this.destroyed && this.activeManga === deletedId) {
        this.isDeleting.set(false);
      }

      this.loading.hide();
    }
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
    // avoid racing with the preview refresh a save() does when it finishes,
    // and don't bother picking a new cover for a manga that's being deleted
    if (this.isSaving() || this.isDeleting()) return;

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

  // DOWNLOAD / EXPORT
  get dwnldMod(): FileFormat {
    return this.downloadMod;
  }

  set dwnldMod(value: FileFormat) {
    this.downloadMod = value;
    this.uiState.saveState({ downloadMod: this.downloadMod });
    this.downloadModChange.emit(value);
  }

  getFileFormatOptions(): { value: FileFormat; label: string }[] {
    return Object.values(FileFormat).map(format => ({
      value: format,
      label: format.toUpperCase()
    }));
  }

  isExporting = false;
  async export(format: FileFormat) {
    if (this.activeManga === null) return;

    try {
      this.isExporting = true;
      this.loading.show();

      const tab = await this.tabsService.getTabById(this.activeManga);
      if (!tab) return;

      await this.exportService.exportManga(tab, format);

      console.log(`Manga exported as ${format}`);

    } catch (err) {
      console.error(`Error exporting manga as ${format}`, err);
    } finally {
      this.isExporting = false;
      this.loading.hide();
    }
  }
}