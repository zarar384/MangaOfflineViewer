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
  const store = await this.db.tx(STORE_TABS, 'readwrite'); 
  return this.db.wrap(store.add(tab));
}

async update(tab: Tab) {
  const store = await this.db.tx(STORE_TABS, 'readwrite'); 
  return this.db.wrap(store.put(tab));
}

async delete(id: number) {
  const store = await this.db.tx(STORE_TABS, 'readwrite');
  return this.db.wrap(store.delete(id));
}

async get(id: number): Promise<Tab | undefined> {
  const store = await this.db.tx(STORE_TABS);
  return this.db.wrap<Tab | undefined>(store.get(id));
}

async getAll(): Promise<Tab[]> {
  const store = await this.db.tx(STORE_TABS);
  return this.db.wrap(store.getAll());
}


  async deleteTabWithPages(tabId: number): Promise<void> {
    const tx = this.db['db'].transaction([STORE_TABS, STORE_PAGES], 'readwrite');
    const tabsStore = tx.objectStore(STORE_TABS);
    const pagesStore = tx.objectStore(STORE_PAGES);

    // delete tab
    tabsStore.delete(tabId);

    // delete associated pages
    const index = pagesStore.index('tab');
    const range = IDBKeyRange.only(tabId);
    const request = index.openCursor(range);

    request.onsuccess = (event: any) => {
      const cursor: IDBCursorWithValue = event.target.result;
      if (cursor) {
        cursor.delete(); // delete the page
        cursor.continue();
      }
    };

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }


  // BULK SAVE OR UPDATE(tab + pages[])
  async saveOrUpdateTabWithPages(tab: Tab, pages: Page[], deleteOldPages = false): Promise<number> {
    //  create tab with preview
    let tabWithPreview: Tab;
    const preview = await createPreviewFromFirstPage(pages, PREVIEW_MAX_SIZE);
    if (preview) tabWithPreview = { ...tab, preview };


    // create transaction to save tab and pages
    return new Promise<number>((resolve, reject) => {
      const transaction = this.db['db'].transaction([STORE_TABS, STORE_PAGES], 'readwrite');
      const tabStore = transaction.objectStore(STORE_TABS);
      const pagesStore = transaction.objectStore(STORE_PAGES);
      const pagesIndex = pagesStore.index('tab');

      const tabRequest = tabStore.put(tabWithPreview);

      tabRequest.onsuccess = (event: Event) => {
        const tabId = (event.target as IDBRequest).result as number;

        const finalizePages = () => {
          pages.forEach(page => pagesStore.put({ ...page, tab: tabId }));
          resolve(tabId);
        };

        if (deleteOldPages) {
          const deleteRequest = pagesIndex.getAllKeys(IDBKeyRange.only(tabId));
          deleteRequest.onsuccess = () => {
            deleteRequest.result.forEach(key => pagesStore.delete(key));
            finalizePages();
          };
          deleteRequest.onerror = () => reject(deleteRequest.error);
        } else {
          finalizePages();
        }
      };

      tabRequest.onerror = () => reject(tabRequest.error);
      transaction.onerror = () => reject(transaction.error);
    });
  }

}