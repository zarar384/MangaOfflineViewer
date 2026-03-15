import { Injectable } from '@angular/core';
import { createPreviewFromFirstPage } from 'src/app/shared/utils/preview';
import { Tab } from '../models/tab.model';
import { db } from '../database/manga-db';
import { Page } from '../models/page.model';
import { PREVIEW_MAX_SIZE } from '../db.config';

export const TABS_SEED: Tab[] = [
  {
    id: 1,
    name: "One Piece",
    description: "Pirates searching for the One Piece treasure.",
    preview: 'assets/favicon.ico?v=2',
    mode: 'chapters'
  },
  {
    id: 2,
    name: "Naruto",
    description: "A young ninja dreams of becoming Hokage.",
    preview: 'assets/favicon.ico?v=2',
    mode: 'chapters'
  },
  {
    id: 3,
    name: "Attack on Titan",
    description: "Humanity fights against giant titans.",
    preview: 'assets/favicon.ico?v=2',
    mode: 'single'
  }
];

@Injectable({ providedIn: 'root' })
export class TabsRepository {
  constructor() { }

  async add(tab: Tab): Promise<number> {
    tab.updatedAt = tab.updatedAt ?? Date.now();
    const id = await db.tabs.put(tab);
    return id as number;
  }

  async update(tab: Tab): Promise<number> {
    tab.updatedAt = Date.now();
    const id = await db.tabs.put(tab);
    return id as number;
  }

  async delete(id: number): Promise<void> {
    await db.transaction('rw', db.tabs, db.pages, db.bookmarks, async () => {
      await db.tabs.delete(id);
      await db.pages.where('tabId').equals(id).delete();
      await db.bookmarks.where('tabId').equals(id).delete();
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

  async saveOrUpdateTabWithPages(tab: Tab, pages: Array<any>, deleteOldPages = true, previewMaxSize?: number): Promise<number> {
    const preview = await createPreviewFromFirstPage(pages, previewMaxSize || PREVIEW_MAX_SIZE);

    // transaction to save tab and pages
    const tabId = await db.transaction('rw', db.tabs, db.pages, async () => {
      const tabToSave = {
        ...tab,
        preview: preview ?? tab.preview,
        updatedAt: Date.now(),
      };

      // save tab or update
      const savedId = await db.tabs.put(tabToSave);

      if (deleteOldPages) {
        await db.pages.where('tabId').equals(savedId as number).delete();
      }

      // prepare pages and bulk put
      const normalized: Page[] = pages.map((p: any, indx: number) => ({
        id: undefined,          // Dexie create ++id if undefined
        tabId: savedId as number,
        src: p.src ?? p.blob,
        name: p.name ?? null,
        pageNumber: indx + 1,
      }));

      if (normalized.length) await db.pages.bulkPut(normalized);

      return savedId as number;
    });

    return tabId;
  }
}