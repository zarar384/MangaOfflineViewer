import { Injectable, computed, signal } from '@angular/core';
import { Chapter } from '../models/chapter.model';
import { ChaptersRepository } from '../repositories/chapters.repository';
import { LanguageService } from './language.service';
import { LoadingService } from './loading.service';

@Injectable()
export class ChaptersListService {

  /** Chapters as persisted in DB */
  readonly chapters = signal<Chapter[]>([]);

  /**
   * Locally reordered chapters — set while user edits, null when not editing.
   * Never written to DB until commitPendingOrder() is called.
   */
  readonly pendingOrder = signal<Chapter[] | null>(null);

  /** What the UI renders: pending draft if present, otherwise DB state */
  readonly displayChapters = computed(() => this.pendingOrder() ?? this.chapters());

  private mangaId: number | null = null;

  constructor(
    private chaptersRepo: ChaptersRepository,
    private langService: LanguageService,
    private loading: LoadingService
  ) { }

  setMangaId(id: number | null) {
    this.mangaId = id;
    this.reload();
  }

  async reload() {
    if (!this.mangaId) {
      this.chapters.set([]);
      return;
    }
    const list = await this.chaptersRepo.getAll(this.mangaId);
    this.chapters.set(list);
  }

  async addChapter() {
    if (!this.mangaId) return;
    const order = await this.chaptersRepo.getNextOrder(this.mangaId);
    await this.chaptersRepo.add({
      tabId: this.mangaId,
      title: `${this.langService.translate('chapter')} ${order}`,
      order,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    await this.reload();
  }

  /**
   * Move a chapter to a new position locally.
   * No DB write — call commitPendingOrder() to persist.
   */
  moveChapter(chapterId: number, newOrder: number): void {
    const current = (this.pendingOrder() ?? this.chapters()).map(c => ({ ...c }));
    const idx = current.findIndex(c => c.id === chapterId);
    if (idx === -1) return;

    const [moved] = current.splice(idx, 1);
    const insertAt = Math.min(Math.max(newOrder - 1, 0), current.length);
    current.splice(insertAt, 0, moved);

    // Keep order field in sync with visual position
    current.forEach((c, i) => { c.order = i + 1; });

    this.pendingOrder.set(current);
  }

  /**
   * Persist pending order to DB in one atomic bulk operation.
   * Called from MangaPageComponent.save().
   */
  async commitPendingOrder(): Promise<void> {
    const pending = this.pendingOrder();
    if (!pending || !this.mangaId) return;

    this.loading.show();
    try {
      await this.chaptersRepo.reorder(this.mangaId, pending);
      this.pendingOrder.set(null);
      await this.reload();
    } finally {
      this.loading.hide();
    }
  }

  /** Discard any unsaved order changes. Called from MangaPageComponent.cancel(). */
  discardPendingOrder(): void {
    this.pendingOrder.set(null);
  }
}

