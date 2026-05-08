import { Injectable } from '@angular/core';
import { db } from '../database/manga-db';
import { Tag } from '../models/tag.model';

@Injectable({ providedIn: 'root' })
export class TagsRepository {

  constructor() { }

  async add(tag: Tag): Promise<number> {
    tag.createdAt = tag.createdAt ?? Date.now();

    const id = await db.tags.put(tag);

    return id as number;
  }

  async update(tag: Tag): Promise<number> {
    const id = await db.tags.put(tag);

    return id as number;
  }

  async delete(id: number): Promise<void> {
    await db.tags.delete(id);
  }

  async get(id: number): Promise<Tag | undefined> {
    return db.tags.get(id);
  }

  async getAll(): Promise<Tag[]> {
    return db.tags
      .orderBy('name')
      .toArray();
  }

  async search(query: string): Promise<Tag[]> {
    const normalized = query.trim().toLowerCase();

    if (!normalized) return [];

    return db.tags
      .where('normalized')
      .startsWith(normalized)
      .limit(10)
      .toArray();
  }

  async findByNormalized(normalized: string): Promise<Tag | undefined> {
    return db.tags
      .where('normalized')
      .equals(normalized)
      .first();
  }

  // create new tags or return existing ids
async getOrCreateBatch(names: string[]): Promise<number[]> {

  const ids: number[] = [];

  for (const raw of names) {

    const normalized = raw.trim().toLowerCase();

    if (!normalized) continue;

    const existing = await this.findByNormalized(normalized);

    if (existing?.id) {
      ids.push(existing.id);
      continue;
    }

    const tag: Tag = {
      name: raw.trim(),
      normalized,
      createdAt: Date.now()
    };

    const id = await this.add(tag);

    ids.push(id);
  }

  return ids;
}

  // create new tag or return existing one
  async getOrCreate(name: string): Promise<number> {
    const normalized = name.trim().toLowerCase();

    const existing = await this.findByNormalized(normalized);

    if (existing?.id) {
      return existing.id;
    }

    const tag: Tag = {
      name: name.trim(),
      normalized,
      createdAt: Date.now()
    };

    return this.add(tag);
  }
}