import { inject, Injectable, signal } from '@angular/core';
import { BookmarksRepository } from '../repositories/bookmark.repository';

export interface ChapterBookmarks {
  pageIds: Set<number>;
  count: number;
}

@Injectable()
export class BookmarksService {
  // bookmarksLookup: chapterId -> ChapterBookmarks(pagesList)
  readonly bookmarksLookup = signal<ReadonlyMap<number, ChapterBookmarks>>(new Map());

  readonly bookmarksRepo = inject(BookmarksRepository);

  // Load bookmarks for a specific manga and group them by chapter.
  public async loadBookmarksForManga(mangaId: number): Promise<void> {
    const bookmarks = await this.bookmarksRepo.getAll(mangaId);

    if (bookmarks.length === 0) {
      this.bookmarksLookup.set(new Map());
      return;
    }

    const lookup = new Map<number, ChapterBookmarks>();

    for (const bookmark of bookmarks) {
      const chapterId = bookmark.chapterId;

      if (chapterId == null) {
        continue;
      }

      // create chapter entry 
      let chapter = lookup.get(chapterId);

      if (!chapter) {
        chapter = {
          pageIds: new Set<number>(),
          count: 0,
        };

        lookup.set(chapterId, chapter);
      }

      // add page to chapter
      chapter.pageIds.add(bookmark.pageId);
      chapter.count++;
    }

    this.bookmarksLookup.set(lookup);
  }

  // Get the number of bookmarks for a specific chapter.
  getBookmarksCount(chapterId: number): number {
    return this.bookmarksLookup().get(chapterId)?.count ?? 0;
  }

  // Check if a specific page in a chapter has a bookmark.
  hasBookmark(chapterId: number, pageId: number): boolean {
    return this.bookmarksLookup().get(chapterId)?.pageIds.has(pageId) ?? false;
  }
}
