import { effect, Injectable, signal } from '@angular/core';
import { Tab } from '../models/tab.model';
import { Chapter } from '../models/chapter.model';
import { Page } from '../models/page.model';

export interface MangaDraft {
  tab: Tab;
  chapters: Chapter[];
  pages: Page[];
}

@Injectable({
  providedIn: 'root',
})

export class MangaDraftService {
  private STORAGE_KEY = 'manga_draft';

  private _draft = signal<MangaDraft | null>(null);

  // expose the draft as a readonly signal
  draft = this._draft.asReadonly();

  private saveTimeout: any;

  constructor() {
    this.loadFromStorage();

    // auto-save to localStorage on changes with debounce
    effect(() => {
      const value = this._draft();

      clearTimeout(this.saveTimeout);

      if (!value) {
        localStorage.removeItem(this.STORAGE_KEY);
        return;
      }

      this.saveTimeout = setTimeout(() => {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(value));
      }, 300);
    });
  }

  // INIT
  private loadFromStorage() {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (!saved) return;

      const parsed = JSON.parse(saved) as MangaDraft;

      // validate data
      if (!parsed.tab) return;

      this._draft.set({
        tab: parsed.tab,
        chapters: parsed.chapters ?? [],
        pages: parsed.pages ?? []
      });

    } catch {
      console.warn('Invalid draft in storage');
      localStorage.removeItem(this.STORAGE_KEY);
    }
  }

  
  clear() {
    this._draft.set(null);
    localStorage.removeItem(this.STORAGE_KEY);
  }

  // TAB
  setDraft(tab: Tab) {
    this._draft.set({
      tab,
      chapters: [],
      pages: []
    });
  }

  updateTab(tab: Partial<Tab>) {
    const current = this._draft();
    if (!current) return;

    this._draft.set({
      ...current,
      tab: { ...current.tab, ...tab }
    });
  }

  // CHAPTERS
  addChapter(chapter: Chapter) {
    const current = this._draft();
    if (!current) return;

    this._draft.set({
      ...current,
      chapters: [...current.chapters, chapter]
    });
  }

  updateChapter(id: number, patch: Partial<Chapter>) {
    const current = this._draft();
    if (!current) return;

    this._draft.set({
      ...current,
      chapters: current.chapters.map(c =>
        c.id === id ? { ...c, ...patch } : c
      )
    });
  }

  deleteChapter(id: number) {
    const current = this._draft();
    if (!current) return;

    this._draft.set({
      ...current,
      chapters: current.chapters.filter(c => c.id !== id)
    });
  }


  // PAGES
  addPage(page: Page) {
    const current = this._draft();
    if (!current) return;

    this._draft.set({
      ...current,
      pages: [...current.pages, page]
    });
  }

  deletePage(id: number) {
    const current = this._draft();
    if (!current) return;

    this._draft.set({
      ...current,
      pages: current.pages.filter(p => p.id !== id)
    });
  }

 // GETTERS
  getDraft() {
    return this._draft();
  }

  getTab() {
    return this._draft()?.tab ?? null;
  }

  getChapters() {
    return this._draft()?.chapters ?? [];
  }

  getPages() {
    return this._draft()?.pages ?? [];
  }
}
