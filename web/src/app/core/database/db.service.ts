import { Injectable } from "@angular/core";
import { DB_NAME, DB_VERSION, STORE_PAGES, STORE_TABS } from "../db.config";

@Injectable({ providedIn: 'root' })
export class DbService {
  private db!: IDBDatabase;

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
    };

    request.onsuccess = () => {
      this.db = request.result;
    };

    request.onerror = () => {
      console.error('IndexedDB init error', request.error);
    };
  }

  async getDb(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
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
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onerror = () => reject(request.error);
    });
  }

  async run<T>(
    storeName: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
    const db = await this.getDb();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);

      const req = operation(store);

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);

      tx.oncomplete = () => {};
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  put(storeName: string, value: any) {
    return this.run(storeName, 'readwrite', store => store.put(value));
  }

  get(storeName: string, key: IDBValidKey) {
    return this.run(storeName, 'readonly', store => store.get(key));
  }

  getAll(storeName: string) {
    return this.run(storeName, 'readonly', store => store.getAll());
  }
}
