import { Injectable } from '@angular/core';
import { Bookmark } from '../models/bookmark';
import { db } from '../database/manga-db';

@Injectable({ providedIn: 'root' })
export class BookmarksRepository {
  constructor() {}

  async put(b: Bookmark) {
    return db.bookmarks.put(b);
  }

  async get(id: number) {
    return db.bookmarks.get(id);
  }

  async getByPage(tabId: number, pageId: number) {
    return db.bookmarks
      .where('[tabId+pageId]')
      .equals([tabId, pageId])
      .first();
  }

  async exists(tabId: number, pageId: number) {
    const bookmark = await this.getByPage(tabId, pageId);

    return !!bookmark;
  }
  
  async getAll(tabId: number, chapterId?: number | undefined) {
    if (chapterId !== undefined) {
      return db.bookmarks
      .where('[tabId+chapterId]')
      .equals([tabId, chapterId]).sortBy('id');
    }

    return db.bookmarks.where('tabId').equals(tabId).sortBy('id');
  }

  async delete(id: number) {
    return db.bookmarks.delete(id);
  }
}
