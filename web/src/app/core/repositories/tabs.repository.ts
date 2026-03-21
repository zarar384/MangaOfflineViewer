import { Injectable } from '@angular/core';
import { createPreviewFromFirstPage } from 'src/app/shared/utils/preview';
import { Tab } from '../models/tab.model';
import { db } from '../database/manga-db';
import { Page } from '../models/page.model';
import { PREVIEW_MAX_SIZE } from '../db.config';
import { Dexie } from 'dexie';
import { ViewMod } from 'src/app/shared/enums/viewmod.enum';

export const TABS_SEED: Tab[] = [
  {
    id: 1,
    name: "One Piece",
    description: "Pirates searching for the One Piece treasure.",
    preview: 'assets/favicon.ico?v=2',
    mode: ViewMod.Chapters
  },
  {
    id: 2,
    name: "Naruto",
    description: "A young ninja dreams of becoming Hokage.",
    preview: 'assets/favicon.ico?v=2',
    mode: ViewMod.Single
  },
  {
    id: 3,
    name: "Attack on Titan",
    description: "Humanity fights against giant titans.",
    preview: 'assets/favicon.ico?v=2',
    mode: ViewMod.Chapters
  }
];

export type SaveTabOptions = {
  deleteOldPages?: boolean;
  previewMaxSize?: number | null;
  name?: string | undefined;
};

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

  async saveOrUpdateTabWithPages(tab: Tab, pages: Array<any>, options: SaveTabOptions = {}): Promise<number> {
    const { previewMaxSize, deleteOldPages, name } = options;
    const preview = await createPreviewFromFirstPage(pages, previewMaxSize || PREVIEW_MAX_SIZE);

    // transaction to save tab and pages
    const tabId = await db.transaction('rw', db.tabs, db.pages, async () => {
      const tabToSave = {
        ...tab,
        preview: preview ?? tab.preview,
        updatedAt: Date.now(),
      };

      if (tabToSave.mode === ViewMod.Single) {
        tabToSave.name = name ?? tabToSave.name;
      }

      // save tab or update
      const savedId = await db.tabs.put(tabToSave);

      if (deleteOldPages) {
        await db.pages.where('tabId').equals(savedId as number).delete();
      }

      // save chapter if needed and get chapterId for pages
      const allPagesWithoutChapter = pages.every(p => p.chapterId === undefined);
      const chapterId = await this.createChapter(tabToSave, allPagesWithoutChapter, name);

      // prepare pages and bulk put
      const normalized: Page[] = pages.map((p: any, indx: number) => ({
        id: undefined,          // Dexie create ++id if undefined
        tabId: savedId as number,
        src: p.src ?? p.blob,
        name: p.name ?? null,
        pageNumber: indx + 1,
        chapterId: p.chapterId ?? chapterId
      }));

      if (normalized.length) await db.pages.bulkPut(normalized);

      return savedId as number;
    });

    return tabId;
  }

  private async createChapter(tabToSave: Tab, createChapter: boolean, name: string | undefined): Promise<number | undefined> {
    var chapterId: number | undefined = undefined;

    // if mod is 'chapters', find the next chapter order and create a new chapter if needed
    if (tabToSave.mode === ViewMod.Chapters && createChapter) {
      const nextOrder = await db.chapters.get({ tabId: tabToSave.id as number }).then(async chapter => {
        if (!chapter) {
          // no chapters exist, start with 1
          return 1;
        } else {
          // use compound index [tabId+order]] 
          // [1, 1], [1, 2], [1, 3], ... [2, 1], [2, 2], ...
          // find the last chapter for this tab and increment the order
          const last = await db.chapters
            .where('[tabId+order]')
            .between([tabToSave.id, Dexie.minKey], [tabToSave.id, Dexie.maxKey])
            .last();

          return (last?.order ?? 0) + 1;
        }
      });

      // save new chapter 
      if (nextOrder !== undefined) {
        chapterId = await db.chapters.add({
          tabId: tabToSave.id as number,
          title: name ?? `Chapter ${nextOrder}`,
          order: nextOrder,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      }
    }
    else if (tabToSave.mode === ViewMod.Chapters && !createChapter) {
      {
        // update chapter title
        const chapter = await db.chapters.get({ tabId: tabToSave.id as number }).then(chapter => {
          if (!chapter) {
            console.warn('No chapter found for tab', tabToSave.id);
            return null;
          }
          return chapter;
        });

        if (chapter) {
          await db.chapters.update(chapter.id as number, {
            title: name ?? chapter.title,
            updatedAt: Date.now()
          });
        }
      }

      return chapterId;
    }
  }
}