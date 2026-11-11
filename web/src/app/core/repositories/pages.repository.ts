import { Injectable } from '@angular/core';
import { Page } from '../models/page.model';
import { db } from '../database/manga-db';
import { Dexie } from 'dexie';
import { PageMeta } from 'src/app/shared/models/page-meta.model';
import { Chapter } from '../models/chapter.model';

export const PAGES_SEED: Page[] = [
  {
    id: 1,
    tabId: 1,
    chapterId: 1,
    order: 1,
    src: 'assets/favicon.ico?v=2'
  },
  {
    id: 2,
    tabId: 1,
    chapterId: 1,
    order: 2,
    src: 'assets/favicon.ico?v=2'
  },
  {
    id: 3,
    tabId: 1,
    chapterId: 1,
    order: 3,
    src: 'assets/favicon.ico?v=2'
  },
  {
    id: 4,
    tabId: 1,
    chapterId: 2,
    order: 1,
    src: 'assets/favicon.ico?v=2'
  },
  {
    id: 5,
    tabId: 1,
    chapterId: 2,
    order: 2,
    src: 'assets/favicon.ico?v=2'
  },
  {
    id: 6,
    tabId: 1,
    chapterId: 3,
    order: 1,
    src: 'assets/favicon.ico?v=2'
  },
];

@Injectable({ providedIn: 'root' })
export class PagesRepository {
  constructor() { }

  async put(page: Page) {
    return db.pages.put(page);
  }

  async get(id: number) {
    return db.pages.get(id);
  }

  async stageImportPage(src: Blob | string): Promise<number> {
    return db.importDrafts.add({ src, createdAt: Date.now() });
  }

  async discardImportPages(ids: number[]): Promise<void> {
    if (ids.length) await db.importDrafts.bulkDelete(ids);
  }

  async discardExpiredImportPages(): Promise<void> {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    await db.importDrafts.where('createdAt').below(cutoff).delete();
  }

  async getOrderedIds(tabId: number, chapter?: Pick<Chapter, 'id' | 'order'>): Promise<number[]> {
    if (chapter && chapter.id == null) throw new Error('Cannot export a chapter without an id.');
    // Chapter membership is authoritative. Older plain imports can have chapterOrder = -1,
    // and null/missing ordering fields omit rows from the compound index altogether.
    const scope = chapter
      ? db.pages.where('[tabId+chapterId]').equals([tabId, chapter.id!])
      : db.pages.where('tabId').equals(tabId);
    const memberIds = await scope.primaryKeys();
    if (!memberIds.length) return [];

    const orderedIds = await db.pages
      .where('[tabId+chapterOrder+order]')
      .between(
        [tabId, chapter?.order ?? Dexie.minKey, Dexie.minKey],
        [tabId, chapter?.order ?? Dexie.maxKey, Dexie.maxKey]
      )
      .primaryKeys();
    const members = new Set(memberIds);
    if (orderedIds.length === members.size && orderedIds.every(id => members.has(id))) {
      return orderedIds; // Normal path stays key-only, without deserializing image payloads.
    }

    // Read legacy rows one at a time and retain only ordering fields, never a payload array.
    const ordering: { id: number; order: number; chapterOrder: number }[] = [];
    await scope.each(page => {
      ordering.push({ id: page.id!, order: page.order ?? 0, chapterOrder: page.chapterOrder ?? -1 });
    });
    ordering.sort((a, b) => (chapter ? 0 : a.chapterOrder - b.chapterOrder) || a.order - b.order);
    return ordering.map(page => page.id);
  }

  async getAll(tabId: number, chapterId?: number): Promise<Page[]> {
    try {
      if (!tabId) return [];

      if (chapterId !== undefined) {
        return this.getByChapter(tabId, chapterId);
      }

      return await db.pages
        .where('[tabId+chapterOrder+order]')
        .between(
          [tabId, Dexie.minKey, Dexie.minKey],
          [tabId, Dexie.maxKey, Dexie.maxKey]
        )
        .toArray();

    } catch (e) {
      console.error('Dexie getAll error', e);
      return [];
    }
  }

  // get only page ids to avoid loading src blobs into memory
  async getMeta(tabId: number, chapterId?: number): Promise<PageMeta[]> {
    const result: PageMeta[] = [];

    try {
      if (!tabId) return result;

      if (chapterId !== undefined) {
        const pages = await this.getByChapter(tabId, chapterId);

        return pages.map(p => ({
          ...p,
          src: null
        }));
      }

      await db.pages
        .where('[tabId+chapterOrder+order]')
        .between(
          [tabId, Dexie.minKey, Dexie.minKey],
          [tabId, Dexie.maxKey, Dexie.maxKey]
        )
        .each(p => {
          const meta = { ...p, src: null };
          result.push(meta);
        });

      return result;
    }
    catch (e) {
      console.error('Dexie getMeta error', e);
      return [];
    }
  }

  async getMetaByChapterWithPrevPages(tabId: number, chapterId: number, takeFromPrevious: number): Promise<PageMeta[]> {
    const chapter = await db.chapters.get(chapterId);

    if (!chapter) {
      return [];
    }
    const chapterOrder = chapter.order;
    const currentPagesPromise = this.getByChapterOrder(tabId, chapterOrder);

    const prevChapterOrderPromise = db.chapters
      .where('[tabId+order]')
      .between(
        [tabId, Dexie.minKey],
        [tabId, chapterOrder],
        true,
        false
      )
      .last()
      .then(ch => ch?.order ?? null);

    // wait both
    const [currentPages, prevOrder] = await Promise.all([
      currentPagesPromise,
      prevChapterOrderPromise
    ]);

    // previos doesn't exist 
    if (prevOrder == null || takeFromPrevious <= 0) {
      return currentPages;
    }

    // take only needed amount of pages from previous chapter and merge with current
    const prevPages = await db.pages
      .where('[tabId+chapterOrder+order]')
      .between(
        [tabId, prevOrder, Dexie.minKey],
        [tabId, prevOrder, Dexie.maxKey]
      )
      .reverse()                // last pages first
      .limit(takeFromPrevious)
      .toArray();

    prevPages.reverse();

    return prevPages.concat(currentPages);
  }

  async getMetaByChapter(chapterId: number): Promise<PageMeta[]> {
    const pages = await db.pages
      .where('chapterId')
      .equals(chapterId)
      .sortBy('order');

    return pages.map(p => ({
      ...p,
      src: null
    }));
  }

  async getByChapterOrder(tabId: number, chapterOrder: number) {
    return db.pages
      .where('[tabId+chapterOrder]')
      .equals([tabId, chapterOrder])
      .sortBy('order');
  }

  async getByChapter(tabId: number, chapterId: number) {
    return db.pages
      .where('[tabId+chapterId]')
      .equals([tabId, chapterId])
      .sortBy('order');
  }

  async countByChapter(chapterId: number) {
    return db.pages
      .where('chapterId')
      .equals(chapterId)
      .count();
  }

  async getFirstPage(chapterId: number) {
    const pages = await db.pages
      .where('chapterId')
      .equals(chapterId)
      .sortBy('order');

    return pages[0] ?? null;
  }

  async delete(id: number) {
    return db.pages.delete(id);
  }

  async deleteByTab(tabId: number) {
    return db.pages.where('tabId').equals(tabId).delete();
  }

  async bulkAdd(pages: Page[]) {
    return db.pages.bulkAdd(pages);
  }

  async bulkPut(pages: Page[]) {
    return db.pages.bulkPut(pages);
  }

  async count(tabId: number) {
    return db.pages.where('tabId').equals(tabId).count();
  }
}
