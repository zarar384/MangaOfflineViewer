import { Injectable } from '@angular/core';
import { Page, PageMeta } from '../models/page.model';
import { db } from '../database/manga-db';
import { Dexie } from 'dexie';

export const PAGES_SEED: Page[] = [
  {
    id: 1,
    tabId: 1,
    chapterId: 1,
    pageNumber: 1,
    src: 'assets/favicon.ico?v=2'
  },
  {
    id: 2,
    tabId: 1,
    chapterId: 1,
    pageNumber: 2,
    src: 'assets/favicon.ico?v=2'
  },
  {
    id: 3,
    tabId: 1,
    chapterId: 1,
    pageNumber: 3,
    src: 'assets/favicon.ico?v=2'
  },
  {
    id: 4,
    tabId: 1,
    chapterId: 2,
    pageNumber: 1,
    src: 'assets/favicon.ico?v=2'
  },
  {
    id: 5,
    tabId: 1,
    chapterId: 2,
    pageNumber: 2,
    src: 'assets/favicon.ico?v=2'
  },
  {
    id: 6,
    tabId: 1,
    chapterId: 3,
    pageNumber: 1,
    src: 'assets/favicon.ico?v=2'
  },
];

@Injectable({ providedIn: 'root' })
export class PagesRepository {
  constructor() { }

  async put(page: Page) {
    return db.pages.put(page);
  }

  async get(id: number) {
    return db.pages.get(id);
  }

  async getAll(tabId: number, chapterId?: number): Promise<Page[]> {
    try {
      if (chapterId !== undefined) {
        return this.getByChapter(chapterId);
      }

      return await db.pages
        .where('[tabId+chapterOrder+pageNumber]')
        .between(
          [tabId, Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
          [tabId, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]
        )
        .toArray();

    } catch (e) {
      console.error('Dexie getAll error', e);
      return [];
    }
  }

  // get only page ids to avoid loading src blobs into memory
  async getMeta(tabId: number): Promise<PageMeta[]> {
    const result: PageMeta[] = [];

    await db.pages
      .where('[tabId+chapterOrder+pageNumber]')
      .between(
        [tabId, Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
        [tabId, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]
      )
      .each(p => {
        result.push({
          ...p,
        });
      });

    return result;
  }

  async getMetaByChapter(chapterId: number): Promise<PageMeta[]> {
    const pages = await db.pages
      .where('chapterId')
      .equals(chapterId)
      .sortBy('pageNumber');

    return pages.map(p => ({
      ...p,
      src: null
    }));
  }


  async getByChapter(chapterId: number) {
    return db.pages
      .where('chapterId')
      .equals(chapterId)
      .sortBy('pageNumber');
  }

  async countByChapter(chapterId: number) {
    return db.pages
      .where('chapterId')
      .equals(chapterId)
      .count();
  }

  async getFirstPage(chapterId: number) {
    const pages = await db.pages
      .where('chapterId')
      .equals(chapterId)
      .sortBy('pageNumber');

    return pages[0] ?? null;
  }

  async delete(id: number) {
    return db.pages.delete(id);
  }

  async deleteByTab(tabId: number) {
    return db.pages.where('tabId').equals(tabId).delete();
  }

  async bulkAdd(pages: Page[]) {
    return db.pages.bulkAdd(pages);
  }

  async bulkPut(pages: Page[]) {
    return db.pages.bulkPut(pages);
  }

  async count(tabId: number) {
    return db.pages.where('tabId').equals(tabId).count();
  }
}