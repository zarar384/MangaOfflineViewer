import { Injectable } from '@angular/core';
import { STORE_TABS, STORE_PAGES, PREVIEW_MAX_SIZE } from '../db.config';
import { Tab } from '../models/tab.model';
import { Page } from '../models/page.model';
import { DbService } from '../database/db.service';
import { createPreviewFromFirstPage } from 'src/app/shared/utils/preview';
import { from, map, Observable, switchMap } from 'rxjs';


@Injectable({ providedIn: 'root' })
export class TabsRepository {
  constructor(private db: DbService) { }

  // CRUD base 
  add(tab: Tab) { return this.db.put(STORE_TABS, tab); }
  update(tab: Tab) { return this.db.put(STORE_TABS, tab); }
  delete(id: number) { return this.db.run(STORE_TABS, 'readwrite', s => s.delete(id)); }
  get(id: number) { return this.db.get<Tab>(STORE_TABS, id); }
  getAll() { return this.db.getAll<Tab>(STORE_TABS); }

  getTotalCount() {
    return this.db.run(STORE_TABS, 'readonly', store => store.count());
  }

  getPaged(page: number, perPage: number) {
    const all$ = this.db.runCursor<Tab>(
      STORE_TABS,
      "readonly",
      store => store.openCursor()
    );

    const start = (page - 1) * perPage;
    const end = start + perPage;

    return all$.pipe(
      map(tabs => tabs.slice(start, end))
    );
  }

  deleteTabWithPages(tabId: number): Observable<void> {
    // multi-store delete transaction
    // create transaction and wait for completion
    // switchMap is used to wait for the db Observable and then run the transaction
    return this.db.getDb().pipe(
      switchMap(db => new Observable<void>(subscriber => {
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

        tx.oncomplete = () => { subscriber.next(); subscriber.complete(); };
        tx.onerror = () => subscriber.error(tx.error);
        tx.onabort = () => subscriber.error(tx.error);

        return () => { }; // unsubscribe
      }))
    );
  }


  // BULK SAVE OR UPDATE(tab + pages[])
  saveOrUpdateTabWithPages(tab: Tab, pages: Page[], deleteOldPages = true): Observable<number> {
    // generate preview
    // from:  convert promise (preview generation) to observable
    return from(createPreviewFromFirstPage(pages, PREVIEW_MAX_SIZE)).pipe(
      // map: create tab object with preview and updatedAt
      map(preview => ({
        ...tab,
        preview: preview || tab.preview,
        updatedAt: tab.updatedAt ?? Date.now()
      })),
      // switchMap: take tabWithPreview and switch to db observable
      switchMap(tabWithPreview =>
        this.db.getDb().pipe(
          switchMap(db => new Observable<number>(subscriber => {
            const tx = db.transaction([STORE_TABS, STORE_PAGES], 'readwrite');
            const tabStore = tx.objectStore(STORE_TABS);
            const pagesStore = tx.objectStore(STORE_PAGES);
            const pagesIndex = pagesStore.index('tab');

            // save tab
            const tabReq = tabStore.put(tabWithPreview);

            tabReq.onsuccess = async (event: Event) => {
              const tabId = (event.target as IDBRequest).result as number;

              // save all pages as observable using from
              const savePages = () => from(Promise.all(
                pages.map(page => new Promise<void>((res, rej) => {
                  const p = { ...page };
                  delete p.id; // to create new record
                  p.tab = tabId;
                  const req = pagesStore.put(p);
                  req.onsuccess = () => res();
                  req.onerror = () => rej(req.error);
                }))
              ));

              const deleteOld$ = new Observable<void>(sub => {
                if (!deleteOldPages) {
                  // simply save new pages
                  savePages().subscribe({ complete: () => sub.next() });
                  return;
                }

                // delete old pages first
                const getKeysReq = pagesIndex.getAllKeys(IDBKeyRange.only(tabId));
                getKeysReq.onsuccess = async () => {
                  const keys: IDBValidKey[] = getKeysReq.result || [];
                  await Promise.all(
                    keys.map(k => new Promise<void>((res, rej) => {
                      const req = pagesStore.delete(k);
                      req.onsuccess = () => res();
                      req.onerror = () => rej(req.error);
                    }))
                  );
                  // then save new pages
                  savePages().subscribe({ complete: () => sub.next() });
                };
                getKeysReq.onerror = () => sub.error(getKeysReq.error);
              });

              // subscribe: wait for all deletes
              deleteOld$.subscribe({
                complete: () => { /* done */ },
                error: err => subscriber.error(err)
              });
            };

            tabReq.onerror = () => subscriber.error(tabReq.error);

            // resolve observable when transaction fully completed
            tx.oncomplete = () => {
              subscriber.next(tabReq.result as number || 0);
              subscriber.complete();
            };
            tx.onerror = () => subscriber.error(tx.error);
            tx.onabort = () => subscriber.error(tx.error);
          }))
        )
      )
    );
  }
}
