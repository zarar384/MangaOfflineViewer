import { Injectable } from '@angular/core';
import { Page } from '../models/page.model';
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

async getAll(tabId: number) {
  return db.pages
    .where('[tabId+chapterOrder+pageNumber]')
    .between(
      [tabId, Dexie.minKey, Dexie.minKey],
      [tabId, Dexie.maxKey, Dexie.maxKey]
    )
    .toArray();
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