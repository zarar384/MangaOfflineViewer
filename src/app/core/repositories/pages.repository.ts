import { Injectable } from '@angular/core';
import { STORE_PAGES } from '../db.config';
import { Page } from '../models/page.model';
import { DbService } from '../database/db.service';

@Injectable({ providedIn: 'root' })
export class PagesRepository {
  constructor(private db: DbService) { }

  // CRUD base 
  async add(page: Page) {
    const store = await this.db.tx(STORE_PAGES);
    return this.db.wrap(store.add(page));
  }

  async update(page: Page) {
    const store = await this.db.tx(STORE_PAGES);
    return this.db.wrap(store.put(page));
  }

  async delete(id: number) {
    const store = await this.db.tx(STORE_PAGES);
    return this.db.wrap(store.delete(id));
  }

  async get(id: number) : Promise<Page|undefined> {
    const store = await this.db.tx(STORE_PAGES);
    return this.db.wrap<Page | undefined>(store.get(id));
  }

  async getAll() : Promise<Page[]> {
    const store = await this.db.tx(STORE_PAGES);
    return this.db.wrap<Page[]>(store.getAll());
  }

  async getByTab(tabId: number): Promise<Page[]> {
    const index = await (await this.db.tx(STORE_PAGES)).index('tab');
    return this.db.wrap<Page[]>(index.getAll(IDBKeyRange.only(tabId)));
  }
}
