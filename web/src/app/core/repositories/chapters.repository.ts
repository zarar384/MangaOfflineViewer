import { Injectable } from '@angular/core';
import { db } from '../database/manga-db';
import { Chapter } from '../models/chapter.model';

@Injectable({ providedIn: 'root' })
export class ChaptersRepository {

  constructor() {}

  async add(chapter: Chapter): Promise<number> {
    chapter.createdAt = chapter.createdAt ?? Date.now();
    chapter.updatedAt = Date.now();
    const id = await db.chapters.put(chapter);
    return id as number;
  }

  async update(chapter: Chapter): Promise<number> {
    chapter.updatedAt = Date.now();
    const id = await db.chapters.put(chapter);
    return id as number;
  }

  async delete(id: number): Promise<void> {
    await db.chapters.delete(id);
  }

  async deleteByTab(tabId: number): Promise<void> {
    await db.chapters.where('tabId').equals(tabId).delete();
  }

  async get(id: number): Promise<Chapter | undefined> {
    return db.chapters.get(id);
  }

  async getAll(tabId: number): Promise<Chapter[]> {
    return db.chapters
      .where('tabId')
      .equals(tabId)
      .sortBy('order');
  }

  async count(tabId: number): Promise<number> {
    return db.chapters
      .where('tabId')
      .equals(tabId)
      .count();
  }

  async getNextOrder(tabId: number): Promise<number> {
    const chapters = await db.chapters
      .where('tabId')
      .equals(tabId)
      .sortBy('order');

    if (!chapters.length) return 1;

    return chapters[chapters.length - 1].order + 1;
  }

  async reorder(tabId: number, reordered: Chapter[]): Promise<void> {
    await db.transaction('rw', db.chapters, async () => {
      for (let i = 0; i < reordered.length; i++) {
        reordered[i].order = i + 1;
        reordered[i].updatedAt = Date.now();
      }
      await db.chapters.bulkPut(reordered);
    });
  }
}