import { Injectable } from '@angular/core';
import { db } from '../database/manga-db';
import { Chapter } from '../models/chapter.model';
import { USE_SEEDS } from '../db.config';

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
    if (USE_SEEDS) {
      return 0;
    }

    chapter.createdAt = chapter.createdAt ?? Date.now();
    chapter.updatedAt = Date.now();
    const id = await db.chapters.put(chapter);
    return id as number;
  }

  async update(chapter: Chapter): Promise<number> {
    if (USE_SEEDS) {
      return 0;
    }
    chapter.updatedAt = Date.now();
    const id = await db.chapters.put(chapter);
    return id as number;
  }

  async delete(id: number): Promise<void> {
    if (USE_SEEDS) {
      return;
    }
    await db.chapters.delete(id);
  }

  async deleteByTab(tabId: number): Promise<void> {
    if (USE_SEEDS) {
      return;
    }
    await db.chapters.where('tabId').equals(tabId).delete();
  }

  async get(id: number): Promise<Chapter | undefined> {
    if (USE_SEEDS) {
      return CHAPTERS_SEED.find(c => c.id === id);
    }
    return db.chapters.get(id);
  }

  async getAll(tabId: number): Promise<Chapter[]> {
    if (USE_SEEDS) {
      return CHAPTERS_SEED
        .filter(c => c.tabId === tabId)
        .sort((a, b) => a.order - b.order);
    }
    return db.chapters
      .where('tabId')
      .equals(tabId)
      .sortBy('order');
  }

  async count(tabId: number): Promise<number> {
    if (USE_SEEDS) {
      return CHAPTERS_SEED.filter(c => c.tabId === tabId).length;
    }
    return db.chapters
      .where('tabId')
      .equals(tabId)
      .count();
  }

  async getNextOrder(tabId: number): Promise<number> {
    if (USE_SEEDS) {
      const chapters = CHAPTERS_SEED.filter(c => c.tabId === tabId).sort((a, b) => a.order - b.order);
      if (!chapters.length) return 1;
      return chapters[chapters.length - 1].order + 1;
    }

    const chapters = await db.chapters
      .where('tabId')
      .equals(tabId)
      .sortBy('order');

    if (!chapters.length) return 1;

    return chapters[chapters.length - 1].order + 1;
  }

  async reorder(tabId: number, reordered: Chapter[]): Promise<void> {
    if (USE_SEEDS) {
      return;
    }
    await db.transaction('rw', db.chapters, async () => {
      for (let i = 0; i < reordered.length; i++) {
        reordered[i].order = i + 1;
        reordered[i].updatedAt = Date.now();
      }
      await db.chapters.bulkPut(reordered);
    });
  }
}