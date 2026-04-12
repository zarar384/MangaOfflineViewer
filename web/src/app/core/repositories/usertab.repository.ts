import { Injectable } from '@angular/core';
import { db } from '../database/manga-db';
import { UserTab } from '../models/usertab';

@Injectable({ providedIn: 'root' })
export class UserTabsRepository {
  constructor() { }

  async put(ut: UserTab) {
    return db.userTabs.put(ut);
  }

  async get(tabId: number) {
    return db.userTabs.where('tabId').equals(tabId).first();
  }

  async getAll() {
    return db.userTabs.toArray();
  }

  async delete(tabId: number) {
    return db.userTabs.where('tabId').equals(tabId).delete();
  }
}