import { Injectable } from '@angular/core';
import { STORE_TABS, STORE_PAGES, PREVIEW_MAX_SIZE } from '../db.config';
import { Tab } from '../models/tab.model';
import { Page } from '../models/page.model';
import { DbService } from '../database/db.service';
import { createPreviewFromFirstPage } from 'src/app/shared/utils/preview';

@Injectable({ providedIn: 'root' })
export class TabsRepository {
  constructor(private db: DbService) { }

  // CRUD base 
  async add(tab: Tab) {
    return this.db.put(STORE_TABS, tab);
  }

  async update(tab: Tab) {
    return this.db.put(STORE_TABS, tab);
  }

  async delete(id: number) {
    return this.db.run(STORE_TABS, 'readwrite', store => store.delete(id));
  }

  async get(id: number): Promise<Tab | undefined> {
    return this.db.get(STORE_TABS, id);
  }

  async getAll(): Promise<Tab[]> {
    return this.db.getAll(STORE_TABS);
  }

  async deleteTabWithPages(tabId: number): Promise<void> {
    // multi-store delete transaction - create transaction and wait for completion
    const db = await this.db.getDb();
    const tx = db.transaction([STORE_TABS, STORE_PAGES], 'readwrite');
    const tabsStore = tx.objectStore(STORE_TABS);
    const pagesStore = tx.objectStore(STORE_PAGES);
    const index = pagesStore.index('tab');

    // delete tab
    tabsStore.delete(tabId);

    // delete associated pages via курсора
    const request = index.openCursor(IDBKeyRange.only(tabId));
    request.onsuccess = (ev: Event) => {
      const cursor = (ev.target as IDBRequest).result as IDBCursorWithValue | null;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    request.onerror = () => {
      // fetch error in tx.onerror
    };

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  // BULK SAVE OR UPDATE(tab + pages[])
  async saveOrUpdateTabWithPages(tab: Tab, pages: Page[], deleteOldPages = false): Promise<number> {
    // create tab with preview (не модифицируем оригинал, если preview не нужен)
    let tabWithPreview: Tab = tab;
    const preview = await createPreviewFromFirstPage(pages, PREVIEW_MAX_SIZE);
    if (preview) tabWithPreview = { ...tab, preview };

    // bloch refresh until done (necessary for big blobs)
    window.onbeforeunload = () => true;

    try {
      const db = await this.db.getDb();
      const transaction = db.transaction([STORE_TABS, STORE_PAGES], 'readwrite');
      const tabStore = transaction.objectStore(STORE_TABS);
      const pagesStore = transaction.objectStore(STORE_PAGES);
      const pagesIndex = pagesStore.index('tab');

      // создаём/обновляем tab
      const tabRequest = tabStore.put(tabWithPreview);

      return await new Promise<number>((resolve, reject) => {
        tabRequest.onsuccess = (event: Event) => {
          const tabId = (event.target as IDBRequest).result as number;

          const finalizePages = () => {
            // put is more safe, but tx will complete only after oncomplete
            for (const page of pages) {
              pagesStore.put({ ...page, tab: tabId });
            }
          };

          if (deleteOldPages) {
            const deleteRequest = pagesIndex.getAllKeys(IDBKeyRange.only(tabId));
            deleteRequest.onsuccess = () => {
              const keys: IDBValidKey[] = deleteRequest.result || [];
              for (const key of keys) {
                pagesStore.delete(key);
              }
              finalizePages();
            };
            deleteRequest.onerror = () => reject(deleteRequest.error);
          } else {
            finalizePages();
          }
        };

        tabRequest.onerror = () => reject(tabRequest.error);

        transaction.oncomplete = () => {
          resolve((tabRequest.result as unknown as number) || 0);
        };
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      // udblock refresh 
      window.onbeforeunload = null;
    }
  }
}
