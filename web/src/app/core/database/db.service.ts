import { DB_NAME, DB_VERSION, STORE_BOOKMARKS, STORE_PAGES, STORE_TABS } from "../db.config";
import { Injectable } from '@angular/core';
import { BehaviorSubject, filter, Observable, take } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class DbService {
  private db$ = new BehaviorSubject<IDBDatabase | null>(null);

  constructor() {
    this.init();
  }

  private init() {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_TABS)) {
        db.createObjectStore(STORE_TABS, { keyPath: 'id', autoIncrement: true });
      }

      if (!db.objectStoreNames.contains(STORE_PAGES)) {
        const pages = db.createObjectStore(STORE_PAGES, { keyPath: 'id', autoIncrement: true });
        pages.createIndex('tab', 'tab', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_BOOKMARKS)) {
        const store = db.createObjectStore(STORE_BOOKMARKS, { keyPath: 'id', autoIncrement: true });
        store.createIndex('tab', 'tab', { unique: false });
      }
    };

    request.onsuccess = () => {
      this.db$.next(request.result);
    };

    request.onerror = () => {
      console.error('IndexedDB init error', request.error);
      this.db$.error(request.error);
    };
  }

  getDb(): Observable<IDBDatabase> {
    return this.db$.asObservable().pipe(
      filter((db): db is IDBDatabase => !!db),
      take(1)
    );
  }

  run<T>(
    storeName: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>
  ): Observable<T> {
    return new Observable<T>(observer => {
      const sub = this.getDb().subscribe(db => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const req = operation(store);

        req.onsuccess = () => {
          observer.next(req.result);
          observer.complete();
        };
        req.onerror = () => observer.error(req.error);

        tx.onerror = () => observer.error(tx.error);
      });

      return () => sub.unsubscribe();
    });
  }

  runCursor<T>(
    storeName: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<IDBCursorWithValue | null>
  ): Observable<T[]> {
    return new Observable<T[]>(observer => {
      const sub = this.getDb().subscribe(db => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);

        const result: T[] = [];
        const cursorReq = operation(store);

        cursorReq.onsuccess = (e: any) => {
          const cursor: IDBCursorWithValue | null = e.target.result;
          if (cursor) {
            result.push(cursor.value);
            cursor.continue();
          } else {
            observer.next(result);
            observer.complete();
          }
        };
        cursorReq.onerror = () => observer.error(cursorReq.error);
        tx.onerror = () => observer.error(tx.error);
      });

      return () => sub.unsubscribe();
    });
  }

  put<T>(storeName: string, val: T) {
    return this.run(storeName, 'readwrite', s => s.put(val));
  }
  get<T>(storeName: string, id: IDBValidKey) {
    return this.run<T>(storeName, 'readonly', s => s.get(id));
  }
  getAll<T>(storeName: string) {
    return this.run<T[]>(storeName, 'readonly', s => s.getAll());
  }
}