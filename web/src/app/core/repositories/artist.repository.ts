import { Injectable } from '@angular/core';
import { db } from '../database/manga-db';
import { Artist } from '../models/artist.model';

@Injectable({ providedIn: 'root' })
export class ArtistsRepository {

  constructor() { }

  async add(artist: Artist): Promise<number> {
    artist.createdAt = artist.createdAt ?? Date.now();

    const id = await db.artists.put(artist);

    return id as number;
  }

  async update(artist: Artist): Promise<number> {
    const id = await db.artists.put(artist);

    return id as number;
  }

  async delete(id: number): Promise<void> {
    await db.artists.delete(id);
  }

  async get(id: number): Promise<Artist | undefined> {
    return db.artists.get(id);
  }

  async getAll(): Promise<Artist[]> {
    return db.artists
      .orderBy('name')
      .toArray();
  }

  async search(query: string): Promise<Artist[]> {
    const normalized = query.trim().toLowerCase();

    if (!normalized) return [];

    return db.artists
      .where('normalized')
      .startsWith(normalized)
      .limit(10)
      .toArray();
  }

  async findByNormalized(normalized: string): Promise<Artist | undefined> {
    return db.artists
      .where('normalized')
      .equals(normalized)
      .first();
  }

   // create new artists or return existing ids
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

    const artist: Artist = {
      name: raw.trim(),
      normalized,
      createdAt: Date.now()
    };

    const id = await this.add(artist);

    ids.push(id);
  }

  return ids;
}

  // create new artist or return existing one
  async getOrCreate(name: string): Promise<number> {
    const normalized = name.trim().toLowerCase();

    const existing = await this.findByNormalized(normalized);

    if (existing?.id) {
      return existing.id;
    }

    const artist: Artist = {
      name: name.trim(),
      normalized,
      createdAt: Date.now()
    };

    return this.add(artist);
  }
}