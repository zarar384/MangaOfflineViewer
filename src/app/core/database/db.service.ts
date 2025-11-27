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
      console.error('IndexedDB error', request.error);
    };
  }

  async getDb(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
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

  async tx(store: string, mode: IDBTransactionMode = 'readonly') {
    const db = await this.getDb();
    return db.transaction(store, mode).objectStore(store);
  }

  wrap<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
}
