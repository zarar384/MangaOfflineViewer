import { Injectable } from "@angular/core";
import { STORE_BOOKMARKS } from "../db.config";
import { DbService } from "../database/db.service";
import { Bookmark } from "../models/bookmark";

@Injectable({ providedIn: 'root' })
export class BookmarksRepository {
  constructor(private db: DbService) {}

  add(bm: Bookmark) {
    return this.db.put(STORE_BOOKMARKS, bm);
  }

  delete(id: number) {
    return this.db.run(STORE_BOOKMARKS, 'readwrite', s => s.delete(id));
  }

  get(id: number) {
    return this.db.get<Bookmark>(STORE_BOOKMARKS, id);
  }

  getByTab(tabId: number) {
    return this.db.run<Bookmark[]>(
      STORE_BOOKMARKS,
      'readonly',
      s => (s.index('tab') as IDBIndex)
        .getAll(IDBKeyRange.only(tabId))
    );
  }
}
