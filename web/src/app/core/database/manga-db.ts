import Dexie, { Table } from "dexie";
import { Page } from "../models/page.model";
import { Tab } from "../models/tab.model";
import { Bookmark } from "../models/bookmark";
import { DB_NAME, STORE_BOOKMARKS, STORE_PAGES } from "../db.config";
import { numericNameSort } from "src/app/shared/utils/file-parsing";
import { Chapter } from "../models/chapter.model";

export class MangaDB extends Dexie {
  pages!: Table<Page, number>;
  tabs!: Table<Tab, number>;
  bookmarks!: Table<Bookmark, number>;
  chapters!: Table<Chapter, number>;

  constructor() {
    super(DB_NAME);

    // MIGRATIONS
    
    // v1
    this.version(1).stores({
      tabs: '++id, updatedAt',
      pages: '++id, tab',
      bookmarks: '++id, tab, page'
    });

    // v2
    this.version(2).stores({
      tabs: '++id, name, updatedAt',
      pages: '++id, tabId, name',
      bookmarks: '++id, tabId, pageId'
    }).upgrade(async tx => {

      // migrate pages
      await tx.table(STORE_PAGES).toCollection().modify((p: any) => {
        p.tabId = p.tab;
        delete p.tab;
      });

      // migrate bookmarks
      await tx.table(STORE_BOOKMARKS).toCollection().modify((b: any) => {
        b.tabId = b.tab;
        b.pageId = b.page;

        delete b.tab;
        delete b.page;
      });
    });

    // v3
    this.version(3).stores({
      tabs: '++id, name, updatedAt',
      pages: '++id, tabId, pageNumber, name',
      bookmarks: '++id, tabId, pageId'
    }).upgrade(async tx => {

      // v4
      this.version(4).stores({
        tabs: '++id, name, updatedAt, description',
        pages: '++id, tabId, chapterId, pageNumber, name',
        bookmarks: '++id, tabId, pageId',
        chapters: '++id, tabId, createdAt'
      }).upgrade(async tx => {

        // migrate pages - add chapterId field (nullable)
        await tx.table<Page>('pages')
          .toCollection()
          .modify((p: any) => {
            if (!('chapterId' in p)) {
              p.chapterId = null;
            }
          });

      });

      const pagesTable = tx.table<Page>('pages');

      // group pages by tabId
      const pagesByTab = new Map<number, Page[]>();
      await pagesTable.toCollection().each(page => {
        if (!pagesByTab.has(page.tabId)) {
          pagesByTab.set(page.tabId, []);
        }
        pagesByTab.get(page.tabId)!.push(page);
      });

      // number pages within each tab
      for (const [, pages] of pagesByTab) {
        pages.sort((a, b) => numericNameSort(`${a}`, `${b}`))
          .forEach((page, index) => {
            page.pageNumber = index + 1; 
          });
      }

      // save changes
      await pagesTable.bulkPut(
        Array.from(pagesByTab.values()).flat()
      );
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