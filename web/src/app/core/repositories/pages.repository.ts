import { Injectable } from '@angular/core';
import { Page } from '../models/page.model';
import { db } from '../database/manga-db';

@Injectable({ providedIn: 'root' })
export class PagesRepository {
  constructor() {}

  async put(page: Page) {
    return db.pages.put(page);
  }

  async get(id: number) {
    return db.pages.get(id);
  }

  async getAll(tabId: number) {
    return db.pages.where('tabId').equals(tabId).sortBy('id');
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