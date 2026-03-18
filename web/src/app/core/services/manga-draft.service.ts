import { effect, Injectable, signal } from '@angular/core';
import { Tab } from '../models/tab.model';

@Injectable({
  providedIn: 'root',
})
export class MangaDraftService {
  private STORAGE_KEY = 'manga_draft';

  private draft = signal<Tab | null>(null);

  constructor() 
  {
    const saved  = localStorage.getItem(this.STORAGE_KEY);
    if(saved){
      this.draft.set(JSON.parse(saved));
    }

    effect(() => {
      const value = this.draft();
      if(value){
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(value));
      }
    });
  }

  setDraft(tab: Tab) 
  {
    this.draft.set(tab);
  }

  updateDraft(tab: Partial<Tab>)
  {
    const current = this.draft();
    if(!current) return;
   
    this.draft.set({ ...current, ...tab });
  }

  getDraft() {
    return this.draft();
  }

  clear(){
    this.draft.set(null);
    localStorage.removeItem(this.STORAGE_KEY);
  }
}
