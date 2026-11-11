import { Injectable } from '@angular/core';
import Dexie, { Transaction } from 'dexie';
import { createPreviewFromFirstPage } from '../../shared/utils/preview';
import { Tab } from '../models/tab.model';
import { db } from '../database/manga-db';
import { Page } from '../models/page.model';
import { PREVIEW_MAX_SIZE } from '../db.config';
import { ViewMod } from '../../shared/enums/viewmod.enum';
import { Chapter } from '../models/chapter.model';
import { isIOS } from 'src/app/shared/utils/constants';
import { ChaptersMangaStructureMetadata } from '../../shared/models/manga-structure-metadata';

export const TABS_SEED: Tab[] = [
  {
    id: 1,
    name: "One Piece",
    description: "Pirates searching for the One Piece treasure.",
    mode: ViewMod.Chapters
  },
  {
    id: 2,
    name: "Naruto",
    description: "A young ninja dreams of becoming Hokage.",
    mode: ViewMod.Single
  },
  {
    id: 3,
    name: "Attack on Titan",
    description: "Humanity fights against giant titans.",
    mode: ViewMod.Chapters
  }
];

export type SaveTabOptions = {
  deleteOldPages?: boolean;
  previewMaxSize?: number | null;
  chapter?: Chapter | undefined;
};

export type PageToSave = Page & { draftId?: number; blob?: Blob };

const PAGE_BATCH_BYTES = 8 * 1024 * 1024;

@Injectable({ providedIn: 'root' })
export class TabsRepository {
  constructor() { }

  async add(tab: Tab): Promise<number> {
    tab.updatedAt = tab.updatedAt ?? Date.now();
    tab.createdAt = tab.createdAt ?? Date.now();
    const id = await db.tabs.put(tab);
    return id as number;
  }

  async update(tab: Tab): Promise<number> {
    tab.updatedAt = Date.now();
    tab.createdAt = tab.createdAt ?? Date.now();
    const id = await db.tabs.put(tab);
    return id as number;
  }

  async delete(id: number): Promise<void> {
    await db.transaction('rw', db.tabs, db.pages, db.bookmarks, db.chapters, db.userTabs, async () => {
      await db.tabs.delete(id);
      await db.pages.where('tabId').equals(id).delete();
      await db.bookmarks.where('tabId').equals(id).delete();
      await db.chapters.where('tabId').equals(id).delete();
      await db.userTabs.where('tabId').equals(id).delete();
    });
  }

  async get(id: number): Promise<Tab | undefined> {
    return db.tabs.get(id);
  }


  async getAll(): Promise<Tab[]> {
    return db.tabs.orderBy('updatedAt').reverse().toArray();
  }

  async getTotalCount(): Promise<number> {
    return db.tabs.count();
  }

  async getPaged(page: number, perPage: number): Promise<Tab[]> {
    const offset = (page - 1) * perPage;
    return db.tabs.orderBy('id').offset(offset).limit(perPage).toArray();
  }

  async setBlurred(tabId: number, isBlurred: boolean): Promise<void> {
    // update only the isBlurred; keep activity order unchanged
    const tab = await db.tabs.update(tabId, { isBlurred });

    if (!tab) {
      throw new Error(`Tab with id ${tabId} not found`);
    }
  }

  async saveOrUpdateTabWithPages(
    tab: Tab,
    pages: readonly PageToSave[],
    options: SaveTabOptions = {}
  ): Promise<number> {

    const { previewMaxSize, deleteOldPages, chapter } = options;

    // preview
    let preview: Blob | string | null = null;

    if (tab.mode === ViewMod.Single) {

      // create preview from first page for single view
      const first = pages[0];
      if (first) {
        preview = await createPreviewFromFirstPage(
          [{ ...first, src: await this.resolvePageSource(first) }],
          previewMaxSize || PREVIEW_MAX_SIZE
        );
      }
    }
    else if (tab.mode === ViewMod.Chapters) {

      // the client choose himself
      preview = tab.preview ?? null;
    }

    // prepare pages before transaction
    // Safari/iPhone does not like long transactions
    const normalized: PageToSave[] = pages.map((p, indx) => ({
      id: p.id,
      draftId: p.draftId,

      // temporary
      // real tabId/chapterId assigned later
      tabId: tab.id ?? -1,

      // avoid storing duplicated blob fields
      src: p.src ?? p.blob,

      name: p.name,
      width: p.width ?? null,
      height: p.height ?? null,
      
      // order inside chapter
      order: indx + 1,

      chapterId: p.chapterId ?? chapter?.id ?? null,
      chapterOrder: p.chapterOrder ?? chapter?.order ?? -1
    }));

    return db.transaction('rw', [db.tabs, db.pages, db.bookmarks, db.chapters, db.importDrafts], transaction => {
      const tabTable = transaction.table<Tab, number>(db.tabs.name);
      const chapterTable = transaction.table<Chapter, number>(db.chapters.name);
      const tabToSave = {
        ...tab,
        name: tab.mode === ViewMod.Single ? chapter?.title ?? tab.name : tab.name,
        preview: preview ?? tab.preview,
        updatedAt: Date.now(),
        createdAt: tab.createdAt ?? Date.now()
      };

      return tabTable.put(tabToSave).then(tabId => {
        const saveChapter = () => {
          if (tab.mode !== ViewMod.Chapters) return Dexie.Promise.resolve(undefined);
          const chapterToSave = chapter ?? {
            tabId,
            title: 'New Chapter',
            order: 1,
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          return chapterTable.put(chapterToSave).then(id => ({ id, order: chapterToSave.order }));
        };

        return saveChapter().then(savedChapter => {
          for (const page of normalized) {
            page.tabId = tabId;
            page.chapterId ??= savedChapter?.id ?? null;
            if (savedChapter && page.chapterId === savedChapter.id) {
              page.chapterOrder = savedChapter.order;
            }
          }

          return this.removeOldPages(transaction, tabId, savedChapter?.id, normalized, deleteOldPages)
            .then(() => this.savePageBatches(transaction, normalized, 'bulkPut'))
            .then(() => tabId);
        });
      });
    });
  }

  private removeOldPages(
    transaction: Transaction,
    tabId: number,
    chapterId: number | undefined,
    incoming: readonly PageToSave[],
    deleteOldPages: boolean | undefined
  ): Promise<void> {
    const pageTable: typeof db.pages = transaction.table(db.pages.name);
    const bookmarkTable: typeof db.bookmarks = transaction.table(db.bookmarks.name);
    const inTab = pageTable.where('tabId').equals(tabId);
    let oldIds: Promise<number[]>;
    if (deleteOldPages) {
      oldIds = inTab.primaryKeys();
    } else if (chapterId === undefined) {
      oldIds = inTab.filter(page => page.chapterId == null).primaryKeys();
    } else {
      oldIds = pageTable.where('[tabId+chapterId]').equals([tabId, chapterId]).primaryKeys();
    }

    const retainedIds = new Set(incoming.map(page => page.id));
    return oldIds.then(ids => {
      const toDelete = deleteOldPages ? ids : ids.filter(id => !retainedIds.has(id));
      if (!toDelete.length) return;
      return bookmarkTable.where('pageId').anyOf(toDelete).delete()
        .then(() => pageTable.bulkDelete(toDelete));
    });
  }

  async saveImportedMangaStructure(
    tab: Tab,
    metadata: ChaptersMangaStructureMetadata,
    pagesByAsset: ReadonlyMap<string, PageToSave>
  ): Promise<number> {
    return db.transaction('rw', [db.tabs, db.pages, db.chapters, db.importDrafts], transaction => {
      const tabTable = transaction.table<Tab, number>(db.tabs.name);
      const chapterTable = transaction.table<Chapter, number>(db.chapters.name);
      return tabTable.put({
        ...tab,
        mode: ViewMod.Chapters,
        updatedAt: Date.now(),
        createdAt: tab.createdAt ?? Date.now()
      }).then(tabId => {
        const pages: PageToSave[] = [];
        let pending = Dexie.Promise.resolve();
        for (const [chapterIndex, chapter] of metadata.chapters.entries()) {
          const chapterOrder = chapterIndex + 1;
          pending = pending.then(() => chapterTable.add({
            tabId,
            title: chapter.title,
            order: chapterOrder,
            createdAt: Date.now(),
            updatedAt: Date.now()
          })).then(chapterId => {
            for (const [pageIndex, item] of chapter.pages.entries()) {
              const page = pagesByAsset.get(item.asset);
              if (!page) throw new Error('Missing imported page: ' + item.asset);
              pages.push({ ...page, id: undefined, tabId, chapterId, chapterOrder, order: pageIndex + 1 });
            }
          });
        }
        return pending.then(() => this.savePageBatches(transaction, pages, 'bulkAdd')).then(() => tabId);
      });
    });
  }

  private resolvePageSource(
    page: PageToSave,
    pageTable = db.pages,
    draftTable = db.importDrafts
  ): Promise<Page['src']> {
    if (page.draftId !== undefined) {
      return draftTable.get(page.draftId).then(draft => {
        if (!draft) throw new Error('An imported page is no longer available. Select its file again.');
        return draft.src;
      });
    }
    if (page.src !== undefined || page.blob !== undefined || page.id === undefined) {
      return Dexie.Promise.resolve(page.src ?? page.blob);
    }
    return pageTable.get(page.id).then(saved => {
      if (!saved) throw new Error('A saved page was removed while editing.');
      return saved.src;
    });
  }

  private savePageBatches(
    transaction: Transaction,
    pages: readonly PageToSave[],
    operation: 'bulkPut' | 'bulkAdd'
  ): Promise<void> {
    const pageTable: typeof db.pages = transaction.table(db.pages.name);
    const draftTable: typeof db.importDrafts = transaction.table(db.importDrafts.name);
    const maxPages = isIOS ? 10 : 50;
    const draftIds: number[] = [];
    let batch: Page[] = [];
    let batchBytes = 0;

    const flush = () => {
      const ready = batch;
      batch = [];
      batchBytes = 0;
      return pageTable[operation](ready);
    };

    // Keep page reads and writes on the transaction's Dexie promise chain. A native
    // async helper between requests can let IndexedDB commit under Angular's Zone.
    let pending = Dexie.Promise.resolve();
    for (const input of pages) {
      pending = pending.then(() => this.resolvePageSource(input, pageTable, draftTable)).then(src => {
        const bytes = typeof src === 'string' ? src.length * 2 : src?.size ?? 0;
        const append = () => {
          const { draftId, blob, ...page } = input;
          batch.push({ ...page, src });
          batchBytes += bytes;
          if (draftId !== undefined) draftIds.push(draftId);
        };
        if (batch.length && (batch.length >= maxPages || batchBytes + bytes > PAGE_BATCH_BYTES)) {
          return flush().then(append);
        }
        append();
      });
    }

    return pending.then(() => batch.length ? flush() : undefined).then(() => {
      if (draftIds.length) return draftTable.bulkDelete(draftIds);
    });
  }
}
