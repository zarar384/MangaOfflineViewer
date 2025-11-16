import { Injectable } from '@angular/core';

export interface MangaChapter {
  id: string;
  title: string;
  pages: string[];
}

@Injectable({ providedIn: 'root' })
export class IndexedDbService {
  private store: MangaChapter[] = [];

  constructor() {
    this.seedTestData();
  }

  private seedTestData() {
    const testChapters: MangaChapter[] = [
      {
        id: 'ch1',
        title: 'Chapter 1: The Beginning',
        pages: [
        ]
      },
      {
        id: 'ch2',
        title: 'Chapter 2: The Adventure Continues',
        pages: [
        ]
      },
      {
        id: 'ch3',
        title: 'Chapter 3: The Big Twist',
        pages: [
        ]
      }
    ];

    this.store.push(...testChapters);
  }

  async getAllChapters(): Promise<MangaChapter[]> {
    return this.store;
  }

  async getChapter(id: string): Promise<MangaChapter | undefined> {
    return this.store.find(s => s.id === id);
  }

  async addChapter(ch: MangaChapter) {
    this.store.unshift(ch);
    return ch;
  }
}
