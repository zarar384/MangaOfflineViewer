import { Injectable } from '@angular/core';
import { Dexie } from 'dexie';
import { db } from '../database/manga-db';
import { Chapter } from '../models/chapter.model';

export const CHAPTERS_SEED: Chapter[] = [
  {
    id: 1,
    tabId: 1,
    title: "Chapter 1 - Romance Dawn",
    order: 1,
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: 2,
    tabId: 1,
    title: "Chapter 2 - They Call Him Straw Hat Luffy",
    order: 2,
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: 3,
    tabId: 1,
    title: "Chapter 3 - Enter Zoro",
    order: 3,
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: 4,
    tabId: 2,
    title: "Chapter 1 - Uzumaki Naruto",
    order: 1,
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: 5,
    tabId: 2,
    title: "Chapter 2 - Konohamaru",
    order: 2,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
];

@Injectable({ providedIn: 'root' })
export class ChaptersRepository {

  constructor() { }

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

  async getNextChapter(currentChapterId: number): Promise<Chapter | undefined> {
    const currentChapter = await this.get(currentChapterId);
    if (!currentChapter) return undefined;

    return db.chapters
      .where('[tabId+order]')
      .between(
        [currentChapter.tabId, currentChapter.order],
        [currentChapter.tabId, Dexie.maxKey],
        false,
        true
      )
      .first();
  }

  async getPrevChapter(currentChapterId: number): Promise<Chapter | undefined> {
    const currentChapter = await this.get(currentChapterId);
    if (!currentChapter) return undefined;

    return db.chapters
      .where('[tabId+order]')
      .between(
        [currentChapter.tabId, Dexie.minKey],
        [currentChapter.tabId, currentChapter.order],
        true,
        false
      )
      .last();
  }


  async hasNextChapter(currentChapterId: number): Promise<boolean> {
    const nextChapter = await this.getNextChapter(currentChapterId);
    return !!nextChapter; // to boolean
  }

  async hasPrevChapter(currentChapterId: number): Promise<boolean> {
    const prevChapter = await this.getPrevChapter(currentChapterId);
    return !!prevChapter; // to boolean
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