import { Injectable } from '@angular/core';
import { db } from '../database/manga-db';
import { UserTab } from '../models/usertab';

@Injectable({ providedIn: 'root' })
export class UserTabsRepository {
  constructor() { }

  async put(ut: UserTab) {
    return db.userTabs.put(ut);
  }

  async updateByTabId(id: number){
    var tabId = await db.tabs.where('id').equals(id).first();

    if(tabId){
      const ut: UserTab = {
        name: tabId.name,
        tabId: id,
        createdAt: Date.now()
      }

      var existing = await db.userTabs.where('tabId').equals(id).first();
      if(existing){
        ut.id = existing.id;
      }

      return db.userTabs.put(ut);
    }

    return null;
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