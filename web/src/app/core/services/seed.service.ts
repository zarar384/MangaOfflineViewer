import { Injectable } from '@angular/core';
import { db } from '../database/manga-db';
import { USE_SEEDS } from '../db.config';
import { TABS_SEED } from '../repositories/tabs.repository';
import { CHAPTERS_SEED } from '../repositories/chapters.repository';
import { PAGES_SEED } from '../repositories/pages.repository';

@Injectable({ providedIn: 'root' })
export class SeedService {

    // For development/testing purposes, seed the database with some initial data if it's empty. 
    async seedIfNeeded(): Promise<void> {

        if (!USE_SEEDS) return;

        const tabsCount = await db.tabs.count();

        if (tabsCount > 0) return;

        await db.transaction(
            'rw',
            db.tabs,
            db.chapters,
            db.pages,
            async () => {
                // tabs
                await db.tabs.bulkAdd(TABS_SEED);

                // chapters
                await db.chapters.bulkAdd(CHAPTERS_SEED);

                // pages
                await db.pages.bulkAdd(PAGES_SEED);
            }
        );
    }

}