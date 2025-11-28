import { Injectable } from '@angular/core';
import { STORE_PAGES } from '../db.config';
import { Page } from '../models/page.model';
import { DbService } from '../database/db.service';

@Injectable({ providedIn: 'root' })
export class PagesRepository {
  constructor(private db: DbService) { }

  // CRUD base 
  // put() garantees transaction completion
  // run to wait for transaction completion, and use it inside to access indexes
  async add(page: Page) {
    return this.db.put(STORE_PAGES, page);
  }

  async update(page: Page) {
    return this.db.put(STORE_PAGES, page);
  }

  async delete(id: number) {
    return this.db.run(STORE_PAGES, 'readwrite', store => store.delete(id));
  }

  async get(id: number): Promise<Page | undefined> {
    return this.db.get(STORE_PAGES, id);
  }

  async getAll(): Promise<Page[]> {
    return this.db.getAll(STORE_PAGES);
  }

  async getByTab(tabId: number): Promise<Page[]> {
    return this.db.run(STORE_PAGES, 'readonly', store =>
      (store.index('tab') as IDBIndex).getAll(IDBKeyRange.only(tabId))
    );
  }
}
