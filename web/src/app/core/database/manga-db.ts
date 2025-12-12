import Dexie, { Table } from "dexie";
import { Page } from "../models/page.model";
import { Tab } from "../models/tab.model";
import { Bookmark } from "../models/bookmark";
import { DB_NAME } from "../db.config";

export class MangaDB extends Dexie {
  pages!: Table<Page, number>;
  tabs!: Table<Tab, number>;
  bookmarks!: Table<Bookmark, number>;

  constructor() {
    super(DB_NAME);

    // MIGRATIONS
    this.version(1).stores({
      tabs: '++id, updatedAt',
      pages: '++id, tab',
      bookmarks: '++id, tab, page'
    });

    this.version(2).stores({
      tabs: '++id, name, updatedAt',
      pages: '++id, tabId, name',
      bookmarks: '++id, tabId, pageId'
    }).upgrade(async tx => {

      // migrate pages
      await tx.table('pages').toCollection().modify((p: any) => {
        p.tabId = p.tab;
        delete p.tab;
      });

      // migrate bookmarks
      await tx.table('bookmarks').toCollection().modify((b: any) => {
        b.tabId = b.tab;
        b.pageId = b.page;

        delete b.tab;
        delete b.page;
      });
    });

    // future migrations can be added like version(n).upgrade(...)
    // example
    // this.version(2).stores({
    //   pages: 'id, tabId, index'
    // }).upgrade(tx => {
    //   // add url field later if needed
    //   return tx.table('pages').toCollection().modify(p => {
    //     if (!('url' in p)) p.url = undefined;
    //   });
    // });
  }
}

export const db = new MangaDB();