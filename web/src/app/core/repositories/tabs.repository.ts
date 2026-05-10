import { Injectable } from '@angular/core';
import { createPreviewFromFirstPage } from '../../shared/utils/preview';
import { Tab } from '../models/tab.model';
import { db } from '../database/manga-db';
import { Page } from '../models/page.model';
import { PREVIEW_MAX_SIZE } from '../db.config';
import { ViewMod } from '../../shared/enums/viewmod.enum';
import { Chapter } from '../models/chapter.model';

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

  async saveOrUpdateTabWithPages(tab: Tab, pages: Array<any>, options: SaveTabOptions = {}): Promise<number> {
    const { previewMaxSize, deleteOldPages, chapter } = options;

    // preview
    var preview: Blob | string | null = null;
    if (tab.mode === ViewMod.Single) { // create preview from first page for single view
      preview = await createPreviewFromFirstPage(pages, previewMaxSize || PREVIEW_MAX_SIZE);
    }
    else if (tab.mode === ViewMod.Chapters) { // the client choose himself
      preview = tab.preview ?? null;
    }

    // transaction to save tab and pages
    const tabId = await db.transaction('rw', db.tabs, db.pages, db.bookmarks, db.chapters,  async () => {
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

      // if (deleteOldPages || pages.length === 0) {
      //   await db.pages.where('tabId').equals(savedId as number).delete();
      // }

      var chapterId: number | undefined = undefined;

      // save chapter if needed and get chapterId for pages
      if (tabToSave.mode === ViewMod.Chapters && chapter) {
        chapterId = await db.chapters.put(chapter);
      }

      // prepare pages — use within-chapter position as order; global order is assigned below
      const normalized: Page[] = pages.map((p: any, indx: number) => ({
        id: p.id,
        tabId: savedId as number,
        src: p.src ?? p.blob,
        name: p.name ?? null,
        order: indx + 1,
        chapterId: p.chapterId ?? chapterId ?? null,
        chapterOrder: p.chapterOrder ?? chapter?.order ?? -1
      }));

      // find existing pages for the tab and chapter(chapter mode) 
      // to determine which ones to delete (those that have id and are not in incoming)
      const existing = await db.pages
        .where('tabId')
        .equals(savedId as number)
        .filter(p => (p.chapterId ?? null) === (chapterId ?? null))
        .toArray();

      const incomingIds = new Set(
        normalized
          .map(p => p.id)
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

      if (normalized.length) {
        await db.pages.bulkPut(normalized);
      }

      // global renumber: sort all tab pages by [chapterOrder, order] -> reassign order 1..N
      if (tabToSave.mode === ViewMod.Chapters) {
        const allPages = await db.pages.where('tabId').equals(savedId as number).toArray();
        allPages.sort((a, b) => {
          const diff = (a.chapterOrder ?? 0) - (b.chapterOrder ?? 0);
          return diff !== 0 ? diff : (a.order ?? 0) - (b.order ?? 0);
        });
        for (let i = 0; i < allPages.length; i++) {
          allPages[i].order = i + 1;
        }
        await db.pages.bulkPut(allPages);
      }

      return savedId as number;
    });

    return tabId;
  }
}