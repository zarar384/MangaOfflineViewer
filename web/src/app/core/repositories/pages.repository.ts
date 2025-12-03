import { Injectable } from '@angular/core';
import { STORE_PAGES } from '../db.config';
import { Page } from '../models/page.model';
import { DbService } from '../database/db.service';
import { from, Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PagesRepository {
  constructor(private db: DbService) { }

  // CRUD base 
  // put() garantees transaction completion
  // run to wait for transaction completion, and use it inside to access indexes
  add(tab: Page) { return this.db.put(STORE_PAGES, tab); }
  update(tab: Page) { return this.db.put(STORE_PAGES, tab); }
  delete(id: number) { return this.db.run(STORE_PAGES, 'readwrite', s => s.delete(id)); }
  get(id: number) { return this.db.get<Page>(STORE_PAGES, id); }
  getAll() { return this.db.getAll<Page>(STORE_PAGES); }

  getByTab(tabId: number): Observable<Page[]> {
    return from(
      this.db.run(STORE_PAGES, 'readonly', store =>
        (store.index('tab') as IDBIndex).getAll(IDBKeyRange.only(tabId))
      )
    );
  }
}
