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
    // multi-store delete transaction
    // create transaction and wait for completion
    const db = await this.db.getDb();
    const tx = db.transaction([STORE_TABS, STORE_PAGES], 'readwrite');
    const tabsStore = tx.objectStore(STORE_TABS);
    const pagesStore = tx.objectStore(STORE_PAGES);
    const index = pagesStore.index('tab');

    // delete tab
    tabsStore.delete(tabId);

    // delete associated pages  
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
  async saveOrUpdateTabWithPages(tab: Tab, pages: Page[], deleteOldPages = true): Promise<number> {
    let tabWithPreview: Tab = tab;

    // generate preview
    const preview = await createPreviewFromFirstPage(pages, PREVIEW_MAX_SIZE);
    if (preview) tabWithPreview = { ...tab, preview };

    // block refresh until done
    window.onbeforeunload = () => true;

    try {
      const db = await this.db.getDb();
      const transaction = db.transaction([STORE_TABS, STORE_PAGES], 'readwrite');
      const tabStore = transaction.objectStore(STORE_TABS);
      const pagesStore = transaction.objectStore(STORE_PAGES);
      const pagesIndex = pagesStore.index('tab');

      // start operation
      const tabRequest = tabStore.put(tabWithPreview);

      return await new Promise<number>((resolve, reject) => {
        tabRequest.onerror = () => reject(tabRequest.error);

        tabRequest.onsuccess = (event: Event) => {
          const tabId = (event.target as IDBRequest).result as number;

          const savePages = () => {
            console.log('Saving pages count=', pages.length, 'for tabId=', tabId);
            for (const page of pages) {
              const pageToSave = { ...page };
              delete pageToSave.id; // to create new record
              pageToSave.tab = tabId;
              pagesStore.put(pageToSave);
            }
          };

          if (!deleteOldPages) {
            // simply save new pages
            savePages();
            return;
          }

          // delete old pages first
          const getKeysReq = pagesIndex.getAllKeys(IDBKeyRange.only(tabId));

          getKeysReq.onerror = () => reject(getKeysReq.error);

          getKeysReq.onsuccess = () => {
            const keys: IDBValidKey[] = getKeysReq.result || [];

            if (keys.length === 0) {
              // no old pages => directly save new
              savePages();
              return;
            }

            // wait for all deletes
            let pending = keys.length;

            keys.forEach(key => {
              const deleteReq = pagesStore.delete(key);

              deleteReq.onerror = () => reject(deleteReq.error);

              deleteReq.onsuccess = () => {
                pending--;
                if (pending === 0) {
                  // all old pages removed
                  savePages();
                  // don't resolve here => wait for transaction.oncomplete
                }
              };
            });
          };
        };

        transaction.oncomplete = () => {
          resolve((tabRequest.result as number) || 0);
        };
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      window.onbeforeunload = null;
    }
  }
}
