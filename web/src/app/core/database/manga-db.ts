import Dexie, { Table } from "dexie";
import { Page } from "../models/page.model";
import { Tab } from "../models/tab.model";
import { Bookmark } from "../models/bookmark";
import { DB_NAME, DB_VERSION, STORE_BOOKMARKS, STORE_CHAPTERS, STORE_PAGES, STORE_TABS } from "../db.config";
import { numericNameSort } from "../../shared/utils/file-parsing";
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
      await tx.table<Page>(STORE_PAGES).toCollection().modify((p: any) => {
        p.tabId = p.tab;
        delete p.tab;
      });

      // migrate bookmarks
      await tx.table<Bookmark>(STORE_BOOKMARKS).toCollection().modify((b: any) => {
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

      const pagesTable = tx.table<Page>(STORE_PAGES);

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
        pages.sort((a, b) => numericNameSort(`${a.name}`, `${b.name}`))
          .forEach((page, index) => {
            page.pageNumber = index + 1;
          });
      }

      // save changes
      await pagesTable.bulkPut(
        Array.from(pagesByTab.values()).flat()
      );
    });

    // v4
    this.version(4).stores({
      tabs: '++id, name, updatedAt, description',
      pages: '++id, tabId, chapterId, pageNumber, name',
      bookmarks: '++id, tabId, pageId',
      chapters: '++id, tabId, createdAt'
    }).upgrade(async tx => {

      // migrate pages - add chapterId field (nullable)
      await tx.table<Page>(STORE_PAGES)
        .toCollection()
        .modify((p: any) => {
          if (!('chapterId' in p)) {
            p.chapterId = null;
          }
        });

    });

    // v5
    this.version(5).stores({
      tabs: '++id, name, updatedAt, description, mode',
      pages: '++id, tabId, chapterId, pageNumber, name',
      bookmarks: '++id, tabId, pageId',
      chapters: '++id, tabId, order, createdAt, [tabId+order]'
    }).upgrade(async tx => {

      // migrate tabs - add mode (default single)
      await tx.table<Tab>(STORE_TABS)
        .toCollection()
        .modify((t: any) => {
          if (!('mode' in t) || !t.mode) {
            t.mode = 'single';
          }
        });

    });

    // v6
    this.version(6).stores({
      tabs: '++id, name, updatedAt, description, mode',
      pages: '++id, tabId, chapterId, chapterOrder, pageNumber, name, [tabId+chapterOrder+pageNumber]',
      bookmarks: '++id, tabId, pageId',
      chapters: '++id, tabId, order, createdAt, [tabId+order]'
    }).upgrade(async tx => {
      // migrate pages: add chapterOrder field (default -1)
      const pages = await tx.table<Page>(STORE_PAGES).toArray();
      const chapters = await tx.table<Chapter>(STORE_CHAPTERS).toArray();

      const chapterMap = new Map<number, Chapter>();
      chapters.forEach(ch => {
        if (ch.id != null) chapterMap.set(ch.id, ch);
      });

      pages.forEach(p => {
        if (p.chapterId && chapterMap.has(p.chapterId)) {
          p.chapterOrder = chapterMap.get(p.chapterId)!.order;
        } else {
          p.chapterOrder = null;
        }
      });

      await tx.table<Page>(STORE_PAGES).bulkPut(pages);
    });

    // v7
    this.version(7).stores({
      tabs: '++id, name, updatedAt, description, mode',
      pages: '++id, tabId, chapterId, chapterOrder, pageNumber, name, [tabId+chapterOrder+pageNumber], [tabId+chapterId]',
      bookmarks: '++id, tabId, pageId',
      chapters: '++id, tabId, order, createdAt, [tabId+order]'
    });

    // v8
    this.version(8).stores({
      tabs: '++id, name, updatedAt, description, mode',
      pages: '++id, tabId, chapterId, chapterOrder, pageNumber, name, [tabId+chapterOrder+pageNumber], [tabId+chapterId]',
      bookmarks: '++id, tabId, pageId, chapterId, [tabId+chapterId], [tabId+pageId]',
      chapters: '++id, tabId, order, createdAt, [tabId+order]'
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
//db.delete();
// RECREATE DB IF VERSION DB != DB_VERSION
// db.open().then(async () => {
//   console.log('Current DB version:', db.verno);

//   if (db.verno !== DB_VERSION) {
//     console.warn('DB version mismatch => recreating');

//     await db.delete();

//     location.reload();
//   }
// });