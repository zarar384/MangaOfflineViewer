import { Injectable } from '@angular/core';
import { createPreviewFromFirstPage } from '../../shared/utils/preview';
import { Tab } from '../models/tab.model';
import { db } from '../database/manga-db';
import { Page } from '../models/page.model';
import { PREVIEW_MAX_SIZE } from '../db.config';
import { ViewMod } from '../../shared/enums/viewmod.enum';
import { Chapter } from '../models/chapter.model';
import { isIOS } from 'src/app/shared/utils/constants';
import { MangaStructureMetadata } from '../../shared/models/manga-structure-metadata';

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

  async saveOrUpdateTabWithPages(
    tab: Tab,
    pages: Array<any>,
    options: SaveTabOptions = {}
  ): Promise<number> {

    const { previewMaxSize, deleteOldPages, chapter } = options;

    // preview
    let preview: Blob | string | null = null;

    if (tab.mode === ViewMod.Single) {

      // create preview from first page for single view
      preview = await createPreviewFromFirstPage(
        pages,
        previewMaxSize || PREVIEW_MAX_SIZE
      );
    }
    else if (tab.mode === ViewMod.Chapters) {

      // the client choose himself
      preview = tab.preview ?? null;
    }

    // prepare pages before transaction
    // Safari/iPhone does not like long transactions
    const normalized: Page[] = pages.map((p: any, indx: number) => ({
      id: p.id,

      // temporary
      // real tabId/chapterId assigned later
      tabId: tab.id ?? -1,

      // avoid storing duplicated blob fields
      src: p.src ?? p.blob,

      name: p.name ?? null,
      width: p.width ?? null,
      height: p.height ?? null,
      
      // order inside chapter
      order: indx + 1,

      chapterId: p.chapterId ?? chapter?.id ?? null,
      chapterOrder: p.chapterOrder ?? chapter?.order ?? -1
    }));

    // transaction to save tab and pages
    const tabId = await db.transaction('rw', db.tabs, db.pages, db.bookmarks, db.chapters, async () => {
      const tabToSave = {
        ...tab,
        preview: preview ?? tab.preview,
        updatedAt: Date.now(),
        createdAt: tab.createdAt ?? Date.now()
      };

      if (tabToSave.mode === ViewMod.Single) {
        tabToSave.name = chapter?.title ?? tabToSave.name;
      }

      // save tab or update
      const savedId = await db.tabs.put(tabToSave);

      let chapterId: number | undefined = undefined;

      // save chapter if needed and get chapterId for pages
      if (tabToSave.mode === ViewMod.Chapters && chapter) {
        chapterId = await db.chapters.put(chapter);
      }
      // create a new chapter and put all pages into it
      else if (tabToSave.mode === ViewMod.Chapters && !chapter) 
      {
        const newChapter = {
          tabId: savedId as number,
          title: 'New Chapter',
          order: 1,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        
        chapterId = await db.chapters.put(newChapter);
      }

      // update normalized pages with real ids
      normalized.forEach(p => {
        p.tabId = savedId as number;

        if (!p.chapterId) {
          p.chapterId = chapterId ?? null;
        }
      });

      // delete old pages if requested
      if (deleteOldPages) {
        const oldPageIds = await db.pages
          .where('tabId')
          .equals(savedId as number)
          .primaryKeys();

        if (oldPageIds.length) {

          await db.bookmarks
            .where('pageId')
            .anyOf(oldPageIds as number[])
            .delete();

          await db.pages.bulkDelete(oldPageIds as number[]);
        }
      }
      else {
        let existing: Page[] = [];

        if (chapterId == null) {
          existing = await db.pages
            .where('tabId')
            .equals(savedId as number)
            .filter(p => p.chapterId == null)
            .toArray();
        }
        else {
          existing = await db.pages
            .where('[tabId+chapterId]')
            .equals([savedId, chapterId] as any)
            .toArray();
        }

        const incomingIds = new Set(
          normalized.map(p => p.id)
            .filter(id => id !== undefined)
        );

        // delete only those that have id and are not in incoming
        const toDelete = existing
          .filter(p => !incomingIds.has(p.id!))
          .map(p => p.id as number);

        if (toDelete.length) {
          await db.bookmarks.where('pageId').anyOf(toDelete).delete();
          await db.pages.bulkDelete(toDelete);
        }
      }

      // save by chunks
      // Safari/iPhone can freeze on very large bulkPut with blobs
      if (normalized.length) {
        const isMobile = isIOS;
        const chunkSize = isMobile ? 10 : 50;

        for (let i = 0; i < normalized.length; i += chunkSize) {
          const chunk = normalized.slice(i, i + chunkSize);
          await db.pages.bulkPut(chunk);
        }
      }

      return savedId as number;
    }
    );

    return tabId;
  }

     async saveImportedMangaStructure(
     tab: Tab,
     metadata: MangaStructureMetadata,
     pagesByAsset: ReadonlyMap<string, Page>
   ): Promise<number> {

    const pages_ = new Map(pagesByAsset);
    // The metadata was validated against every asset before this transaction starts.
     const previewPages = metadata.mode === ViewMod.Single
      ? metadata.pages.map(item => pages_.get(item.asset)!)
       : [];
     const preview = metadata.mode === ViewMod.Single
       ? await createPreviewFromFirstPage(previewPages, PREVIEW_MAX_SIZE) ?? undefined
       : tab.preview;
 
     return db.transaction('rw', db.tabs, db.pages, db.chapters, async () => {
       const tabId = await db.tabs.put({
         ...tab,
         mode: metadata.mode,
         preview,
         updatedAt: Date.now(),
         createdAt: tab.createdAt ?? Date.now()
       }) as number;
 
       const pages: Page[] = [];
       if (metadata.mode === ViewMod.Single) {
         for (const [index, item] of metadata.pages.entries()) {
          const page = pages_.get(item.asset)!;
           pages.push({ ...page, id: undefined, tabId, chapterId: null, chapterOrder: null, order: index + 1 });
         }
       } else {
         for (const [chapterIndex, chapterMetadata] of metadata.chapters.entries()) {
           const chapterId = await db.chapters.add({
             tabId,
             title: chapterMetadata.title,
             order: chapterIndex + 1,
             createdAt: Date.now(),
             updatedAt: Date.now()
           });
           for (const [pageIndex, item] of chapterMetadata.pages.entries()) {
            const page = pages_.get(item.asset)!;
             pages.push({ ...page, id: undefined, tabId, chapterId, chapterOrder: chapterIndex + 1, order: pageIndex + 1 });
           }
         }
       }
 
       if (pages.length) await db.pages.bulkAdd(pages);
       return tabId;
     });
   }
}