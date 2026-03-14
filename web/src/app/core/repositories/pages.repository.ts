import { Injectable } from '@angular/core';
import { Page } from '../models/page.model';
import { db } from '../database/manga-db';
import { USE_SEEDS } from '../db.config';

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
    if (USE_SEEDS) {
      return 0;
    }
    return db.pages.put(page);
  }

  async get(id: number) {
    if (USE_SEEDS) {
      return PAGES_SEED.find(p => p.id === id);
    }

    return db.pages.get(id);
  }

  async getAll(tabId: number) {
    if (USE_SEEDS) {
      return PAGES_SEED.filter(p => p.tabId === tabId);
    }
    return db.pages.where('tabId').equals(tabId).sortBy('id');
  }

  async delete(id: number) {
    if (USE_SEEDS) {
      return;
    }
    return db.pages.delete(id);
  }

  async deleteByTab(tabId: number) {
    if (USE_SEEDS) {
      return;
    }
    return db.pages.where('tabId').equals(tabId).delete();
  }

  async bulkAdd(pages: Page[]) {
    if (USE_SEEDS) {
      return;
    }
    return db.pages.bulkAdd(pages);
  }

  async bulkPut(pages: Page[]) {
    if (USE_SEEDS) {
      return;
    }
    return db.pages.bulkPut(pages);
  }

  async count(tabId: number) {
    if (USE_SEEDS) {
      return PAGES_SEED.filter(p => p.tabId === tabId).length;
    }
    return db.pages.where('tabId').equals(tabId).count();
  }
}